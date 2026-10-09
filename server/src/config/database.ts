import mongoose from 'mongoose';
import { env } from './env.js';
import { User } from '../modules/auth/user.model.js';
import { Team } from '../modules/teams/team.model.js';
import { Membership } from '../modules/memberships/membership.model.js';
import { Invitation } from '../modules/invitations/invitation.model.js';
import { Task } from '../modules/tasks/task.model.js';
import { TaskComment } from '../modules/comments/comment.model.js';
export async function connectDatabase() {
  await mongoose.connect(env.MONGODB_URI, { serverSelectionTimeoutMS: 10000 });
  await Promise.all([
    User.init(),
    Team.init(),
    Membership.init(),
    Invitation.init(),
    Task.init(),
    TaskComment.init(),
  ]);
}
