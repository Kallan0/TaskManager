import { beforeAll, afterAll, describe, it, expect } from 'vitest';
import { MongoMemoryServer } from 'mongodb-memory-server';
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
  author = request.agent(app),
  knight = request.agent(app),
  outsider = request.agent(app);
let mongo: MongoMemoryServer,
  teamId: string,
  taskId: string,
  otherTeam: string,
  otherTask: string,
  authorId: string,
  commentId: string,
  version: number;
const path = () => `/api/v1/teams/${teamId}/tasks/${taskId}/comments`;
beforeAll(async () => {
  mongo = await MongoMemoryServer.create();
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
    [author, 'Commoner'],
    [knight, 'Holy Knight'],
    [outsider, 'Outsider'],
  ] as const) {
    expect(
      (
        await agent
          .post('/api/v1/auth/register')
          .set('Origin', origin)
          .send({
            name,
            email: `${name.replaceAll(' ', '')}@example.com`,
            password: 'secure-password-123',
          })
      ).status,
    ).toBe(201);
  }
  authorId = (await author.get('/api/v1/auth/me')).body.data.id;
  const knightId = (await knight.get('/api/v1/auth/me')).body.data.id;
  teamId = (
    await owner
      .post('/api/v1/teams')
      .set('Origin', origin)
      .send({ name: 'Comment crew' })
  ).body.data.id;
  otherTeam = (
    await owner
      .post('/api/v1/teams')
      .set('Origin', origin)
      .send({ name: 'Other crew' })
  ).body.data.id;
  await Membership.create([
    { team: teamId, user: authorId, role: 'member' },
    { team: teamId, user: knightId, role: 'admin' },
  ]);
  taskId = (
    await owner
      .post(`/api/v1/teams/${teamId}/tasks`)
      .set('Origin', origin)
      .send({ title: 'Discuss mission' })
  ).body.data.id;
  otherTask = (
    await owner
      .post(`/api/v1/teams/${teamId}/tasks`)
      .set('Origin', origin)
      .send({ title: 'Another mission' })
  ).body.data.id;
});
afterAll(async () => {
  await mongoose.disconnect();
  await mongo?.stop();
});
describe('Mission discussions and moderation', () => {
  it('requires authentication, membership and matching mission references', async () => {
    expect((await request(app).get(path())).status).toBe(401);
    expect((await outsider.get(path())).status).toBe(403);
    expect(
      (
        await outsider
          .post(path())
          .set('Origin', origin)
          .send({ body: 'No access' })
      ).status,
    ).toBe(403);
    expect(
      (await owner.get(`/api/v1/teams/${otherTeam}/tasks/${taskId}/comments`))
        .status,
    ).toBe(404);
    expect(
      (await owner.get(`/api/v1/teams/${teamId}/tasks/invalid/comments`))
        .status,
    ).toBe(400);
  });
  it('validates nonempty bounded text and rejects forged authors', async () => {
    for (const body of [
      { body: '   ' },
      { body: 'x'.repeat(4001) },
      { body: 'Fake', author: authorId },
      {},
    ]) {
      expect(
        (await author.post(path()).set('Origin', origin).send(body)).status,
      ).toBe(400);
    }
    expect(await TaskComment.countDocuments()).toBe(0);
  });
  it('persists a comment and its event atomically without changing mission version', async () => {
    const result = await author
      .post(path())
      .set('Origin', origin)
      .send({ body: '  Ready to sail\nAny blockers?  ' });
    expect(result.status).toBe(201);
    commentId = result.body.data.id;
    version = result.body.data.version;
    expect(result.body.data).toMatchObject({
      body: 'Ready to sail\nAny blockers?',
      author: { id: authorId, name: 'Commoner' },
      canEdit: true,
      canDelete: true,
      editedAt: null,
    });
    expect(result.body.data.author.email).toBeUndefined();
    expect(result.body.data.history).toBeUndefined();
    const saved = await TaskComment.findById(commentId);
    expect(saved?.history[0]?.type).toBe('COMMENT_ADDED');
    expect((await Task.findById(taskId))?.__v).toBe(0);
    const viewed = (await knight.get(path())).body.data.items[0];
    expect(viewed.canEdit).toBe(false);
    expect(viewed.canDelete).toBe(true);
  });
  it('paginates chronologically and scopes comments to their mission', async () => {
    for (const body of ['Second update', '<script>alert("example")</script>'])
      expect(
        (await owner.post(path()).set('Origin', origin).send({ body })).status,
      ).toBe(201);
    const first = (await owner.get(path()).query({ limit: 2 })).body.data;
    expect(first.total).toBe(3);
    expect(first.pages).toBe(2);
    expect(first.items.map((item: { body: string }) => item.body)).toEqual([
      'Ready to sail\nAny blockers?',
      'Second update',
    ]);
    expect(
      (await owner.get(path()).query({ limit: 2, page: 2 })).body.data.items[0]
        .body,
    ).toContain('<script>');
    expect((await owner.get(path()).query({ page: 0 })).status).toBe(400);
    expect(
      (await owner.get(`/api/v1/teams/${teamId}/tasks/${otherTask}/comments`))
        .body.data.total,
    ).toBe(0);
    expect(
      (
        await owner
          .patch(
            `/api/v1/teams/${teamId}/tasks/${otherTask}/comments/${commentId}`,
          )
          .set('Origin', origin)
          .send({ body: 'Wrong mission' })
      ).status,
    ).toBe(404);
  });
  it('only permits the author to edit, including the global alias', async () => {
    for (const manager of [owner, knight])
      expect(
        (
          await manager
            .patch(`/api/v1/comments/${commentId}`)
            .set('Origin', origin)
            .send({ body: 'Changed by manager' })
        ).status,
      ).toBe(403);
    expect(
      (
        await outsider
          .patch(`/api/v1/comments/${commentId}`)
          .set('Origin', origin)
          .send({ body: 'Intrusion' })
      ).status,
    ).toBe(403);
    const edited = await author
      .patch(`/api/v1/comments/${commentId}`)
      .set('Origin', origin)
      .send({ body: 'Updated progress', version });
    expect(edited.status).toBe(200);
    expect(edited.body.data.editedAt).toBeTruthy();
    version = edited.body.data.version;
    const saved = await TaskComment.findById(commentId);
    expect(saved?.history.map((event) => event.type)).toEqual([
      'COMMENT_ADDED',
      'COMMENT_EDITED',
    ]);
  });
  it('rejects stale and competing edits and does not log a no-op', async () => {
    const noop = await author
      .patch(`${path()}/${commentId}`)
      .set('Origin', origin)
      .send({ body: 'Updated progress', version });
    expect(noop.body.data.version).toBe(version);
    expect((await TaskComment.findById(commentId))?.history.length).toBe(2);
    const results = await Promise.all(
      ['Competing A', 'Competing B'].map((body) =>
        author
          .patch(`${path()}/${commentId}`)
          .set('Origin', origin)
          .send({ body, version }),
      ),
    );
    expect(results.map((result) => result.status).sort()).toEqual([200, 409]);
    version = results.find((result) => result.status === 200)!.body.data
      .version;
    expect(
      (
        await author
          .delete(`${path()}/${commentId}?version=${version - 1}`)
          .set('Origin', origin)
      ).status,
    ).toBe(409);
  });
  it('allows author deletion and manager moderation while keeping activity free of bodies', async () => {
    const celestialComment = (
      await owner
        .post(path())
        .set('Origin', origin)
        .send({ body: 'Private body in comment only' })
    ).body.data;
    expect(
      (
        await author
          .delete(`${path()}/${celestialComment.id}`)
          .set('Origin', origin)
      ).status,
    ).toBe(403);
    expect(
      (
        await knight
          .delete(`${path()}/${celestialComment.id}`)
          .set('Origin', origin)
      ).status,
    ).toBe(204);
    expect(
      (
        await author
          .delete(`/api/v1/comments/${commentId}?version=${version}`)
          .set('Origin', origin)
      ).status,
    ).toBe(204);
    const removed = await TaskComment.findById(commentId);
    expect(removed?.body).toBe('');
    expect(removed?.deletedAt).toBeTruthy();
    const activity = await owner.get(
      `/api/v1/teams/${teamId}/tasks/${taskId}/activity`,
    );
    expect(activity.status).toBe(200);
    expect(activity.body.data.items).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ type: 'COMMENT_ADDED' }),
        expect.objectContaining({ type: 'COMMENT_EDITED' }),
        expect.objectContaining({
          type: 'COMMENT_DELETED',
          actor: { id: authorId, name: 'Commoner' },
        }),
      ]),
    );
    expect(JSON.stringify(activity.body)).not.toContain(
      'Private body in comment only',
    );
    expect(
      (await owner.get(`/api/v1/teams/${otherTeam}/activity`)).body.data.total,
    ).toBe(0);
    expect(
      (
        await author
          .patch(`/api/v1/comments/${commentId}`)
          .set('Origin', origin)
          .send({ body: 'Resurrect' })
      ).status,
    ).toBe(404);
  });
  it('revokes former members and blocks discussion on deleted missions', async () => {
    const own = (
      await author
        .post(path())
        .set('Origin', origin)
        .send({ body: 'Before removal' })
    ).body.data;
    expect(
      (
        await owner
          .delete(`/api/v1/teams/${teamId}/members/${authorId}`)
          .set('Origin', origin)
      ).status,
    ).toBe(204);
    expect((await author.get(path())).status).toBe(403);
    expect(
      (
        await author
          .patch(`/api/v1/comments/${own.id}`)
          .set('Origin', origin)
          .send({ body: 'After removal' })
      ).status,
    ).toBe(403);
    expect(
      (
        await owner
          .delete(`/api/v1/teams/${teamId}/tasks/${taskId}`)
          .set('Origin', origin)
      ).status,
    ).toBe(204);
    expect((await owner.get(path())).status).toBe(404);
    expect(
      (
        await owner
          .post(path())
          .set('Origin', origin)
          .send({ body: 'Too late' })
      ).status,
    ).toBe(404);
    expect(
      (await owner.delete(`/api/v1/comments/${own.id}`).set('Origin', origin))
        .status,
    ).toBe(404);
    const activity = (await owner.get(`/api/v1/teams/${teamId}/activity`)).body
      .data.items;
    expect(activity).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ type: 'COMMENT_ADDED', taskDeleted: true }),
      ]),
    );
  });
});
