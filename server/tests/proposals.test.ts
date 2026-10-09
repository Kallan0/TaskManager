import { beforeAll, afterAll, describe, it, expect } from 'vitest';
import { MongoMemoryReplSet } from 'mongodb-memory-server';
import mongoose from 'mongoose';
import request from 'supertest';
import { app } from '../src/app.js';
import { User } from '../src/modules/auth/user.model.js';
import { Team } from '../src/modules/teams/team.model.js';
import { Membership } from '../src/modules/memberships/membership.model.js';
import { Task } from '../src/modules/tasks/task.model.js';
import { TaskComment } from '../src/modules/comments/comment.model.js';
const origin = 'http://localhost:5173';
const owner = request.agent(app),
  knight = request.agent(app),
  member = request.agent(app),
  outsider = request.agent(app);
let mongo: MongoMemoryReplSet,
  teamId: string,
  otherTeam: string,
  knightId: string,
  memberId: string,
  proposal: { id: string; version: number };
const root = () => `/api/v1/teams/${teamId}/tasks`;
beforeAll(async () => {
  mongo = await MongoMemoryReplSet.create({ replSet: { count: 1 } });
  await mongoose.connect(mongo.getUri());
  await Promise.all([
    User.init(),
    Team.init(),
    Membership.init(),
    Task.init(),
    TaskComment.init(),
  ]);
  for (const [agent, name] of [
    [owner, 'Celestial'],
    [knight, 'Knight'],
    [member, 'Commoner'],
    [outsider, 'Outsider'],
  ] as const)
    expect(
      (
        await agent
          .post('/api/v1/auth/register')
          .set('Origin', origin)
          .send({
            name,
            email: `${name}@example.com`,
            password: 'secure-password-123',
          })
      ).status,
    ).toBe(201);
  knightId = (await knight.get('/api/v1/auth/me')).body.data.id;
  memberId = (await member.get('/api/v1/auth/me')).body.data.id;
  teamId = (
    await owner
      .post('/api/v1/teams')
      .set('Origin', origin)
      .send({ name: 'Proposal crew' })
  ).body.data.id;
  otherTeam = (
    await owner
      .post('/api/v1/teams')
      .set('Origin', origin)
      .send({ name: 'Other crew' })
  ).body.data.id;
  await Membership.create([
    { team: teamId, user: knightId, role: 'admin' },
    { team: teamId, user: memberId, role: 'member' },
  ]);
});
afterAll(async () => {
  await mongoose.disconnect();
  await mongo?.stop();
});
describe('Celestial mission approval', () => {
  it('only lets the Celestial directly create missions', async () => {
    expect(
      (
        await owner
          .post(root())
          .set('Origin', origin)
          .send({ title: 'Direct mission' })
      ).status,
    ).toBe(201);
    for (const agent of [knight, member, outsider])
      expect(
        (
          await agent
            .post(root())
            .set('Origin', origin)
            .send({ title: 'Unauthorized mission' })
        ).status,
      ).toBe(403);
  });
  it('only lets Holy Knights propose and validates initial status and spoofed approval', async () => {
    for (const agent of [owner, member, outsider])
      expect(
        (
          await agent
            .post(`${root()}/proposals`)
            .set('Origin', origin)
            .send({ title: 'Not permitted' })
        ).status,
      ).toBe(403);
    for (const body of [
      { title: 'Invalid', status: 'done' },
      { title: 'Spoof', approvalStatus: 'approved' },
      {
        title: 'Invalid dates',
        startDate: '2026-10-12',
        dueDate: '2026-10-11',
      },
    ])
      expect(
        (
          await knight
            .post(`${root()}/proposals`)
            .set('Origin', origin)
            .send(body)
        ).status,
      ).toBe(400);
    const result = await knight
      .post(`${root()}/proposals`)
      .set('Origin', origin)
      .send({
        title: 'Proposed expedition',
        assigneeId: memberId,
        priority: 'high',
      });
    expect(result.status).toBe(201);
    proposal = result.body.data;
    expect(result.body.data).toMatchObject({
      approvalStatus: 'pending',
      status: 'todo',
      canEdit: false,
      canChangeStatus: false,
      canDelete: false,
      canReview: false,
    });
  });
  it('keeps pending proposals out of mission views, totals and Commoner activity or discussion', async () => {
    for (const agent of [owner, knight, member])
      expect((await agent.get(root())).body.data.total).toBe(1);
    expect((await member.get(`${root()}/summary`)).body.data.total).toBe(1);
    expect(
      (await owner.get(root()).query({ approval: 'pending' })).body.data
        .items[0].canReview,
    ).toBe(true);
    expect(
      (await knight.get(root()).query({ approval: 'pending' })).body.data.total,
    ).toBe(1);
    expect(
      (await member.get(root()).query({ approval: 'pending' })).status,
    ).toBe(403);
    expect((await member.get(`${root()}/${proposal.id}`)).status).toBe(404);
    expect((await member.get(`${root()}/${proposal.id}/activity`)).status).toBe(
      404,
    );
    expect(
      (
        await member.get(`/api/v1/teams/${teamId}/activity`)
      ).body.data.items.some(
        (item: { type: string }) => item.type === 'MISSION_PROPOSED',
      ),
    ).toBe(false);
    for (const agent of [member, knight, owner])
      expect(
        (
          await agent
            .post(`${root()}/${proposal.id}/comments`)
            .set('Origin', origin)
            .send({ body: 'Not approved yet' })
        ).status,
      ).toBe(404);
  });
  it('only lets the Celestial review and enforces scope and current version', async () => {
    for (const agent of [knight, member, outsider])
      expect(
        (
          await agent
            .post(`${root()}/${proposal.id}/review`)
            .set('Origin', origin)
            .send({ decision: 'approved', version: proposal.version })
        ).status,
      ).toBe(403);
    expect(
      (
        await owner
          .post(`/api/v1/teams/${otherTeam}/tasks/${proposal.id}/review`)
          .set('Origin', origin)
          .send({ decision: 'approved', version: proposal.version })
      ).status,
    ).toBe(404);
    expect(
      (
        await owner
          .post(`${root()}/${proposal.id}/review`)
          .set('Origin', origin)
          .send({ decision: 'approved', version: 99 })
      ).status,
    ).toBe(409);
    expect(
      (
        await owner
          .post(`${root()}/${proposal.id}/review`)
          .set('Origin', origin)
          .send({ decision: 'approved' })
      ).status,
    ).toBe(400);
  });
  it('activates an approved proposal and permits Commoner comments without management rights', async () => {
    const result = await owner
      .post(`${root()}/${proposal.id}/review`)
      .set('Origin', origin)
      .send({ decision: 'approved', version: proposal.version });
    expect(result.status).toBe(200);
    expect(result.body.data).toMatchObject({
      approvalStatus: 'approved',
      canEdit: true,
      canChangeStatus: true,
      canReview: false,
    });
    expect(result.body.data.reviewedAt).toBeTruthy();
    expect((await member.get(root())).body.data.total).toBe(2);
    expect((await member.get(`${root()}/summary`)).body.data.total).toBe(2);
    expect(
      (
        await member
          .post(`${root()}/${proposal.id}/comments`)
          .set('Origin', origin)
          .send({ body: 'Ready for this mission' })
      ).status,
    ).toBe(201);
    for (const agent of [knight, member]) {
      const mission = (await agent.get(`${root()}/${proposal.id}`)).body.data;
      expect(mission).toMatchObject({
        canEdit: false,
        canDelete: false,
        canChangeStatus: false,
      });
      for (const [suffix, body] of [
        ['', { title: 'Overwrite' }],
        ['/status', { status: 'done' }],
        ['/assignee', { assigneeId: null }],
      ] as const)
        expect(
          (
            await agent
              .patch(`${root()}/${proposal.id}${suffix}`)
              .set('Origin', origin)
              .send({ ...body, version: proposal.version })
          ).status,
        ).toBe(403);
      expect(
        (
          await agent
            .delete(`${root()}/${proposal.id}?version=${proposal.version}`)
            .set('Origin', origin)
        ).status,
      ).toBe(403);
    }
    expect(
      (
        await owner
          .patch(`${root()}/${proposal.id}/status`)
          .set('Origin', origin)
          .send({ status: 'done', version: result.body.data.version })
      ).status,
    ).toBe(200);
    expect(
      (
        await owner
          .post(`${root()}/${proposal.id}/review`)
          .set('Origin', origin)
          .send({ decision: 'rejected', version: result.body.data.version })
      ).status,
    ).toBe(409);
  });
  it('retains rejected proposals and their reason without exposing them to Commoners', async () => {
    const pending = (
      await knight
        .post(`${root()}/proposals`)
        .set('Origin', origin)
        .send({ title: 'Rejected plan' })
    ).body.data;
    const rejected = await owner
      .post(`${root()}/${pending.id}/review`)
      .set('Origin', origin)
      .send({
        decision: 'rejected',
        version: pending.version,
        reason: 'Need a clearer goal',
      });
    expect(rejected.status).toBe(200);
    expect(rejected.body.data).toMatchObject({
      approvalStatus: 'rejected',
      rejectionReason: 'Need a clearer goal',
      canReview: false,
      canEdit: false,
    });
    expect(
      (await knight.get(root()).query({ approval: 'rejected' })).body.data
        .total,
    ).toBe(1);
    expect((await member.get(`${root()}/${pending.id}`)).status).toBe(404);
    expect(
      (
        await member.get(`/api/v1/teams/${teamId}/activity`)
      ).body.data.items.some(
        (item: { type: string }) => item.type === 'MISSION_REJECTED',
      ),
    ).toBe(false);
  });
  it('commits only one competing approval or rejection', async () => {
    const pending = (
      await knight
        .post(`${root()}/proposals`)
        .set('Origin', origin)
        .send({ title: 'Review race' })
    ).body.data;
    const results = await Promise.all(
      ['approved', 'rejected'].map((decision) =>
        owner
          .post(`${root()}/${pending.id}/review`)
          .set('Origin', origin)
          .send({ decision, version: pending.version }),
      ),
    );
    expect(results.map((result) => result.status).sort()).toEqual([200, 409]);
    const saved = await Task.findById(pending.id);
    expect(
      saved?.history.filter((item) =>
        ['MISSION_APPROVED', 'MISSION_REJECTED'].includes(item.type),
      ).length,
    ).toBe(1);
  });
  it('preserves approved legacy missions without an approval field and revokes proposal rights after demotion', async () => {
    const old = await Task.create({
      team: teamId,
      createdBy: memberId,
      title: 'Legacy mission',
    });
    await Task.collection.updateOne(
      { _id: old._id },
      { $unset: { approvalStatus: '' } },
    );
    expect((await member.get(`${root()}/${old.id}`)).body.data).toMatchObject({
      approvalStatus: 'approved',
      canEdit: false,
      canDelete: false,
    });
    expect(
      (await member.get(root()).query({ q: 'Legacy mission' })).body.data.total,
    ).toBe(1);
    await Membership.updateOne(
      { team: teamId, user: knightId },
      { $set: { role: 'member' } },
    );
    expect(
      (
        await knight
          .post(`${root()}/proposals`)
          .set('Origin', origin)
          .send({ title: 'After demotion' })
      ).status,
    ).toBe(403);
  });
});
