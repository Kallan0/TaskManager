import { idempotent } from './requestContext.js';
import { User } from '../modules/auth/user.model.js';
import { Membership } from '../modules/memberships/membership.model.js';
import { requestContext } from './requestContext.js';
import { AsyncLocalStorage } from 'node:async_hooks';
import mongoose from 'mongoose';
import { Team } from '../modules/teams/team.model.js';
import { ApiError } from './ApiError.js';
import { flushActivity } from '../modules/activity/activity.service.js';

mongoose.set('transactionAsyncLocalStorage', true);
mongoose.set('maxTimeMS', 3000);
const context = new AsyncLocalStorage<{ events: Set<string> }>();
export function captureEvent(id: { toString(): string }) {
  context.getStore()?.events.add(id.toString());
}
export async function mutation<T>(
  teamId: string | null,
  work: () => Promise<T>,
): Promise<T> {
  if (context.getStore()) return work();
  const transactionOptions = {
    readPreference: 'primary' as const,
    maxCommitTimeMS: 5000,
    timeoutMS: 12000,
  };
  return mongoose.connection.transaction(
    async () =>
      context.run({ events: new Set() }, async () => {
        // All crew mutations contend on one document. A revoked role cannot commit a
        // write using an older membership snapshot after the revocation commits.
        if (teamId) {
          const team = await Team.findOneAndUpdate(
            { _id: teamId },
            { $inc: { mutationVersion: 1 } },
          );
          if (!team) throw new ApiError(404, 'NOT_FOUND', 'Team not found');
        }
        const actor = requestContext.getStore()?.actor();
        const access =
          teamId && actor
            ? await Membership.findOne({ team: teamId, user: actor })
            : null;
        if (teamId && actor && !access)
          throw new ApiError(
            403,
            'FORBIDDEN',
            'You no longer belong to this crew',
          );
        if (!teamId && actor)
          await User.updateOne(
            { _id: actor },
            { $inc: { teamCreationVersion: 1 } },
          );
        const result = await idempotent(work, access?.role);
        await flushActivity([...context.getStore()!.events]);
        return result;
      }),
    transactionOptions,
  );
}
export function teamMutation<A extends unknown[], R>(
  fn: (team: string, ...args: A) => Promise<R>,
) {
  return (team: string, ...args: A) => mutation(team, () => fn(team, ...args));
}
