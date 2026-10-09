import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { MongoMemoryReplSet } from 'mongodb-memory-server';
import mongoose from 'mongoose';
import request from 'supertest';
import jwt from 'jsonwebtoken';
import { app } from '../src/app.js';
import { User } from '../src/modules/auth/user.model.js';

let mongo: MongoMemoryReplSet;
const origin = 'http://localhost:5173';
const account = {
  name: 'Alex Morgan',
  email: 'Alex@Example.com',
  password: 'correct-password-123',
};
beforeAll(async () => {
  mongo = await MongoMemoryReplSet.create({ replSet: { count: 1 } });
  await mongoose.connect(mongo.getUri());
  await User.init();
});
afterAll(async () => {
  await mongoose.disconnect();
  await mongo?.stop();
});
describe('Authentication boundary', () => {
  it('reports database health', async () => {
    const res = await request(app).get('/health');
    expect(res.status).toBe(200);
    expect(res.body.data.database).toBe('connected');
  });
  it('requires an authenticated session', async () => {
    expect((await request(app).get('/api/v1/auth/me')).status).toBe(401);
  });
  it('rejects mutation requests with a missing or untrusted origin', async () => {
    for (const value of [
      undefined,
      'https://attacker.example',
      'http://localhost:5174',
      'http://127.0.0.1:5174',
      'null',
    ]) {
      const req = request(app).post('/api/v1/auth/register');
      if (value) req.set('Origin', value);
      expect((await req.send(account)).status).toBe(403);
    }
  });
  it('accepts both local frontend origins for mutations and CORS preflight', async () => {
    for (const value of [origin, 'http://127.0.0.1:5173']) {
      const mutation = await request(app)
        .post('/api/v1/auth/login')
        .set('Origin', value)
        .send({});
      expect(mutation.status).toBe(400);
      expect(mutation.body.error.code).toBe('VALIDATION_ERROR');
      expect(mutation.headers['access-control-allow-origin']).toBe(value);
      const preflight = await request(app)
        .options('/api/v1/auth/login')
        .set('Origin', value)
        .set('Access-Control-Request-Method', 'POST');
      expect(preflight.status).toBe(204);
      expect(preflight.headers['access-control-allow-origin']).toBe(value);
      expect(preflight.headers['access-control-allow-credentials']).toBe(
        'true',
      );
    }
    const untrusted = await request(app)
      .options('/api/v1/auth/login')
      .set('Origin', 'https://attacker.example')
      .set('Access-Control-Request-Method', 'POST');
    expect(untrusted.headers['access-control-allow-origin']).toBeUndefined();
  });
  it('validates registration and bcrypt byte limits', async () => {
    const res = await request(app)
      .post('/api/v1/auth/register')
      .set('Origin', origin)
      .send({ name: 'A', email: 'invalid', password: 'short' });
    expect(res.status).toBe(400);
    expect(
      res.body.error.details.map((item: { field: string }) => item.field),
    ).toEqual(expect.arrayContaining(['name', 'email', 'password']));
    const long = await request(app)
      .post('/api/v1/auth/register')
      .set('Origin', origin)
      .send({ ...account, password: '😀'.repeat(20) });
    expect(long.status).toBe(400);
  });
  it('registers, normalizes email, hashes passwords, and sets a scoped HttpOnly cookie', async () => {
    const agent = request.agent(app);
    const res = await agent
      .post('/api/v1/auth/register')
      .set('Origin', origin)
      .send(account);
    expect(res.status).toBe(201);
    expect(res.body.data).toMatchObject({
      id: expect.any(String),
      name: account.name,
      email: 'alex@example.com',
    });
    const cookie = res.headers['set-cookie'][0];
    expect(cookie).toContain('HttpOnly');
    expect(cookie).toContain('SameSite=Lax');
    expect(cookie).toContain('Path=/api/v1');
    const user = await User.findOne({ email: 'alex@example.com' }).select(
      '+passwordHash',
    );
    expect(user?.passwordHash).not.toBe(account.password);
    expect(user?.passwordHash).toMatch(/^\$2/);
    expect((await agent.get('/api/v1/auth/me')).body.data.email).toBe(
      'alex@example.com',
    );
  });
  it('rejects duplicate accounts case-insensitively', async () => {
    const res = await request(app)
      .post('/api/v1/auth/register')
      .set('Origin', origin)
      .send({ ...account, email: 'ALEX@EXAMPLE.COM' });
    expect(res.status).toBe(409);
  });
  it('uses the same generic failure for unknown users and wrong passwords', async () => {
    const results = [];
    for (const email of ['alex@example.com', 'nobody@example.com']) {
      const res = await request(app)
        .post('/api/v1/auth/login')
        .set('Origin', origin)
        .send({ email, password: 'wrong-password' });
      expect(res.status).toBe(401);
      results.push(res.body);
    }
    expect(results[0]).toEqual(results[1]);
  });
  it('logs in and invalidates copied tokens on logout', async () => {
    const agent = request.agent(app);
    const login = await agent
      .post('/api/v1/auth/login')
      .set('Origin', origin)
      .send({ email: account.email, password: account.password });
    expect(login.status).toBe(200);
    const stolenCookie = login.headers['set-cookie'][0].split(';')[0];
    expect((await agent.get('/api/v1/auth/me')).status).toBe(200);
    expect(
      (await agent.post('/api/v1/auth/logout').set('Origin', origin)).status,
    ).toBe(204);
    expect((await agent.get('/api/v1/auth/me')).status).toBe(401);
    expect(
      (await request(app).get('/api/v1/auth/me').set('Cookie', stolenCookie))
        .status,
    ).toBe(401);
  });
  it('rejects tampered and expired sessions', async () => {
    const user = await User.findOne();
    const expired = jwt.sign({ version: 0 }, process.env.SESSION_SECRET!, {
      subject: user!.id,
      expiresIn: -1,
      issuer: 'team-task-planner',
      audience: 'planner-web',
    });
    for (const token of ['not-a-jwt', expired]) {
      expect(
        (
          await request(app)
            .get('/api/v1/auth/me')
            .set('Cookie', `planner_session=${token}`)
        ).status,
      ).toBe(401);
    }
  });
  it('returns structured errors for malformed JSON and unknown routes', async () => {
    const malformed = await request(app)
      .post('/api/v1/auth/login')
      .set('Origin', origin)
      .set('Content-Type', 'application/json')
      .send('{');
    expect(malformed.status).toBe(400);
    expect(malformed.body.error.code).toBe('INVALID_JSON');
    expect((await request(app).get('/missing')).status).toBe(404);
  });
});
