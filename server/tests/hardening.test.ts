import express from 'express';
import request from 'supertest';
import { describe, expect, it, vi } from 'vitest';
import { app } from '../src/app.js';
import { createApiLimit } from '../src/middleware/apiLimit.js';
import { requestLog } from '../src/middleware/requestLog.js';
import { paginationSchema } from '../src/modules/teams/team.validation.js';

describe('API hardening', () => {
  it('limits repeated requests with a structured error and retry headers', async () => {
    const limited = express();
    limited.use(createApiLimit(2));
    limited.get('/', (_req, res) => res.json({ success: true }));
    expect((await request(limited).get('/')).status).toBe(200);
    expect((await request(limited).get('/')).status).toBe(200);
    const blocked = await request(limited).get('/');
    expect(blocked.status).toBe(429);
    expect(blocked.body.error.code).toBe('RATE_LIMITED');
    expect(blocked.headers['retry-after']).toBeDefined();
    expect(blocked.headers.ratelimit).toBeDefined();
  });

  it('does not let a client bypass the limit with a spoofed forwarded IP', async () => {
    const limited = express();
    limited.use(createApiLimit(1));
    limited.get('/', (_req, res) => res.end());
    await request(limited).get('/');
    // Forwarded headers are ignored when the default direct-access configuration is used.
    const warning = vi.spyOn(console, 'error').mockImplementation(() => {});
    try {
      expect(
        (await request(limited).get('/').set('X-Forwarded-For', '203.0.113.5'))
          .status,
      ).toBe(429);
    } finally {
      warning.mockRestore();
    }
  });

  it('logs only request metadata and generates its own request ID', async () => {
    const logged = express();
    logged.use(requestLog);
    logged.post('/invitations/:token', (_req, res) => res.status(403).end());
    const info = vi.spyOn(console, 'info').mockImplementation(() => {});
    try {
      const response = await request(logged)
        .post('/invitations/private-token?email=private@example.com')
        .set('X-Request-ID', 'attacker-id')
        .set('Cookie', 'planner_session=secret-cookie')
        .send({ password: 'secret-password' });
      const entry = JSON.parse(info.mock.calls[0][0] as string);
      expect(entry).toEqual({
        event: 'http_request',
        requestId: response.headers['x-request-id'],
        method: 'POST',
        operation: 'invitations',
        status: 403,
        durationMs: expect.any(Number),
      });
      expect(entry.requestId).toMatch(/^[a-f\d-]{36}$/);
      expect(JSON.stringify(entry)).not.toMatch(/private|secret|attacker/);
    } finally {
      info.mockRestore();
    }
  });

  it('returns safe errors for malformed and oversized request bodies', async () => {
    const malformed = await request(app)
      .post('/api/v1/auth/login')
      .set('Origin', 'http://localhost:5173')
      .set('Content-Type', 'application/json')
      .send('{bad json');
    expect(malformed.status).toBe(400);
    expect(malformed.body.error.code).toBe('INVALID_JSON');
    const oversized = await request(app)
      .post('/api/v1/auth/login')
      .set('Origin', 'http://localhost:5173')
      .send({ password: 'x'.repeat(100000) });
    expect(oversized.status).toBe(413);
    expect(oversized.body.error.code).toBe('BODY_TOO_LARGE');
    expect(JSON.stringify(oversized.body)).not.toContain('stack');
  });

  it('sets security headers and preserves structured errors on unknown endpoints', async () => {
    const response = await request(app).get('/api/v1/unknown');
    expect(response.status).toBe(404);
    expect(response.body.error.code).toBe('NOT_FOUND');
    expect(response.headers['x-powered-by']).toBeUndefined();
    expect(response.headers['x-content-type-options']).toBe('nosniff');
    expect(response.headers['content-security-policy']).toBeDefined();
    expect(response.headers['x-request-id']).toBeDefined();
  });

  it('bounds pagination and rejects arrays and query operator objects', () => {
    expect(paginationSchema.parse({ page: '250', limit: '100' })).toEqual({
      page: 250,
      limit: 100,
    });
    for (const query of [
      { page: '251' },
      { page: '1e100' },
      { page: '-1' },
      { limit: '101' },
      { page: ['1', '2'] },
      { limit: { $gt: 0 } },
    ]) {
      expect(paginationSchema.safeParse(query).success).toBe(false);
    }
  });
});
