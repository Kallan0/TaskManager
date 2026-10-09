import { randomUUID } from 'node:crypto';
import type { RequestHandler } from 'express';

// Deliberately exclude URLs, headers, cookies, bodies and user identities.
export const requestLog: RequestHandler = (req, res, next) => {
  const requestId = randomUUID();
  const started = performance.now();
  res.setHeader('X-Request-ID', requestId);
  res.on('finish', () => {
    console.info(
      JSON.stringify({
        event: 'http_request',
        requestId,
        method: req.method,
        status: res.statusCode,
        durationMs: Math.round(performance.now() - started),
      }),
    );
  });
  next();
};
