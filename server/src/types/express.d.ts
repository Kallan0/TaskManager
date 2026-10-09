import type { PublicUser } from '../modules/auth/user.model.js';
declare global {
  namespace Express {
    interface Locals {
      user: PublicUser;
    }
  }
}
