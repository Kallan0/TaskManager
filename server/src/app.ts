import express from 'express';
import mongoose from 'mongoose';
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
app.use(helmet());
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
app.use('/api', createApiLimit());
app.use(express.json({ limit: '16kb' }));
app.use(cookieParser());
app.get('/health', (_req, res) => {
  const connected = mongoose.connection.readyState === 1;
  res.status(connected ? 200 : 503).json({
    success: connected,
    data: {
      status: connected ? 'ok' : 'unavailable',
      database: connected ? 'connected' : 'disconnected',
    },
  });
});
app.use('/api/v1/auth', authRouter);
app.use('/api/v1/teams/:teamId/tasks', taskRouter);
app.use('/api/v1/comments', commentRouter);
app.use('/api/v1/teams', teamRouter);
app.use('/api/v1/invitations', invitationRouter);
app.use((_req, _res, next) =>
  next(new ApiError(404, 'NOT_FOUND', 'Endpoint not found')),
);
app.use(errorHandler);
