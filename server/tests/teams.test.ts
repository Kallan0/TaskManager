import { beforeAll, afterAll, describe, it, expect, vi } from 'vitest';
import { MongoMemoryServer } from 'mongodb-memory-server';
import mongoose from 'mongoose';
import request from 'supertest';
import { app } from '../src/app.js';
import { User } from '../src/modules/auth/user.model.js';
import { Team } from '../src/modules/teams/team.model.js';
import { Membership } from '../src/modules/memberships/membership.model.js';
import { Invitation } from '../src/modules/invitations/invitation.model.js';
import { env } from '../src/config/env.js';

const origin = 'http://localhost:5173';
const owner = request.agent(app),
  member = request.agent(app),
  outsider = request.agent(app),
  admin = request.agent(app);
let mongo: MongoMemoryServer,
  teamId: string,
  ownerId: string,
  memberId: string,
  adminId: string;
const email = {
  owner: 'owner@example.com',
  member: 'member@example.com',
  outsider: 'outsider@example.com',
  admin: 'admin@example.com',
};
beforeAll(async () => {
  mongo = await MongoMemoryServer.create();
  await mongoose.connect(mongo.getUri());
  await Promise.all([
    User.init(),
    Team.init(),
    Membership.init(),
    Invitation.init(),
  ]);
  for (const [agent, address, name] of [
    [owner, email.owner, 'Owner'],
    [member, email.member, 'Member'],
    [outsider, email.outsider, 'Outsider'],
    [admin, email.admin, 'Admin'],
  ] as const) {
    const res = await agent
      .post('/api/v1/auth/register')
      .set('Origin', origin)
      .send({ name, email: address, password: 'secure-password-123' });
    expect(res.status).toBe(201);
  }
  ownerId = (await owner.get('/api/v1/auth/me')).body.data.id;
  memberId = (await member.get('/api/v1/auth/me')).body.data.id;
  adminId = (await admin.get('/api/v1/auth/me')).body.data.id;
});
afterAll(async () => {
  await mongoose.disconnect();
  await mongo?.stop();
});
async function invite(address: string, role = 'member') {
  const result = await owner
    .post(`/api/v1/teams/${teamId}/invitations`)
    .set('Origin', origin)
    .send({ email: address, role });
  expect(result.status).toBe(201);
  return {
    ...result.body.data,
    token: result.body.data.inviteUrl.split('/').pop(),
  };
}
describe('Team collaboration and access control', () => {
  it('creates a team with one owner and persists it in the owner list', async () => {
    const created = await owner
      .post('/api/v1/teams')
      .set('Origin', origin)
      .send({ name: 'Product team', description: 'Build together' });
    expect(created.status).toBe(201);
    teamId = created.body.data.id;
    expect(created.body.data.role).toBe('owner');
    expect(
      await Membership.countDocuments({
        team: teamId,
        user: ownerId,
        role: 'owner',
      }),
    ).toBe(1);
    const listed = await owner.get('/api/v1/teams');
    expect(
      listed.body.data.items.map((item: { id: string }) => item.id),
    ).toContain(teamId);
    expect((await outsider.get('/api/v1/teams')).body.data.total).toBe(0);
  });
  it('rejects unauthenticated users, non-members and invalid IDs', async () => {
    expect((await request(app).get('/api/v1/teams')).status).toBe(401);
    for (const path of ['', '/members', '/invitations'])
      expect(
        (await outsider.get(`/api/v1/teams/${teamId}${path}`)).status,
      ).toBe(403);
    expect((await owner.get('/api/v1/teams/bad-id')).status).toBe(400);
    expect(
      (
        await outsider
          .patch(`/api/v1/teams/${teamId}`)
          .set('Origin', origin)
          .send({ name: 'Attack' })
      ).status,
    ).toBe(403);
  });
  it('validates team fields and pagination', async () => {
    expect(
      (
        await owner
          .post('/api/v1/teams')
          .set('Origin', origin)
          .send({ name: ' ' })
      ).status,
    ).toBe(400);
    expect((await owner.get('/api/v1/teams?page=-1')).status).toBe(400);
    expect((await owner.get('/api/v1/teams?limit=101')).status).toBe(400);
    const listed = await owner.get('/api/v1/teams?limit=1');
    expect(listed.body.data.items).toHaveLength(1);
    expect(
      (
        await owner
          .patch(`/api/v1/teams/${teamId}`)
          .set('Origin', origin)
          .send({ name: 'Updated team' })
      ).body.data.description,
    ).toBe('Build together');
  });
  it('stores only hashed tokens, rejects duplicate pending invites, and scopes inboxes to email', async () => {
    const created = await invite('MEMBER@EXAMPLE.COM');
    const stored = await Invitation.findById(created.id).select('+tokenHash');
    expect(stored?.tokenHash).not.toBe(created.token);
    expect(stored?.tokenHash).toMatch(/^[a-f\d]{64}$/);
    expect(
      (
        await owner
          .post(`/api/v1/teams/${teamId}/invitations`)
          .set('Origin', origin)
          .send({ email: email.member })
      ).status,
    ).toBe(409);
    expect(
      (await member.get('/api/v1/invitations')).body.data.items[0].teamName,
    ).toBe('Updated team');
    expect((await outsider.get('/api/v1/invitations')).body.data.total).toBe(0);
    expect(
      (await outsider.get(`/api/v1/invitations/${created.token}`)).status,
    ).toBe(404);
    expect(
      (
        await outsider
          .post(`/api/v1/invitations/by-id/${created.id}/accept`)
          .set('Origin', origin)
      ).status,
    ).toBe(404);
    const listed = await owner.get(`/api/v1/teams/${teamId}/invitations`);
    expect(JSON.stringify(listed.body)).not.toContain(created.token);
    expect(JSON.stringify(listed.body)).not.toContain('tokenHash');
    expect(
      (
        await member
          .post(`/api/v1/invitations/${created.token}/accept`)
          .set('Origin', origin)
      ).status,
    ).toBe(200);
    expect(
      (
        await member
          .post(`/api/v1/invitations/${created.token}/accept`)
          .set('Origin', origin)
      ).status,
    ).toBe(200);
    expect(
      await Membership.countDocuments({ team: teamId, user: memberId }),
    ).toBe(1);
    expect((await member.get(`/api/v1/teams/${teamId}`)).body.data.role).toBe(
      'member',
    );
  });
  it('prevents members from managing settings, roles, invitations and removals', async () => {
    expect(
      (
        await member
          .patch(`/api/v1/teams/${teamId}`)
          .set('Origin', origin)
          .send({ name: 'Changed' })
      ).status,
    ).toBe(403);
    expect(
      (
        await member
          .post(`/api/v1/teams/${teamId}/invitations`)
          .set('Origin', origin)
          .send({ email: 'new@example.com' })
      ).status,
    ).toBe(403);
    expect(
      (await member.get(`/api/v1/teams/${teamId}/invitations`)).status,
    ).toBe(403);
    expect(
      (
        await member
          .patch(`/api/v1/teams/${teamId}/members/${ownerId}`)
          .set('Origin', origin)
          .send({ role: 'admin' })
      ).status,
    ).toBe(403);
    expect(
      (
        await member
          .delete(`/api/v1/teams/${teamId}/members/${ownerId}`)
          .set('Origin', origin)
      ).status,
    ).toBe(403);
    const members = await member.get(`/api/v1/teams/${teamId}/members`);
    expect(members.body.data.total).toBe(2);
    expect(JSON.stringify(members.body)).not.toContain('passwordHash');
  });
  it('allows inbox acceptance while protecting ownership and admin role assignment', async () => {
    const created = await invite(email.admin, 'admin');
    expect(
      (
        await admin
          .post(`/api/v1/invitations/by-id/${created.id}/accept`)
          .set('Origin', origin)
      ).status,
    ).toBe(200);
    expect(
      (
        await admin
          .patch(`/api/v1/teams/${teamId}`)
          .set('Origin', origin)
          .send({ description: 'Admin edited' })
      ).status,
    ).toBe(200);
    expect(
      (
        await admin
          .post(`/api/v1/teams/${teamId}/invitations`)
          .set('Origin', origin)
          .send({ email: 'other@example.com', role: 'admin' })
      ).status,
    ).toBe(403);
    expect(
      (
        await admin
          .patch(`/api/v1/teams/${teamId}/members/${memberId}`)
          .set('Origin', origin)
          .send({ role: 'admin' })
      ).status,
    ).toBe(403);
    expect(
      (
        await owner
          .patch(`/api/v1/teams/${teamId}/members/${ownerId}`)
          .set('Origin', origin)
          .send({ role: 'member' })
      ).status,
    ).toBe(409);
    expect(
      (
        await owner
          .delete(`/api/v1/teams/${teamId}/members/${ownerId}`)
          .set('Origin', origin)
      ).status,
    ).toBe(403);
    expect(
      (
        await owner
          .patch(`/api/v1/teams/${teamId}/members/${memberId}`)
          .set('Origin', origin)
          .send({ role: 'admin' })
      ).status,
    ).toBe(200);
    expect(
      (
        await admin
          .delete(`/api/v1/teams/${teamId}/members/${memberId}`)
          .set('Origin', origin)
      ).status,
    ).toBe(403);
    expect(
      (
        await owner
          .patch(`/api/v1/teams/${teamId}/members/${memberId}`)
          .set('Origin', origin)
          .send({ role: 'member' })
      ).status,
    ).toBe(200);
    expect(
      (
        await owner
          .patch(`/api/v1/teams/${teamId}/members/${adminId}`)
          .set('Origin', origin)
          .send({ role: 'owner' })
      ).status,
    ).toBe(400);
  });
  it('prevents expired and revoked invitations from granting membership', async () => {
    const expired = await invite(email.outsider);
    await Invitation.updateOne(
      { _id: expired.id },
      { $set: { expiresAt: new Date(Date.now() - 1000) } },
    );
    expect(
      (await outsider.get(`/api/v1/invitations/${expired.token}`)).body.data
        .status,
    ).toBe('expired');
    expect(
      (
        await outsider
          .post(`/api/v1/invitations/${expired.token}/accept`)
          .set('Origin', origin)
      ).status,
    ).toBe(409);
    const replacement = await invite(email.outsider);
    expect(
      (
        await owner
          .delete(`/api/v1/teams/${teamId}/invitations/${replacement.id}`)
          .set('Origin', origin)
      ).status,
    ).toBe(204);
    expect(
      (
        await outsider
          .post(`/api/v1/invitations/${replacement.token}/accept`)
          .set('Origin', origin)
      ).status,
    ).toBe(409);
    expect((await outsider.get(`/api/v1/teams/${teamId}`)).status).toBe(403);
  });
  it('declines invitations and never grants membership by knowing an ID', async () => {
    const created = await invite(email.outsider);
    expect(
      (
        await outsider
          .post(`/api/v1/invitations/by-id/${created.id}/decline`)
          .set('Origin', origin)
      ).body.data.status,
    ).toBe('declined');
    expect(
      (
        await outsider
          .post(`/api/v1/invitations/${created.token}/accept`)
          .set('Origin', origin)
      ).status,
    ).toBe(409);
    expect((await outsider.get('/api/v1/invitations')).body.data.total).toBe(0);
  });
  it('handles concurrent acceptance with exactly one membership and blocks reuse after removal', async () => {
    const created = await invite(email.outsider);
    const results = await Promise.all(
      [1, 2].map(() =>
        outsider
          .post(`/api/v1/invitations/${created.token}/accept`)
          .set('Origin', origin),
      ),
    );
    expect(results.some((result) => result.status === 200)).toBe(true);
    expect(results.every((result) => [200, 409].includes(result.status))).toBe(
      true,
    );
    const outsiderId = (await outsider.get('/api/v1/auth/me')).body.data.id;
    expect(
      await Membership.countDocuments({ team: teamId, user: outsiderId }),
    ).toBe(1);
    expect(
      (
        await admin
          .delete(`/api/v1/teams/${teamId}/members/${outsiderId}`)
          .set('Origin', origin)
      ).status,
    ).toBe(204);
    expect(
      (
        await outsider
          .post(`/api/v1/invitations/${created.token}/accept`)
          .set('Origin', origin)
      ).status,
    ).toBe(409);
    expect((await outsider.get(`/api/v1/teams/${teamId}`)).status).toBe(403);
  });
  it('creates unique hashed shareable links with exactly 48 hours of validity', async () => {
    const before = Date.now();
    const first = await invite('share-first@example.com');
    const after = Date.now();
    const second = await invite('share-second@example.com');
    expect(first.token).toMatch(/^[a-f\d]{64}$/);
    expect(first.token).not.toBe(second.token);
    expect(Date.parse(first.expiresAt)).toBeGreaterThanOrEqual(
      before + 48 * 60 * 60 * 1000,
    );
    expect(Date.parse(first.expiresAt)).toBeLessThanOrEqual(
      after + 48 * 60 * 60 * 1000,
    );
    expect(first.delivery).toBeUndefined();
    const saved = await Invitation.findById(first.id).select('+tokenHash');
    expect(saved?.tokenHash).not.toBe(first.token);
    const listed = (await owner.get(`/api/v1/teams/${teamId}/invitations`)).body
      .data;
    expect(JSON.stringify(listed)).not.toContain(first.token);
  });
  it('returns the link to its creating manager in production without email configuration', async () => {
    const previous = env.NODE_ENV;
    try {
      env.NODE_ENV = 'production';
      const created = await invite('share-production@example.com');
      expect(created.inviteUrl).toBe(
        `${env.CLIENT_URL}/invitations/${created.token}`,
      );
      expect(created.status).toBe('pending');
    } finally {
      env.NODE_ENV = previous;
    }
  });
  it('rejects a pending link at its expiry boundary without granting membership', async () => {
    const created = await invite('expired-share@example.com');
    const recipient = request.agent(app);
    const registered = await recipient
      .post('/api/v1/auth/register')
      .set('Origin', origin)
      .send({
        name: 'Expired recipient',
        email: 'expired-share@example.com',
        password: 'secure-password-123',
      });
    expect(registered.status).toBe(201);
    await Invitation.updateOne(
      { _id: created.id },
      { $set: { expiresAt: new Date() } },
    );
    expect(
      (await recipient.get(`/api/v1/invitations/${created.token}`)).body.data
        .status,
    ).toBe('expired');
    expect(
      (
        await recipient
          .post(`/api/v1/invitations/${created.token}/accept`)
          .set('Origin', origin)
      ).status,
    ).toBe(409);
    expect(
      await Membership.exists({ team: teamId, user: registered.body.data.id }),
    ).toBeNull();
  });
  it('restores a pending invitation after a membership write failure so the recipient can retry', async () => {
    const created = await invite(email.outsider);
    const write = vi
      .spyOn(Membership, 'updateOne')
      .mockRejectedValueOnce(new Error('Write failed'));
    const result = await outsider
      .post(`/api/v1/invitations/${created.token}/accept`)
      .set('Origin', origin);
    write.mockRestore();
    expect(result.status).toBe(500);
    expect((await Invitation.findById(created.id))?.status).toBe('pending');
    expect(
      (
        await outsider
          .post(`/api/v1/invitations/${created.token}/accept`)
          .set('Origin', origin)
      ).status,
    ).toBe(200);
  });
  it('serializes concurrent acceptance and revocation without granting a revoked invitation', async () => {
    const racer = request.agent(app);
    const registered = await racer
      .post('/api/v1/auth/register')
      .set('Origin', origin)
      .send({
        name: 'Racer',
        email: 'racer@example.com',
        password: 'secure-password-123',
      });
    expect(registered.status).toBe(201);
    const created = await invite('racer@example.com');
    const [accepted, revoked] = await Promise.all([
      racer
        .post(`/api/v1/invitations/${created.token}/accept`)
        .set('Origin', origin),
      owner
        .delete(`/api/v1/teams/${teamId}/invitations/${created.id}`)
        .set('Origin', origin),
    ]);
    const saved = await Invitation.findById(created.id);
    const membership = await Membership.exists({
      team: teamId,
      user: registered.body.data.id,
    });
    if (saved?.status === 'accepted') {
      expect(accepted.status).toBe(200);
      expect(revoked.status).toBe(409);
      expect(membership).not.toBeNull();
    } else {
      expect(saved?.status).toBe('revoked');
      expect(accepted.status).toBe(409);
      expect(revoked.status).toBe(204);
      expect(membership).toBeNull();
    }
  });
  it('compensates a failed owner-membership write instead of leaving an orphan team', async () => {
    const create = vi
      .spyOn(Membership, 'create')
      .mockRejectedValueOnce(new Error('Write failed'));
    const result = await owner
      .post('/api/v1/teams')
      .set('Origin', origin)
      .send({ name: 'Failed team' });
    create.mockRestore();
    expect(result.status).toBe(500);
    expect(await Team.exists({ name: 'Failed team' })).toBeNull();
  });
});
