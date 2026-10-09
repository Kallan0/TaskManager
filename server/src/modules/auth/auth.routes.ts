import { comparePassword } from './passwords.js';
import { ApiError } from '../../utils/ApiError.js';
import {
  recoverAccount,
  newRecoveryCode,
  recoveryHash,
} from './recovery.service.js';
import { Router } from 'express';
import { ipKeyGenerator } from 'express-rate-limit';
import { sharedLimit } from '../../middleware/sharedLimit.js';
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
const authIpLimit = sharedLimit('auth-ip', { limit: 1000 });
const limiter = sharedLimit('auth-account', {
  limit: 20,
  skipSuccessfulRequests: true,
  keyGenerator: (req, res) =>
    res.locals.user?.id ??
    (String(req.body?.email ?? '')
      .trim()
      .toLowerCase()
      .slice(0, 254) ||
      ipKeyGenerator(req.ip ?? 'unknown')),
});
authRouter.use(['/login', '/register', '/recover'], authIpLimit);
authRouter.post('/register', limiter, async (req, res) => {
  const result = await register(req.body);
  res
    .cookie('planner_session', result.token, cookieOptions)
    .status(201)
    .json({
      success: true,
      data: {
        ...result.user,
        ...('recoveryCode' in result
          ? { recoveryCode: result.recoveryCode }
          : {}),
      },
    });
});
authRouter.post('/login', limiter, async (req, res) => {
  const result = await login(req.body);
  res
    .cookie('planner_session', result.token, cookieOptions)
    .json({ success: true, data: result.user });
});
authRouter.post('/recover', limiter, async (req, res) => {
  const result = await recoverAccount(req.body);
  res
    .clearCookie('planner_session', { ...cookieOptions, maxAge: undefined })
    .json({ success: true, data: { recoveryCode: result.recoveryCode } });
});
authRouter.post('/recovery-code', authenticate, limiter, async (req, res) => {
  const user = await User.findById(res.locals.user.id).select('+passwordHash');
  if (
    typeof req.body?.password !== 'string' ||
    Buffer.byteLength(req.body.password) > 72 ||
    !user ||
    !(await comparePassword(req.body.password, user.passwordHash))
  )
    throw new ApiError(
      401,
      'INVALID_CREDENTIALS',
      'Current password is incorrect',
    );
  const recoveryCode = newRecoveryCode();
  await User.updateOne(
    { _id: res.locals.user.id },
    { $set: { recoveryHash: recoveryHash(recoveryCode) } },
  );
  res.json({ success: true, data: { recoveryCode } });
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
