import express from 'express';
import { idempotencyContext } from './utils/requestContext.js';
import { ready, draining } from './middleware/readiness.js';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { existsSync } from 'node:fs';
import cors from 'cors';
import helmet from 'helmet';
import cookieParser from 'cookie-parser';
import { env } from './config/env.js';
import { getTrustedOrigins } from './config/origins.js';
import { authRouter } from './modules/auth/auth.routes.js';
import { errorHandler } from './middleware/errorHandler.js';
import { ApiError } from './utils/ApiError.js';
import { teamRouter } from './modules/teams/team.routes.js';
import { invitationRouter } from './modules/invitations/invitation.routes.js';
import { taskRouter } from './modules/tasks/task.routes.js';
import { commentRouter } from './modules/comments/comment.routes.js';
import { requestLog } from './middleware/requestLog.js';
import { createApiLimit } from './middleware/apiLimit.js';

export const app = express();
app.disable('x-powered-by');
app.set('trust proxy', env.TRUST_PROXY_HOPS);
app.use(requestLog);
app.use(
  helmet({
    contentSecurityPolicy: {
      directives: {
        styleSrc: ["'self'", "'unsafe-inline'", 'https://fonts.googleapis.com'],
        fontSrc: ["'self'", 'https://fonts.gstatic.com'],
      },
    },
  }),
);
app.use('/api', (_req, res, next) => {
  res.setHeader('Cache-Control', 'no-store');
  next();
});
const trustedOrigins = getTrustedOrigins(env.CLIENT_URL, env.NODE_ENV);
app.use(
  cors({
    origin: (origin, callback) =>
      callback(null, !!origin && trustedOrigins.has(origin)),
    credentials: true,
  }),
);
// Cookie-authenticated mutations require a trusted browser Origin. CORS alone does not prevent CSRF.
app.use((req, _res, next) => {
  if (
    !['GET', 'HEAD', 'OPTIONS'].includes(req.method) &&
    !trustedOrigins.has(req.get('origin') ?? '')
  ) {
    throw new ApiError(
      403,
      'UNTRUSTED_ORIGIN',
      'Request origin is not allowed',
    );
  }
  next();
});
app.use('/api', (req, res, next) => {
  const timer = setTimeout(() => {
    if (!res.headersSent)
      res.status(503).json({
        success: false,
        error: {
          code: 'REQUEST_TIMEOUT',
          message: 'Request timed out. Please retry with the same request key',
        },
      });
  }, 15000);
  res.once('finish', () => clearTimeout(timer));
  res.once('close', () => clearTimeout(timer));
  next();
});
app.use('/api', createApiLimit());
app.use(express.json({ limit: '96kb' }));
app.use(cookieParser());
app.use(idempotencyContext);
app.get('/health', async (_req, res) => {
  const connected = await ready();
  res.status(connected ? 200 : 503).json({
    success: connected,
    data: {
      status: connected ? 'ok' : 'unavailable',
      database: connected ? 'connected' : 'disconnected',
    },
  });
});
app.get('/live', (_req, res) => res.json({ success: true }));
app.use('/api', (_req, res, next) => {
  res.setHeader('Cache-Control', 'no-store');
  if (draining) {
    res.status(503).json({
      success: false,
      error: {
        code: 'SERVER_DRAINING',
        message: 'Server is restarting. Please try again',
      },
    });
    return;
  }
  next();
});
app.use('/api/v1/auth', authRouter);
app.use('/api/v1/teams/:teamId/tasks', taskRouter);
app.use('/api/v1/comments', commentRouter);
app.use('/api/v1/teams', teamRouter);
app.use('/api/v1/invitations', invitationRouter);
if (env.NODE_ENV === 'production') {
  const dist = fileURLToPath(new URL('../../client/dist/', import.meta.url));
  // A separately hosted frontend is optional for an API-only deployment.
  if (existsSync(resolve(dist, 'index.html'))) {
    app.use(
      '/assets',
      express.static(resolve(dist, 'assets'), {
        immutable: true,
        maxAge: '1y',
        fallthrough: true,
      }),
    );
    app.use(express.static(dist, { index: false, maxAge: 0 }));
    app.get('/{*path}', (req, res, next) => {
      if (
        req.path.startsWith('/api') ||
        req.path === '/health' ||
        req.path.includes('.')
      ) {
        next();
        return;
      }
      res.setHeader('Cache-Control', 'no-cache');
      res.sendFile(resolve(dist, 'index.html'));
    });
  }
}
app.use((_req, _res, next) =>
  next(new ApiError(404, 'NOT_FOUND', 'Endpoint not found')),
);
app.use(errorHandler);
