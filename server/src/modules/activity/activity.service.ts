import { Task } from '../tasks/task.model.js';
import { TaskComment } from '../comments/comment.model.js';
import { Activity } from './activity.model.js';

// Called inside the same transaction as the business write. No history scans
// occur on reads; only records containing this mutation's new event IDs are read.
export async function flushActivity(ids: string[]) {
  if (!ids.length) return;
  const wanted = new Set(ids);
  const missions = await Task.find({ 'history._id': { $in: ids } });
  const comments = await TaskComment.find({ 'history._id': { $in: ids } });
  const parents = await Task.find({
    _id: { $in: comments.map((c) => c.task) },
  }).select('approvalStatus');
  const rows = [];
  for (const doc of [...missions, ...comments]) {
    const isMission = 'approvalStatus' in doc;
    const task = isMission ? doc._id : (doc as (typeof comments)[number]).task;
    const parent = isMission ? doc : parents.find((p) => p._id.equals(task));
    for (const entry of doc.history) {
      if (!wanted.has(entry._id.toString())) continue;
      rows.push({
        _id: entry._id,
        team: doc.team,
        task,
        actor: entry.actor,
        taskTitle: entry.taskTitle,
        type: entry.type,
        changes: entry.changes,
        visibleToMembers:
          !parent || !['pending', 'rejected'].includes(parent.approvalStatus),
        createdAt: entry.createdAt,
        purgeAt: new Date(entry.createdAt.getTime() + 365 * 86400000),
      });
    }
  }
  if (rows.length) await Activity.insertMany(rows, { ordered: true });
  for (const mission of missions) {
    if (mission.approvalStatus === 'approved')
      await Activity.updateMany(
        { task: mission._id, visibleToMembers: false },
        { $set: { visibleToMembers: true } },
      );
  }
}
