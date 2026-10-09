import type { RequestHandler } from 'express';
import { authenticateToken } from '../modules/auth/auth.service.js';
export const authenticate: RequestHandler = async (req, res, next) => {
  res.locals.user = await authenticateToken(req.cookies?.planner_session);
  next();
};
