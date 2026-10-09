import { beforeAll, afterAll, describe, it, expect, vi } from 'vitest';
import { MongoMemoryReplSet } from 'mongodb-memory-server';
import mongoose from 'mongoose';
import request from 'supertest';
import { app } from '../src/app.js';
import { Task } from '../src/modules/tasks/task.model.js';
import { User } from '../src/modules/auth/user.model.js';
import { Membership } from '../src/modules/memberships/membership.model.js';
import { Activity } from '../src/modules/activity/activity.model.js';
import { AssignmentCleanup } from '../src/modules/teams/cleanup.model.js';
import { runCleanup } from '../src/modules/teams/cleanup.service.js';
import { MongoLimitStore, LimitBucket } from '../src/middleware/sharedLimit.js';
import {
  models,
  migrate,
  auditInvariants,
  retain,
} from '../src/admin/maintenance.js';
const origin = 'http://localhost:5173';
const owner = request.agent(app),
  member = request.agent(app);
let mongo: MongoMemoryReplSet,
  team: string,
  memberId: string,
  recoveryCode: string;
const root = () => `/api/v1/teams/${team}/tasks`;
beforeAll(async () => {
  mongo = await MongoMemoryReplSet.create({ replSet: { count: 1 } });
  await mongoose.connect(mongo.getUri());
  for (const model of models) await model.init();
  const registered = await owner
    .post('/api/v1/auth/register')
    .set('Origin', origin)
    .send({
      name: 'Celestial',
      email: 'celestial@example.test',
      password: 'secure-password-123',
    });
  expect(registered.status).toBe(201);
  recoveryCode = registered.body.data.recoveryCode;
  const second = await member
    .post('/api/v1/auth/register')
    .set('Origin', origin)
    .send({
      name: 'Commoner',
      email: 'commoner@example.test',
      password: 'secure-password-123',
    });
  memberId = second.body.data.id;
  team = (
    await owner
      .post('/api/v1/teams')
      .set('Origin', origin)
      .send({ name: 'Reliability crew' })
  ).body.data.id;
  await Membership.create({ team, user: memberId, role: 'member' });
});
afterAll(async () => {
  await mongoose.disconnect();
  await mongo?.stop();
});
describe('Reliability acceptance checks', () => {
  it('does not count the entire history for a latest-activity preview', async () => {
    const count = vi.spyOn(Activity, 'countDocuments');
    try {
      expect(
        (await owner.get(`/api/v1/teams/${team}/activity?limit=1&count=false`))
          .status,
      ).toBe(200);
      expect(count).not.toHaveBeenCalled();
    } finally {
      count.mockRestore();
    }
  });
  it('returns one mission and one set of events for duplicate concurrent creation keys', async () => {
    const calls = await Promise.all(
      [1, 2].map(() =>
        owner
          .post(root())
          .set('Origin', origin)
          .set('Idempotency-Key', 'same-mission-request-123')
          .send({ title: 'One mission' }),
      ),
    );
    expect(calls.map((c) => c.status)).toEqual([201, 201]);
    expect(calls[0].body.data.id).toBe(calls[1].body.data.id);
    expect(await Task.countDocuments({ team, title: 'One mission' })).toBe(1);
    expect(await Activity.countDocuments({ task: calls[0].body.data.id })).toBe(
      1,
    );
    expect(
      (
        await owner
          .post(root())
          .set('Origin', origin)
          .set('Idempotency-Key', 'same-mission-request-123')
          .send({ title: 'Different content' })
      ).status,
    ).toBe(409);
  });
  it('deduplicates concurrent team creation and comment creation', async () => {
    const crews = await Promise.all(
      [1, 2].map(() =>
        owner
          .post('/api/v1/teams')
          .set('Origin', origin)
          .set('Idempotency-Key', 'same-team-request-123')
          .send({ name: 'Only one crew' }),
      ),
    );
    expect(crews.map((c) => c.status)).toEqual([201, 201]);
    expect(crews[0].body.data.id).toBe(crews[1].body.data.id);
    const mission = await Task.findOne({ team, title: 'One mission' });
    const comments = await Promise.all(
      [1, 2].map(() =>
        member
          .post(`${root()}/${mission!.id}/comments`)
          .set('Origin', origin)
          .set('Idempotency-Key', 'same-comment-request-123')
          .send({ body: 'One comment' }),
      ),
    );
    expect(comments.map((c) => c.status)).toEqual([201, 201]);
    expect(comments[0].body.data.id).toBe(comments[1].body.data.id);
  });
  it('requires versions and accepts maximum valid Unicode descriptions', async () => {
    const created = await owner
      .post(root())
      .set('Origin', origin)
      .send({ title: 'Unicode', description: '界'.repeat(10000) });
    expect(created.status).toBe(201);
    expect(
      (
        await owner
          .patch(`${root()}/${created.body.data.id}`)
          .set('Origin', origin)
          .send({ title: 'Unsafe stale write' })
      ).status,
    ).toBe(400);
    expect(
      (
        await owner
          .delete(`${root()}/${created.body.data.id}`)
          .set('Origin', origin)
      ).status,
    ).toBe(400);
  });
  it('rolls back the mission if the transactional activity write fails', async () => {
    const failure = vi
      .spyOn(Activity, 'insertMany')
      .mockRejectedValueOnce(new Error('Activity write failed'));
    const result = await owner
      .post(root())
      .set('Origin', origin)
      .send({ title: 'Must roll back' });
    failure.mockRestore();
    expect(result.status).toBe(500);
    expect(await Task.exists({ team, title: 'Must roll back' })).toBeNull();
  });
  it('paginates by cursor without duplicates after an intervening insertion', async () => {
    for (let i = 0; i < 4; i++)
      await owner
        .post(root())
        .set('Origin', origin)
        .send({ title: `Page mission ${i}` });
    const first = await owner.get(root()).query({ limit: 2 });
    expect(first.body.data.nextCursor).toBeTruthy();
    await owner
      .post(root())
      .set('Origin', origin)
      .send({ title: 'New arrival' });
    const second = await owner
      .get(root())
      .query({ limit: 2, cursor: first.body.data.nextCursor });
    expect(second.status).toBe(200);
    expect(
      second.body.data.items.every(
        (item: { id: string }) =>
          !first.body.data.items.some(
            (prior: { id: string }) => prior.id === item.id,
          ),
      ),
    ).toBe(true);
    expect(
      (await owner.get(root()).query({ cursor: 'not-a-valid-cursor' })).status,
    ).toBe(400);
  });
  it('shares atomic rate-limit counters across independent store instances', async () => {
    const first = new MongoLimitStore('shared-test'),
      second = new MongoLimitStore('shared-test');
    const hits = await Promise.all([
      first.increment('account'),
      second.increment('account'),
    ]);
    expect(hits.map((h) => h.totalHits).sort()).toEqual([1, 2]);
    await second.decrement('account');
    expect((await first.increment('account')).totalHits).toBe(2);
    expect(await LimitBucket.countDocuments()).toBeGreaterThan(0);
  });
  it('bounds member matches instead of downloading every member page', async () => {
    const found = await owner
      .get(`/api/v1/teams/${team}/members`)
      .query({ q: 'Commoner', limit: 100 });
    expect(found.status).toBe(200);
    expect(found.body.data.items.map((u: { id: string }) => u.id)).toEqual([
      memberId,
    ]);
    expect(
      (await owner.get(`/api/v1/teams/${team}/members`).query({ q: '[.*]' }))
        .body.data.total,
    ).toBe(0);
  });
  it('provides a cursor for opening the last comment page without a deep offset', async () => {
    const mission = await Task.findOne({ team, title: 'One mission' });
    const path = `${root()}/${mission!.id}/comments`;
    for (let i = 0; i < 4; i++)
      expect(
        (
          await member
            .post(path)
            .set('Origin', origin)
            .send({ body: `Cursor comment ${i}` })
        ).status,
      ).toBe(201);
    const first = await owner.get(path).query({ limit: 2 });
    expect(first.body.data.lastCursor).toBeTruthy();
    const last = await owner
      .get(path)
      .query({ limit: 2, cursor: first.body.data.lastCursor });
    expect(last.status).toBe(200);
    expect(last.body.data.items.at(-1).body).toBe('Cursor comment 3');
    expect(last.body.data.items).toHaveLength(1);
  });
  it('persists failed assignment cleanup and resumes it after restart', async () => {
    const created = await owner
      .post(root())
      .set('Origin', origin)
      .send({ title: 'Cleanup survivor', assigneeId: memberId });
    const failure = vi
      .spyOn(Task, 'updateOne')
      .mockRejectedValueOnce(new Error('Interrupted batch'));
    const removed = await owner
      .delete(`/api/v1/teams/${team}/members/${memberId}`)
      .set('Origin', origin);
    failure.mockRestore();
    expect(removed.status).toBe(500);
    expect(await Membership.exists({ team, user: memberId })).toBeNull();
    const job = await AssignmentCleanup.findOne({ team, user: memberId });
    expect(job).not.toBeNull();
    await runCleanup(job!.id);
    expect((await Task.findById(created.body.data.id))?.assignee).toBeNull();
    expect(await AssignmentCleanup.exists({ _id: job!._id })).toBeNull();
    expect((await member.get(root())).status).toBe(403);
  });
  it('makes migration replay safe, preserves retained history, and reports invariants', async () => {
    const count = await Activity.countDocuments();
    await migrate();
    await migrate();
    expect(await Activity.countDocuments()).toBe(count);
    expect(await auditInvariants()).toEqual({
      missingOwnerMemberships: 0,
      staleAssignments: 0,
      pendingCleanupJobs: 0,
    });
    expect(await retain()).toMatchObject({ oldDeletedMissions: 0 });
  });
  it('recovers the same Celestial account, invalidates sessions, and consumes the old code exactly once', async () => {
    const result = await request(app)
      .post('/api/v1/auth/recover')
      .set('Origin', origin)
      .send({
        email: 'celestial@example.test',
        password: 'replacement-password-123',
        recoveryCode,
      });
    expect(result.status).toBe(200);
    expect(result.body.data.recoveryCode).not.toBe(recoveryCode);
    expect((await owner.get('/api/v1/auth/me')).status).toBe(401);
    expect(
      (
        await request(app)
          .post('/api/v1/auth/recover')
          .set('Origin', origin)
          .send({
            email: 'celestial@example.test',
            password: 'another-password-123',
            recoveryCode,
          })
      ).status,
    ).toBe(400);
    expect(
      (
        await owner.post('/api/v1/auth/login').set('Origin', origin).send({
          email: 'celestial@example.test',
          password: 'replacement-password-123',
        })
      ).status,
    ).toBe(200);
    expect((await owner.get(`/api/v1/teams/${team}`)).body.data.role).toBe(
      'owner',
    );
    const user = await User.findOne({ email: 'celestial@example.test' }).select(
      '+recoveryHash',
    );
    expect(user?.recoveryHash).not.toBe(result.body.data.recoveryCode);
  });
  it('requires current-password confirmation before rotating a recovery code', async () => {
    expect(
      (
        await owner
          .post('/api/v1/auth/recovery-code')
          .set('Origin', origin)
          .send({ password: 'wrong-password' })
      ).status,
    ).toBe(401);
    expect(
      (
        await owner
          .post('/api/v1/auth/recovery-code')
          .set('Origin', origin)
          .send({ password: 'replacement-password-123' })
      ).body.data.recoveryCode,
    ).toMatch(/^[a-f\d]{64}$/);
  });
});
