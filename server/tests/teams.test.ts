import {
  beforeAll,
  beforeEach,
  afterAll,
  describe,
  it,
  expect,
  vi,
} from 'vitest';
import { MongoMemoryReplSet } from 'mongodb-memory-server';
import mongoose from 'mongoose';
import request from 'supertest';
import { app } from '../src/app.js';
import { User } from '../src/modules/auth/user.model.js';
import { Team } from '../src/modules/teams/team.model.js';
import { Membership } from '../src/modules/memberships/membership.model.js';
import { Invitation } from '../src/modules/invitations/invitation.model.js';
const origin = 'http://localhost:5173';
const owner = request.agent(app),
  member = request.agent(app),
  admin = request.agent(app),
  outsider = request.agent(app);
let mongo: MongoMemoryReplSet,
  teamId: string,
  ownerId: string,
  memberId: string,
  adminId: string;
beforeAll(async () => {
  mongo = await MongoMemoryReplSet.create({ replSet: { count: 1 } });
  await mongoose.connect(mongo.getUri());
  await Promise.all([
    User.init(),
    Team.init(),
    Membership.init(),
    Invitation.init(),
  ]);
  for (const [agent, name] of [
    [owner, 'Owner'],
    [member, 'Member'],
    [admin, 'Admin'],
    [outsider, 'Outsider'],
  ] as const)
    expect(
      (
        await agent
          .post('/api/v1/auth/register')
          .set('Origin', origin)
          .send({
            name,
            email: name.toLowerCase() + '@example.com',
            password: 'secure-password-123',
          })
      ).status,
    ).toBe(201);
  ownerId = (await owner.get('/api/v1/auth/me')).body.data.id;
  memberId = (await member.get('/api/v1/auth/me')).body.data.id;
  adminId = (await admin.get('/api/v1/auth/me')).body.data.id;
});
beforeEach(async () => {
  const res = await owner
    .post('/api/v1/teams')
    .set('Origin', origin)
    .send({ name: 'Test crew', description: 'Build together' });
  expect(res.status).toBe(201);
  teamId = res.body.data.id;
});
afterAll(async () => {
  await mongoose.disconnect();
  await mongo?.stop();
});
async function invite(email = 'member@example.com', role = 'member') {
  const res = await owner
    .post(`/api/v1/teams/${teamId}/invitations`)
    .set('Origin', origin)
    .send({ email, role });
  expect(res.status).toBe(201);
  return { ...res.body.data, token: res.body.data.inviteUrl.split('/').pop() };
}
async function join(
  agent = member,
  email = 'member@example.com',
  role = 'member',
  userId = memberId,
) {
  const created = await invite(email, role);
  expect(
    (
      await agent
        .post(`/api/v1/invitations/${created.token}/accept`)
        .set('Origin', origin)
    ).body.data.status,
  ).toBe('requested');
  expect(
    (
      await owner
        .post(`/api/v1/teams/${teamId}/invitations/${created.id}/approve`)
        .set('Origin', origin)
        .send({ applicantId: userId })
    ).status,
  ).toBe(200);
  return created;
}
describe('Transactional crews and identity-confirmed links', () => {
  it('creates exactly one Celestial and scopes crew lists to membership', async () => {
    expect(
      await Membership.countDocuments({
        team: teamId,
        user: ownerId,
        role: 'owner',
      }),
    ).toBe(1);
    expect(
      (await owner.get('/api/v1/teams')).body.data.items.map(
        (t: { id: string }) => t.id,
      ),
    ).toContain(teamId);
    expect((await outsider.get('/api/v1/teams')).body.data.total).toBe(0);
  });
  it('rejects non-members, missing authentication, invalid IDs and invalid fields', async () => {
    expect((await request(app).get('/api/v1/teams')).status).toBe(401);
    for (const suffix of ['', '/members', '/invitations'])
      expect(
        (await outsider.get(`/api/v1/teams/${teamId}${suffix}`)).status,
      ).toBe(403);
    expect((await owner.get('/api/v1/teams/bad-id')).status).toBe(400);
    expect(
      (
        await owner
          .post('/api/v1/teams')
          .set('Origin', origin)
          .send({ name: ' ' })
      ).status,
    ).toBe(400);
    expect((await owner.get('/api/v1/teams?limit=101')).status).toBe(400);
  });
  it('requires link possession and Celestial confirmation, never discovering invitations from typed email', async () => {
    const created = await invite('MEMBER@EXAMPLE.COM');
    const stored = await Invitation.findById(created.id).select('+tokenHash');
    expect(stored?.tokenHash).toMatch(/^[a-f\d]{64}$/);
    expect(stored?.tokenHash).not.toBe(created.token);
    expect((await member.get('/api/v1/invitations')).body.data.total).toBe(0);
    expect(
      (
        await member
          .post(`/api/v1/invitations/by-id/${created.id}/accept`)
          .set('Origin', origin)
      ).status,
    ).toBe(404);
    expect(
      (await outsider.get(`/api/v1/invitations/${created.token}`)).status,
    ).toBe(404);
    expect(
      (
        await member
          .post(`/api/v1/invitations/${created.token}/accept`)
          .set('Origin', origin)
      ).body.data.status,
    ).toBe('requested');
    expect(
      await Membership.exists({ team: teamId, user: memberId }),
    ).toBeNull();
    expect((await member.get(`/api/v1/teams/${teamId}`)).status).toBe(403);
    expect(
      (await member.get('/api/v1/invitations')).body.data.items[0].status,
    ).toBe('requested');
    expect(
      (
        await owner
          .post(`/api/v1/teams/${teamId}/invitations/${created.id}/approve`)
          .set('Origin', origin)
          .send({ applicantId: memberId })
      ).status,
    ).toBe(200);
    expect((await member.get(`/api/v1/teams/${teamId}`)).body.data.role).toBe(
      'member',
    );
    const listed = await owner.get(`/api/v1/teams/${teamId}/invitations`);
    expect(JSON.stringify(listed.body)).not.toContain(created.token);
    expect(JSON.stringify(listed.body)).not.toContain('tokenHash');
  });
  it('blocks duplicate active links and requires approval of the specific applicant', async () => {
    const created = await invite();
    expect(
      (
        await owner
          .post(`/api/v1/teams/${teamId}/invitations`)
          .set('Origin', origin)
          .send({ email: 'member@example.com' })
      ).status,
    ).toBe(409);
    await member
      .post(`/api/v1/invitations/${created.token}/accept`)
      .set('Origin', origin);
    expect(
      (await owner.get(`/api/v1/teams/${teamId}/invitations`)).body.data
        .items[0].applicant.id,
    ).toBe(memberId);
    expect(
      (
        await owner
          .post(`/api/v1/teams/${teamId}/invitations/${created.id}/approve`)
          .set('Origin', origin)
          .send({ applicantId: adminId })
      ).status,
    ).toBe(409);
  });
  it('preserves manager permissions and protects Celestial ownership', async () => {
    await join();
    await join(admin, 'admin@example.com', 'admin', adminId);
    expect(
      (
        await member
          .patch(`/api/v1/teams/${teamId}`)
          .set('Origin', origin)
          .send({ name: 'Attack' })
      ).status,
    ).toBe(403);
    expect(
      (
        await admin
          .patch(`/api/v1/teams/${teamId}`)
          .set('Origin', origin)
          .send({ description: 'Updated' })
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
      (await member.get(`/api/v1/teams/${teamId}/members`)).body.data.total,
    ).toBe(3);
  });
  it('does not grant access through expired, revoked or declined links', async () => {
    const expired = await invite();
    await Invitation.updateOne(
      { _id: expired.id },
      { $set: { expiresAt: new Date(Date.now() - 1000) } },
    );
    expect(
      (
        await member
          .post(`/api/v1/invitations/${expired.token}/accept`)
          .set('Origin', origin)
      ).status,
    ).toBe(409);
    const revoked = await invite();
    expect(
      (
        await owner
          .delete(`/api/v1/teams/${teamId}/invitations/${revoked.id}`)
          .set('Origin', origin)
      ).status,
    ).toBe(204);
    expect(
      (
        await member
          .post(`/api/v1/invitations/${revoked.token}/accept`)
          .set('Origin', origin)
      ).status,
    ).toBe(409);
    const declined = await invite();
    expect(
      (
        await member
          .post(`/api/v1/invitations/${declined.token}/decline`)
          .set('Origin', origin)
      ).body.data.status,
    ).toBe('declined');
    expect(
      await Membership.exists({ team: teamId, user: memberId }),
    ).toBeNull();
  });
  it('serializes requests/approval and prevents accepted-link reuse after removal', async () => {
    const created = await invite();
    const requests = await Promise.all(
      [1, 2].map(() =>
        member
          .post(`/api/v1/invitations/${created.token}/accept`)
          .set('Origin', origin),
      ),
    );
    expect(requests.map((r) => r.status)).toEqual([200, 200]);
    const approvals = await Promise.all(
      [1, 2].map(() =>
        owner
          .post(`/api/v1/teams/${teamId}/invitations/${created.id}/approve`)
          .set('Origin', origin)
          .send({ applicantId: memberId }),
      ),
    );
    expect(approvals.map((r) => r.status).sort()).toEqual([200, 409]);
    expect(
      await Membership.countDocuments({ team: teamId, user: memberId }),
    ).toBe(1);
    await owner
      .delete(`/api/v1/teams/${teamId}/members/${memberId}`)
      .set('Origin', origin);
    expect(
      (
        await member
          .post(`/api/v1/invitations/${created.token}/accept`)
          .set('Origin', origin)
      ).status,
    ).toBe(409);
  });
  it('rolls back invitation approval after membership failure and permits retry', async () => {
    const created = await invite();
    await member
      .post(`/api/v1/invitations/${created.token}/accept`)
      .set('Origin', origin);
    const write = vi
      .spyOn(Membership, 'updateOne')
      .mockRejectedValueOnce(new Error('Write failed'));
    const result = await owner
      .post(`/api/v1/teams/${teamId}/invitations/${created.id}/approve`)
      .set('Origin', origin)
      .send({ applicantId: memberId });
    write.mockRestore();
    expect(result.status).toBe(500);
    expect((await Invitation.findById(created.id))?.status).toBe('requested');
    expect(
      await Membership.exists({ team: teamId, user: memberId }),
    ).toBeNull();
    expect(
      (
        await owner
          .post(`/api/v1/teams/${teamId}/invitations/${created.id}/approve`)
          .set('Origin', origin)
          .send({ applicantId: memberId })
      ).status,
    ).toBe(200);
  });
  it('serializes approval with revocation', async () => {
    const created = await invite();
    await member
      .post(`/api/v1/invitations/${created.token}/accept`)
      .set('Origin', origin);
    const [approved, revoked] = await Promise.all([
      owner
        .post(`/api/v1/teams/${teamId}/invitations/${created.id}/approve`)
        .set('Origin', origin)
        .send({ applicantId: memberId }),
      owner
        .delete(`/api/v1/teams/${teamId}/invitations/${created.id}`)
        .set('Origin', origin),
    ]);
    const saved = await Invitation.findById(created.id);
    expect(
      saved?.status === 'accepted' ? approved.status : revoked.status,
    ).toBe(saved?.status === 'accepted' ? 200 : 204);
    expect(!!(await Membership.exists({ team: teamId, user: memberId }))).toBe(
      saved?.status === 'accepted',
    );
  });
  it('rolls back team creation if owner membership creation fails', async () => {
    const create = vi
      .spyOn(Membership, 'create')
      .mockRejectedValueOnce(new Error('Write failed'));
    const result = await owner
      .post('/api/v1/teams')
      .set('Origin', origin)
      .send({ name: 'Failed crew' });
    create.mockRestore();
    expect(result.status).toBe(500);
    expect(await Team.exists({ name: 'Failed crew' })).toBeNull();
  });
});
