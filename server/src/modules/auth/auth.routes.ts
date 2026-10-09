import { Router } from 'express';
import { rateLimit } from 'express-rate-limit';
import { env } from '../../config/env.js';
import { authenticate } from '../../middleware/authenticate.js';
import { login, register } from './auth.service.js';
import { User } from './user.model.js';

export const authRouter = Router();
const cookieOptions = {
  httpOnly: true,
  secure: env.NODE_ENV === 'production',
  sameSite: 'lax' as const,
  path: '/api/v1',
  maxAge: 8 * 60 * 60 * 1000,
};
const limiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 20,
  standardHeaders: 'draft-8',
  legacyHeaders: false,
  message: {
    success: false,
    error: {
      code: 'RATE_LIMITED',
      message: 'Too many attempts. Try again in 15 minutes',
    },
  },
});
authRouter.post('/register', limiter, async (req, res) => {
  const result = await register(req.body);
  res
    .cookie('planner_session', result.token, cookieOptions)
    .status(201)
    .json({ success: true, data: result.user });
});
authRouter.post('/login', limiter, async (req, res) => {
  const result = await login(req.body);
  res
    .cookie('planner_session', result.token, cookieOptions)
    .json({ success: true, data: result.user });
});
authRouter.get('/me', authenticate, (_req, res) =>
  res.json({ success: true, data: res.locals.user }),
);
authRouter.post('/logout', authenticate, async (_req, res) => {
  await User.updateOne(
    { _id: res.locals.user.id },
    { $inc: { tokenVersion: 1 } },
  );
  res
    .clearCookie('planner_session', { ...cookieOptions, maxAge: undefined })
    .status(204)
    .end();
});
