import mongoose from 'mongoose';
import { Activity } from '../modules/activity/activity.model.js';
import { AssignmentCleanup } from '../modules/teams/cleanup.model.js';
import { LimitBucket } from '../middleware/sharedLimit.js';
import { Idempotency } from '../utils/requestContext.js';
import { env } from './env.js';
import { User } from '../modules/auth/user.model.js';
import { Team } from '../modules/teams/team.model.js';
import { Membership } from '../modules/memberships/membership.model.js';
import { Invitation } from '../modules/invitations/invitation.model.js';
import { Task } from '../modules/tasks/task.model.js';
import { TaskComment } from '../modules/comments/comment.model.js';
export async function connectDatabase(maintenance = false) {
  await mongoose.connect(env.MONGODB_URI, {
    serverSelectionTimeoutMS: 5000,
    maxPoolSize: env.DB_POOL_SIZE,
    minPoolSize: 0,
    waitQueueTimeoutMS: 2000,
    socketTimeoutMS: 10000,
    bufferCommands: false,
    autoIndex: env.NODE_ENV !== 'production',
  });
  const hello = await mongoose.connection.db!.admin().command({ hello: 1 });
  if (!hello.setName && hello.msg !== 'isdbgrid')
    throw new Error(
      'MongoDB must be a replica set for transactional crew writes',
    );
  if (env.NODE_ENV === 'production' && !maintenance) {
    const state = await mongoose.connection
      .db!.collection('planner_migrations')
      .findOne({ version: 1 });
    if (!state)
      throw new Error(
        'Run the controlled database migration before starting production',
      );
  }
  await Promise.all([
    Activity.init(),
    AssignmentCleanup.init(),
    LimitBucket.init(),
    Idempotency.init(),
    User.init(),
    Team.init(),
    Membership.init(),
    Invitation.init(),
    Task.init(),
    TaskComment.init(),
  ]);
}
