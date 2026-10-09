import { Team } from './team.model.js';
import { Membership } from '../memberships/membership.model.js';
import { User, publicUser } from '../auth/user.model.js';
import { Task } from '../tasks/task.model.js';
import {
  authorizeTeam,
  requireManager,
} from '../../middleware/authorizeTeam.js';
import { ApiError } from '../../utils/ApiError.js';
import {
  idSchema,
  teamSchema,
  teamUpdateSchema,
  roleSchema,
  paginationSchema,
} from './team.validation.js';

export function serializeTeam(
  team: {
    _id: { toString(): string };
    name: string;
    description: string;
    owner: { toString(): string };
    createdAt: Date;
  },
  role: string,
) {
  return {
    id: team._id.toString(),
    name: team.name,
    description: team.description,
    ownerId: team.owner.toString(),
    role,
    createdAt: team.createdAt,
  };
}
export async function createTeam(userId: string, input: unknown) {
  const data = teamSchema.parse(input);
  const team = await Team.create({ ...data, owner: userId });
  try {
    await Membership.create({ team: team._id, user: userId, role: 'owner' });
  } catch (error) {
    await Team.deleteOne({ _id: team._id });
    throw error;
  }
  return serializeTeam(team, 'owner');
}
export async function listTeams(userId: string, query: unknown) {
  const { page, limit } = paginationSchema.parse(query);
  const total = await Membership.countDocuments({ user: userId });
  const memberships = await Membership.find({ user: userId })
    .sort({ joinedAt: -1, _id: -1 })
    .skip((page - 1) * limit)
    .limit(limit);
  const teams = await Team.find({
    _id: { $in: memberships.map((item) => item.team) },
  });
  return {
    items: memberships.flatMap((membership) => {
      const team = teams.find((item) => item._id.equals(membership.team));
      return team ? [serializeTeam(team, membership.role)] : [];
    }),
    page,
    total,
    pages: Math.max(1, Math.ceil(total / limit)),
  };
}
export async function getTeam(teamId: string, userId: string) {
  const membership = await authorizeTeam(teamId, userId);
  const team = await Team.findById(teamId);
  if (!team) throw new ApiError(404, 'NOT_FOUND', 'Team not found');
  return {
    ...serializeTeam(team, membership.role),
    memberCount: await Membership.countDocuments({ team: teamId }),
  };
}
export async function updateTeam(
  teamId: string,
  userId: string,
  input: unknown,
) {
  requireManager((await authorizeTeam(teamId, userId)).role);
  const data = teamUpdateSchema.parse(input);
  await Team.updateOne({ _id: teamId }, { $set: data });
  return getTeam(teamId, userId);
}
export async function listMembers(
  teamId: string,
  userId: string,
  query: unknown,
) {
  await authorizeTeam(teamId, userId);
  const { page, limit } = paginationSchema.parse(query);
  const total = await Membership.countDocuments({ team: teamId });
  const memberships = await Membership.find({ team: teamId })
    .sort({ joinedAt: 1, _id: 1 })
    .skip((page - 1) * limit)
    .limit(limit);
  const users = await User.find({
    _id: { $in: memberships.map((item) => item.user) },
  });
  return {
    items: memberships.flatMap((membership) => {
      const user = users.find((item) => item._id.equals(membership.user));
      return user
        ? [
            {
              ...publicUser(user),
              role: membership.role,
              joinedAt: membership.joinedAt,
            },
          ]
        : [];
    }),
    page,
    total,
    pages: Math.max(1, Math.ceil(total / limit)),
  };
}
export async function changeRole(
  teamId: string,
  actorId: string,
  targetId: string,
  input: unknown,
) {
  const actor = await authorizeTeam(teamId, actorId);
  if (actor.role !== 'owner')
    throw new ApiError(
      403,
      'FORBIDDEN',
      'Only the Celestial can change crew roles',
    );
  idSchema.parse(targetId);
  const { role } = roleSchema.parse(input);
  const target = await Membership.findOneAndUpdate(
    { team: teamId, user: targetId, role: { $ne: 'owner' } },
    { $set: { role } },
    { new: true },
  );
  if (!target)
    throw new ApiError(
      409,
      'CONFLICT',
      'Crew member does not exist or is the Celestial',
    );
  return { userId: targetId, role: target.role };
}
export async function removeMember(
  teamId: string,
  actorId: string,
  targetId: string,
) {
  const actor = await authorizeTeam(teamId, actorId);
  requireManager(actor.role);
  idSchema.parse(targetId);
  // Conditions stay in the write so a concurrent promotion cannot let an admin remove another admin.
  const target = await Membership.findOneAndDelete({
    team: teamId,
    user: targetId,
    role: actor.role === 'owner' ? { $ne: 'owner' } : 'member',
  });
  if (!target)
    throw new ApiError(
      403,
      'FORBIDDEN',
      'The Celestial cannot be removed; Holy Knights can only remove Commoners',
    );
  const assigned = await Task.find({
    team: teamId,
    assignee: targetId,
    deletedAt: null,
  }).select('_id title');
  await Promise.all(
    assigned.map((task) =>
      Task.updateOne(
        { _id: task._id, assignee: targetId, deletedAt: null },
        {
          $set: { assignee: null },
          $inc: { __v: 1 },
          $push: {
            history: {
              $each: [
                {
                  actor: actorId,
                  type: 'TASK_ASSIGNED',
                  taskTitle: task.title,
                  changes: [{ field: 'assigneeId', from: targetId, to: null }],
                  createdAt: new Date(),
                },
              ],
              $slice: -200,
            },
          },
        },
      ),
    ),
  );
}
