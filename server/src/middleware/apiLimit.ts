import jwt from 'jsonwebtoken';
import { env } from '../config/env.js';
import { ipKeyGenerator } from 'express-rate-limit';
import { sharedLimit } from './sharedLimit.js';
export function createApiLimit(limit = 5000) {
  return sharedLimit('edge', {
    limit,
    keyGenerator: (req) => {
      try {
        const token = /(?:^|;\s*)planner_session=([^;]+)/.exec(
          req.headers.cookie ?? '',
        )?.[1];
        if (token) {
          const decoded = jwt.verify(token, env.SESSION_SECRET, {
            algorithms: ['HS256'],
            issuer: 'team-task-planner',
            audience: 'planner-web',
          });
          if (
            typeof decoded !== 'string' &&
            typeof decoded.sub === 'string' &&
            /^[a-f\d]{24}$/.test(decoded.sub)
          )
            return 'user:' + decoded.sub;
        }
      } catch {
        /* Invalid/expired signatures share the anonymous IP budget. */
      }
      return 'ip:' + ipKeyGenerator(req.ip ?? 'unknown');
    },
  });
}
export const userLimit = sharedLimit('user', {
  limit: 1200,
  keyGenerator: (_req, res) => res.locals.user.id,
});
