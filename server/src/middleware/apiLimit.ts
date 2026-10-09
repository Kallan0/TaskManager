import { rateLimit } from 'express-rate-limit';

export function createApiLimit(limit = 600) {
  return rateLimit({
    windowMs: 15 * 60 * 1000,
    limit,
    standardHeaders: 'draft-8',
    legacyHeaders: false,
    message: {
      success: false,
      error: {
        code: 'RATE_LIMITED',
        message: 'Too many requests. Please try again later',
      },
    },
  });
}
