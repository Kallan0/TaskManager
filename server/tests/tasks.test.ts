import { beforeAll, afterAll, describe, it, expect } from 'vitest';
import { MongoMemoryReplSet } from 'mongodb-memory-server';
import mongoose from 'mongoose';
import request from 'supertest';
import { app } from '../src/app.js';
import { User } from '../src/modules/auth/user.model.js';
import { Team } from '../src/modules/teams/team.model.js';
import { Membership } from '../src/modules/memberships/membership.model.js';
import { Task } from '../src/modules/tasks/task.model.js';
const origin = 'http://localhost:5173';
const owner = request.agent(app),
  member = request.agent(app),
  outsider = request.agent(app);
let mongo: MongoMemoryReplSet,
  teamId: string,
  otherTeam: string,
  memberId: string,
  taskId: string,
  version: number;
const path = () => `/api/v1/teams/${teamId}/tasks`;
beforeAll(async () => {
  mongo = await MongoMemoryReplSet.create({ replSet: { count: 1 } });
  await mongoose.connect(mongo.getUri());
  await Promise.all([User.init(), Team.init(), Membership.init(), Task.init()]);
  for (const [agent, name] of [
    [owner, 'Owner'],
    [member, 'Member'],
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
  memberId = (await member.get('/api/v1/auth/me')).body.data.id;
  teamId = (
    await owner
      .post('/api/v1/teams')
      .set('Origin', origin)
      .send({ name: 'Tasks team' })
  ).body.data.id;
  otherTeam = (
    await owner
      .post('/api/v1/teams')
      .set('Origin', origin)
      .send({ name: 'Other team' })
  ).body.data.id;
  await Membership.create({ team: teamId, user: memberId, role: 'member' });
});
afterAll(async () => {
  await mongoose.disconnect();
  await mongo?.stop();
});
describe('Persisted team tasks', () => {
  it('requires membership and validates fields and real dates', async () => {
    expect((await outsider.get(path())).status).toBe(403);
    for (const body of [
      { title: '' },
      { title: 'Invalid', status: 'unknown' },
      { title: 'Invalid', dueDate: '2026-02-30' },
      { title: 'Invalid', startDate: '2026-10-12', dueDate: '2026-10-11' },
      { title: 'Invalid', createdBy: memberId },
    ])
      expect(
        (await owner.post(path()).set('Origin', origin).send(body)).status,
      ).toBe(400);
    const foreign = (await outsider.get('/api/v1/auth/me')).body.data.id;
    expect(
      (
        await owner
          .post(path())
          .set('Origin', origin)
          .send({ title: 'Invalid assignment', assigneeId: foreign })
      ).status,
    ).toBe(400);
  });
  it('creates an assigned task with calendar dates and persistent history', async () => {
    const res = await owner.post(path()).set('Origin', origin).send({
      title: 'Ship [v1]',
      description: 'Database backed',
      priority: 'urgent',
      assigneeId: memberId,
      startDate: '2026-10-09',
      dueDate: '2026-10-12',
    });
    expect(res.status).toBe(201);
    taskId = res.body.data.id;
    version = res.body.data.version;
    expect(res.body.data).toMatchObject({
      title: 'Ship [v1]',
      assignee: { id: memberId, name: 'Member' },
      dueDate: '2026-10-12',
      canDelete: true,
      status: 'todo',
    });
    const saved = await Task.findById(taskId);
    expect(saved?.history.map((e) => e.type)).toEqual([
      'TASK_CREATED',
      'TASK_ASSIGNED',
    ]);
    expect((await member.get(`${path()}/${taskId}`)).body.data.canDelete).toBe(
      false,
    );
  });
  it('scopes every read, update and activity to its team', async () => {
    expect(
      (await owner.get(`/api/v1/teams/${otherTeam}/tasks/${taskId}`)).status,
    ).toBe(404);
    expect(
      (
        await owner
          .patch(`/api/v1/teams/${otherTeam}/tasks/${taskId}/status`)
          .set('Origin', origin)
          .send({ status: 'done', version })
      ).status,
    ).toBe(404);
    expect((await outsider.get(`${path()}/${taskId}/activity`)).status).toBe(
      403,
    );
  });
  it('restricts mission management to the Celestial and manages completion timestamps', async () => {
    expect(
      (
        await member
          .post(path())
          .set('Origin', origin)
          .send({ title: 'Not permitted' })
      ).status,
    ).toBe(403);
    for (const suffix of ['', '/status', '/assignee']) {
      const body =
        suffix === '/status'
          ? { status: 'done', version }
          : suffix === '/assignee'
            ? { assigneeId: memberId, version }
            : { title: 'Unauthorized edit', version };
      expect(
        (
          await member
            .patch(`${path()}/${taskId}${suffix}`)
            .set('Origin', origin)
            .send(body)
        ).status,
      ).toBe(403);
    }
    const done = await owner
      .patch(`${path()}/${taskId}/status`)
      .set('Origin', origin)
      .send({ status: 'done', version });
    expect(done.status).toBe(200);
    expect(done.body.data.completedAt).toBeTruthy();
    version = done.body.data.version;
    const reopened = await owner
      .patch(`${path()}/${taskId}/status`)
      .set('Origin', origin)
      .send({ status: 'in_progress', version });
    expect(reopened.status).toBe(200);
    expect(reopened.body.data.completedAt).toBeNull();
    version = reopened.body.data.version;
    expect(
      (
        await owner
          .patch(`${path()}/${taskId}`)
          .set('Origin', origin)
          .send({ startDate: '2026-10-13', version })
      ).status,
    ).toBe(400);
  });
  it('prevents stale edits and commits only one competing write', async () => {
    const results = await Promise.all(
      ['First edit', 'Second edit'].map((description) =>
        owner
          .patch(`${path()}/${taskId}`)
          .set('Origin', origin)
          .send({ description, version }),
      ),
    );
    expect(results.map((r) => r.status).sort()).toEqual([200, 409]);
    version = results.find((r) => r.status === 200)!.body.data.version;
    expect(
      (
        await owner
          .delete(`${path()}/${taskId}?version=${version - 1}`)
          .set('Origin', origin)
      ).status,
    ).toBe(409);
  });
  it('filters literal searches, assignments, dates and priority with pagination', async () => {
    for (const body of [
      { title: 'Past', priority: 'low', dueDate: '2026-10-08' },
      { title: 'Finished past', status: 'done', dueDate: '2026-10-08' },
      { title: 'No date', priority: 'high' },
      { title: 'Far away', dueDate: '2026-11-01' },
    ])
      expect(
        (await owner.post(path()).set('Origin', origin).send(body)).status,
      ).toBe(201);
    expect((await owner.get(path()).query({ q: '[v1]' })).body.data.total).toBe(
      1,
    );
    expect(
      (await owner.get(path()).query({ assignee: memberId })).body.data.total,
    ).toBe(1);
    expect(
      (
        await owner.get(path()).query({ due: 'overdue', today: '2026-10-09' })
      ).body.data.items.map((t: { title: string }) => t.title),
    ).toEqual(['Past']);
    expect(
      (
        await owner.get(path()).query({
          due: 'upcoming',
          today: '2026-10-09',
          dueAfter: '2026-10-01',
        })
      ).body.data.total,
    ).toBe(1);
    expect(
      (await owner.get(path()).query({ due: 'undated' })).body.data.total,
    ).toBe(1);
    const priority = await owner
      .get(path())
      .query({ sort: 'priority', limit: 2, page: 1 });
    expect(priority.body.data.items[0].priority).toBe('urgent');
    expect(priority.body.data.total).toBe(5);
    expect(priority.body.data.pages).toBe(3);
    expect((await owner.get(`${path()}/summary`)).body.data).toMatchObject({
      total: 5,
      todo: 3,
      in_progress: 1,
      done: 1,
    });
  });
  it('restricts deletion to the Celestial, including legacy member-created missions, and retains activity', async () => {
    expect(
      (
        await member
          .delete(`${path()}/${taskId}?version=${version}`)
          .set('Origin', origin)
      ).status,
    ).toBe(403);
    expect(
      (
        await owner
          .delete(`${path()}/${taskId}?version=${version}`)
          .set('Origin', origin)
      ).status,
    ).toBe(204);
    expect((await owner.get(`${path()}/${taskId}`)).status).toBe(404);
    expect((await owner.get(path())).body.data.total).toBe(4);
    const activity = await owner.get(`/api/v1/teams/${teamId}/activity`);
    expect(activity.body.data.items).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          type: 'TASK_DELETED',
          taskId,
          taskDeleted: true,
        }),
      ]),
    );
    const own = (
      await owner
        .post(path())
        .set('Origin', origin)
        .send({ title: 'Legacy member task' })
    ).body.data;
    await Task.updateOne({ _id: own.id }, { $set: { createdBy: memberId } });
    expect(
      (
        await member
          .delete(`${path()}/${own.id}?version=${own.version}`)
          .set('Origin', origin)
      ).status,
    ).toBe(403);
    expect(
      (
        await owner
          .delete(`${path()}/${own.id}?version=${own.version}`)
          .set('Origin', origin)
      ).status,
    ).toBe(204);
  });
  it('clears assignment and records an event when a member is removed', async () => {
    const assigned = (
      await owner
        .post(path())
        .set('Origin', origin)
        .send({ title: 'Reassign me', assigneeId: memberId })
    ).body.data;
    expect(
      (
        await owner
          .delete(`/api/v1/teams/${teamId}/members/${memberId}`)
          .set('Origin', origin)
      ).status,
    ).toBe(204);
    const refreshed = (await owner.get(`${path()}/${assigned.id}`)).body.data;
    expect(refreshed.assigneeId).toBeNull();
    expect(refreshed.version).toBe(assigned.version + 1);
    const activity = (await owner.get(`${path()}/${assigned.id}/activity`)).body
      .data.items;
    expect(activity).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          type: 'TASK_ASSIGNED',
          changes: [{ field: 'assigneeId', from: memberId, to: null }],
        }),
      ]),
    );
    expect((await member.get(path())).status).toBe(403);
  });
});
