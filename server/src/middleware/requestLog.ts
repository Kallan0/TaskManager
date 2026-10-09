import { observe } from './metrics.js';
import { randomUUID } from 'node:crypto';
import type { RequestHandler } from 'express';

// Deliberately exclude URLs, headers, cookies, bodies and user identities.
export const requestLog: RequestHandler = (req, res, next) => {
  const requestId = randomUUID();
  const started = performance.now();
  res.setHeader('X-Request-ID', requestId);
  const operation = req.path.startsWith('/api/v1/auth')
    ? 'auth'
    : req.path.includes('/comments')
      ? 'comments'
      : req.path.includes('/invitations')
        ? 'invitations'
        : req.path.includes('/activity')
          ? 'activity'
          : req.path.includes('/tasks')
            ? 'missions'
            : req.path.startsWith('/api/v1/teams')
              ? 'teams'
              : req.path === '/health'
                ? 'health'
                : 'other';
  res.on('finish', () => {
    const durationMs = Math.round(performance.now() - started);
    observe(operation, res.statusCode, durationMs);
    console.info(
      JSON.stringify({
        event: 'http_request',
        requestId,
        method: req.method,
        operation,
        status: res.statusCode,
        durationMs,
      }),
    );
  });
  next();
};
