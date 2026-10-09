import mongoose, { Types } from 'mongoose';
import { User } from '../modules/auth/user.model.js';
import { Team } from '../modules/teams/team.model.js';
import {
  Membership,
  memberSearchKeys,
} from '../modules/memberships/membership.model.js';
import { Invitation } from '../modules/invitations/invitation.model.js';
import { Task } from '../modules/tasks/task.model.js';
import { TaskComment } from '../modules/comments/comment.model.js';
import { Activity } from '../modules/activity/activity.model.js';
import { AssignmentCleanup } from '../modules/teams/cleanup.model.js';
import { LimitBucket } from '../middleware/sharedLimit.js';
import { Idempotency } from '../utils/requestContext.js';

export const models = [
  User,
  Team,
  Membership,
  Invitation,
  Task,
  TaskComment,
  Activity,
  AssignmentCleanup,
  LimitBucket,
  Idempotency,
];
export async function migrate() {
  // Additive, idempotent migration. No syncIndexes/dropIndexes on a live DB.
  for (const model of models) {
    await model.createCollection();
    await model.createIndexes();
  }
  await Task.updateMany(
    { approvalStatus: { $exists: false } },
    { $set: { approvalStatus: 'approved' } },
  );
  for await (const task of Task.find().select('_id priority').cursor())
    await Task.updateOne(
      { _id: task._id },
      {
        $set: {
          priorityRank: ['urgent', 'high', 'medium', 'low'].indexOf(
            task.priority,
          ),
        },
      },
    );
  for await (const membership of Membership.find().cursor()) {
    const user = await User.findById(membership.user).select('name email');
    if (user)
      await Membership.updateOne(
        { _id: membership._id },
        { $set: { searchKeys: memberSearchKeys(user.name, user.email) } },
      );
  }
  const cutoff = new Date(Date.now() - 365 * 86400000);
  for (const model of [Task, TaskComment]) {
    for await (const doc of model.collection.find(
      { 'history.createdAt': { $gt: cutoff } },
      { batchSize: 50 },
    )) {
      const taskId = model.modelName === 'Task' ? doc._id : doc.task;
      const parent = await Task.findById(taskId).select('approvalStatus');
      if (!parent) continue;
      for (const entry of doc.history) {
        if (entry.createdAt <= cutoff) continue;
        await Activity.updateOne(
          { _id: entry._id },
          {
            $setOnInsert: {
              team: doc.team,
              task: taskId,
              actor: entry.actor,
              taskTitle: entry.taskTitle,
              type: entry.type,
              changes: entry.changes,
              visibleToMembers: parent.approvalStatus === 'approved',
              createdAt: entry.createdAt,
              purgeAt: new Date(entry.createdAt.getTime() + 365 * 86400000),
            },
          },
          { upsert: true },
        );
      }
    }
  }
  await mongoose.connection
    .db!.collection('planner_migrations')
    .updateOne(
      { version: 1 },
      { $set: { completedAt: new Date() } },
      { upsert: true },
    );
}
export async function auditInvariants() {
  const missingOwners = await Team.aggregate([
    {
      $lookup: {
        from: Membership.collection.name,
        let: { team: '$_id', owner: '$owner' },
        pipeline: [
          {
            $match: {
              $expr: {
                $and: [
                  { $eq: ['$team', '$$team'] },
                  { $eq: ['$user', '$$owner'] },
                  { $eq: ['$role', 'owner'] },
                ],
              },
            },
          },
        ],
        as: 'membership',
      },
    },
    { $match: { membership: { $size: 0 } } },
    { $count: 'count' },
  ]);
  const staleAssignees = await Task.aggregate([
    { $match: { assignee: { $ne: null } } },
    {
      $lookup: {
        from: Membership.collection.name,
        let: { team: '$team', user: '$assignee' },
        pipeline: [
          {
            $match: {
              $expr: {
                $and: [
                  { $eq: ['$team', '$$team'] },
                  { $eq: ['$user', '$$user'] },
                ],
              },
            },
          },
        ],
        as: 'membership',
      },
    },
    { $match: { membership: { $size: 0 } } },
    { $count: 'count' },
  ]);
  return {
    missingOwnerMemberships: missingOwners[0]?.count ?? 0,
    staleAssignments: staleAssignees[0]?.count ?? 0,
    pendingCleanupJobs: await AssignmentCleanup.countDocuments(),
  };
}
export async function retain(apply = false) {
  const cutoff = new Date(Date.now() - 90 * 86400000);
  const filter = { expiresAt: { $lt: cutoff } };
  const result = {
    oldInvitations: await Invitation.countDocuments(filter),
    oldDeletedMissions: await Task.countDocuments({
      deletedAt: { $lt: cutoff },
    }),
    oldDeletedComments: await TaskComment.countDocuments({
      deletedAt: { $lt: cutoff },
    }),
  };
  if (!apply) return result;
  // Bounded deletion passes; history has its own 365-day TTL and survives these.
  for (const model of [Invitation, TaskComment]) {
    const query =
      model.modelName === 'Invitation'
        ? filter
        : { deletedAt: { $lt: cutoff } };
    for (;;) {
      const docs = await model.collection
        .find(query, { projection: { _id: 1 } })
        .limit(100)
        .toArray();
      if (!docs.length) break;
      await model.collection.deleteMany({
        _id: { $in: docs.map((d) => d._id) },
      });
    }
  }
  for (;;) {
    const tasks = await Task.find({ deletedAt: { $lt: cutoff } })
      .select('_id')
      .limit(100);
    if (!tasks.length) break;
    const ids: Types.ObjectId[] = tasks.map((t) => t._id);
    await TaskComment.deleteMany({ task: { $in: ids } });
    await Task.deleteMany({ _id: { $in: ids } });
  }
  return result;
}
