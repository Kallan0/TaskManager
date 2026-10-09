import { Types } from 'mongoose';
import { AssignmentCleanup } from './cleanup.model.js';
import { Task } from '../tasks/task.model.js';
import { captureEvent, mutation } from '../../utils/mutation.js';

export async function runCleanup(jobId: string, maxBatches = 20) {
  for (let batch = 0; batch < maxBatches; batch++) {
    const job = await AssignmentCleanup.findById(jobId);
    if (!job) return;
    const finished = await mutation(job.team.toString(), async () => {
      const tasks = await Task.find({ team: job.team, assignee: job.user })
        .select('_id title')
        .limit(50);
      if (!tasks.length) {
        await AssignmentCleanup.deleteOne({ _id: job._id });
        return true;
      }
      // Sequential bounded operations are safe in a transaction; no Promise.all.
      for (const task of tasks) {
        const id = new Types.ObjectId();
        captureEvent(id);
        await Task.updateOne(
          { _id: task._id, assignee: job.user },
          {
            $set: { assignee: null },
            $inc: { __v: 1 },
            $push: {
              history: {
                $each: [
                  {
                    _id: id,
                    actor: job.actor,
                    type: 'TASK_ASSIGNED',
                    taskTitle: task.title,
                    changes: [
                      {
                        field: 'assigneeId',
                        from: job.user.toString(),
                        to: null,
                      },
                    ],
                    createdAt: new Date(),
                  },
                ],
                $slice: -200,
              },
            },
          },
        );
      }
      return false;
    });
    if (finished) return;
  }
}
export async function cleanupAssignments() {
  const jobs = await AssignmentCleanup.find().sort({ createdAt: 1 }).limit(10);
  for (const job of jobs) await runCleanup(job.id, 2);
}
