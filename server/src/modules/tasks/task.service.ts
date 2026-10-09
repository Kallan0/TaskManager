import { Activity } from '../activity/activity.model.js';
import {
  encodeCursor,
  decodeCursor,
  encodeOrderedCursor,
  decodeOrderedCursor,
} from '../../utils/cursor.js';
import { teamMutation, captureEvent } from '../../utils/mutation.js';
import { Types, type HydratedDocument, type InferSchemaType } from 'mongoose';
import { Task, approvedMissionFilter } from './task.model.js';
import {
  createTaskSchema,
  updateTaskSchema,
  listTaskSchema,
  reviewProposalSchema,
} from './task.validation.js';
import { idSchema, paginationSchema } from '../teams/team.validation.js';
import { Membership } from '../memberships/membership.model.js';
import { User } from '../auth/user.model.js';
import { authorizeTeam } from '../../middleware/authorizeTeam.js';
import { ApiError } from '../../utils/ApiError.js';

type TaskDoc = HydratedDocument<InferSchemaType<typeof Task.schema>>;
type Change = { field: string; from?: string | null; to?: string | null };
const day = (value?: Date | null) =>
  value ? value.toISOString().slice(0, 10) : null;
const date = (value?: string | null) =>
  value ? new Date(`${value}T00:00:00.000Z`) : null;
function event(
  actor: string,
  type: string,
  title: string,
  changes: Change[] = [],
) {
  const id = new Types.ObjectId();
  captureEvent(id);
  return {
    _id: id,
    actor,
    type,
    taskTitle: title,
    changes,
    createdAt: new Date(),
  };
}
async function checkAssignee(teamId: string, assigneeId?: string | null) {
  if (
    assigneeId &&
    !(await Membership.exists({ team: teamId, user: assigneeId }))
  )
    throw new ApiError(
      400,
      'INVALID_ASSIGNEE',
      'Assignee must be a member of this team',
    );
}
async function findTask(
  teamId: string,
  taskId: string,
  allowProposals = false,
) {
  idSchema.parse(taskId);
  const task = await Task.findOne({
    _id: taskId,
    team: teamId,
    deletedAt: null,
    ...(!allowProposals ? approvedMissionFilter : {}),
  }).select('-history');
  if (!task)
    throw new ApiError(404, 'NOT_FOUND', 'Mission not found in this team');
  return task;
}
async function serialize(tasks: TaskDoc[], userId: string, role: string) {
  const users = await User.find({
    _id: {
      $in: tasks.flatMap((task) => [
        task.createdBy,
        ...(task.assignee ? [task.assignee] : []),
      ]),
    },
  });
  const person = (id?: Types.ObjectId | null) => {
    const user = users.find((item) => id && item._id.equals(id));
    return user ? { id: user.id, name: user.name } : null;
  };
  return tasks.map((task) => ({
    id: task.id,
    teamId: task.team.toString(),
    title: task.title,
    description: task.description,
    status: task.status,
    priority: task.priority,
    creatorId: task.createdBy.toString(),
    creator: person(task.createdBy),
    assigneeId: task.assignee?.toString() ?? null,
    assignee: person(task.assignee),
    startDate: day(task.startDate),
    dueDate: day(task.dueDate),
    completedAt: task.completedAt,
    createdAt: task.createdAt,
    updatedAt: task.updatedAt,
    version: task.__v,
    approvalStatus: task.approvalStatus ?? 'approved',
    isProposer: task.createdBy.toString() === userId,
    reviewedAt: task.reviewedAt,
    rejectionReason: task.rejectionReason,
    canEdit:
      role === 'owner' && (task.approvalStatus ?? 'approved') === 'approved',
    canChangeStatus:
      role === 'owner' && (task.approvalStatus ?? 'approved') === 'approved',
    canDelete:
      role === 'owner' && (task.approvalStatus ?? 'approved') === 'approved',
    canReview: role === 'owner' && task.approvalStatus === 'pending',
  }));
}
async function createTaskInternal(
  teamId: string,
  userId: string,
  input: unknown,
  proposal = false,
) {
  const membership = await authorizeTeam(teamId, userId);
  if (membership.role !== (proposal ? 'admin' : 'owner'))
    throw new ApiError(
      403,
      'FORBIDDEN',
      proposal
        ? 'Only Holy Knights can propose missions'
        : 'Only the Celestial can create missions. Holy Knights can submit a proposal',
    );
  const values = createTaskSchema.parse(input);
  if (proposal && values.status !== 'todo')
    throw new ApiError(
      400,
      'VALIDATION_ERROR',
      'Proposals must start with To do status',
    );
  await checkAssignee(teamId, values.assigneeId);
  const task = await Task.create({
    ...values,
    team: teamId,
    createdBy: userId,
    priorityRank: ['urgent', 'high', 'medium', 'low'].indexOf(values.priority),
    approvalStatus: proposal ? 'pending' : 'approved',
    assignee: values.assigneeId,
    startDate: date(values.startDate),
    dueDate: date(values.dueDate),
    completedAt: values.status === 'done' ? new Date() : null,
    history: [
      event(
        userId,
        proposal ? 'MISSION_PROPOSED' : 'TASK_CREATED',
        values.title,
      ),
      ...(values.assigneeId
        ? [
            event(userId, 'TASK_ASSIGNED', values.title, [
              { field: 'assigneeId', from: null, to: values.assigneeId },
            ]),
          ]
        : []),
    ],
  });
  // A removal racing this create must not leave a task assigned to a former member.
  if (
    values.assigneeId &&
    !(await Membership.exists({ team: teamId, user: values.assigneeId }))
  ) {
    await Task.deleteOne({ _id: task._id });
    throw new ApiError(
      409,
      'ASSIGNEE_REMOVED',
      'This assignee was removed. Choose another member',
    );
  }
  return (await serialize([task], userId, membership.role))[0];
}
export async function getTask(teamId: string, userId: string, taskId: string) {
  const membership = await authorizeTeam(teamId, userId);
  return (
    await serialize(
      [await findTask(teamId, taskId, membership.role !== 'member')],
      userId,
      membership.role,
    )
  )[0];
}
export async function listTasks(
  teamId: string,
  userId: string,
  query: unknown,
) {
  const membership = await authorizeTeam(teamId, userId);
  const values = listTaskSchema.parse(query);
  if (values.approval !== 'approved' && membership.role === 'member')
    throw new ApiError(
      403,
      'FORBIDDEN',
      'Only the Celestial and Holy Knights can view mission proposals',
    );
  const filter: Record<string, unknown> = {
    team: teamId,
    deletedAt: null,
    ...(values.approval === 'approved'
      ? approvedMissionFilter
      : { approvalStatus: values.approval }),
  };
  if (values.status) filter.status = values.status;
  if (values.priority) filter.priority = values.priority;
  if (values.assignee)
    filter.assignee = values.assignee === 'unassigned' ? null : values.assignee;
  if (values.q)
    filter.$text = { $search: '"' + values.q.replace(/["\\]/g, ' ') + '"' };
  const today = date(values.today ?? new Date().toISOString().slice(0, 10))!;
  if (values.due === 'overdue') {
    filter.dueDate = { $lt: today, $ne: null };
    if (!values.status) filter.status = { $ne: 'done' };
    else if (values.status === 'done') filter.status = { $in: [] };
  }
  if (values.due === 'upcoming') {
    filter.dueDate = {
      $gte: today,
      $lt: new Date(today.getTime() + 8 * 86400000),
    };
    if (!values.status) filter.status = { $ne: 'done' };
    else if (values.status === 'done') filter.status = { $in: [] };
  }
  if (values.due === 'undated') filter.dueDate = null;
  if (values.dueBefore || values.dueAfter) {
    if (values.due === 'undated')
      throw new ApiError(
        400,
        'VALIDATION_ERROR',
        'Undated missions cannot use a date range',
      );
    filter.$and = [
      {
        dueDate: {
          ...(values.dueBefore ? { $lte: date(values.dueBefore) } : {}),
          ...(values.dueAfter ? { $gte: date(values.dueAfter) } : {}),
        },
      },
    ];
  }
  const total = await Task.countDocuments(filter);
  const field =
    values.sort === 'due'
      ? 'dueDate'
      : values.sort === 'priority'
        ? 'priorityRank'
        : 'createdAt';
  const direction = values.sort === 'newest' ? -1 : 1;
  const idDirection =
    values.sort === 'priority' || values.sort === 'newest' ? -1 : 1;
  const sort: Record<string, 1 | -1> = { [field]: direction, _id: idDirection };
  const { page: _page, limit: _limit, cursor: _cursor, ...scoped } = values;
  const scope = teamId + ':' + JSON.stringify(scoped);
  if (values.cursor) {
    const after = decodeOrderedCursor(values.cursor, scope);
    const value =
      field === 'priorityRank'
        ? after.value
        : after.value === null
          ? null
          : new Date(String(after.value));
    if (
      (field === 'priorityRank' &&
        (typeof value !== 'number' || value < 0 || value > 3)) ||
      (field === 'createdAt' && value === null) ||
      (value instanceof Date && !Number.isFinite(value.getTime()))
    )
      throw new ApiError(400, 'INVALID_CURSOR', 'Invalid page cursor');
    const comparison =
      field === 'dueDate' && value === null
        ? { dueDate: { $ne: null } }
        : { [field]: { [direction === 1 ? '$gt' : '$lt']: value } };
    const cursorFilter = {
      $or: [
        comparison,
        {
          [field]: value,
          _id: { [idDirection === 1 ? '$gt' : '$lt']: after.id },
        },
      ],
    };
    filter.$and = [
      ...(Array.isArray(filter.$and) ? filter.$and : []),
      cursorFilter,
    ];
  }
  const tasks = await Task.find(filter)
    .select('-history')
    .sort(sort)
    .skip(values.cursor ? 0 : (values.page - 1) * values.limit)
    .limit(values.limit + 1);
  const hasMore = tasks.length > values.limit;
  tasks.length = Math.min(tasks.length, values.limit);
  const last = tasks.at(-1);
  const cursorValue = last
    ? field === 'priorityRank'
      ? last.priorityRank
      : field === 'dueDate'
        ? (last.dueDate?.toISOString() ?? null)
        : last.createdAt.toISOString()
    : null;
  return {
    items: await serialize(tasks, userId, membership.role),
    page: values.page,
    total,
    pages: Math.max(1, Math.ceil(total / values.limit)),
    nextCursor:
      hasMore && last ? encodeOrderedCursor(last.id, cursorValue, scope) : null,
  };
}

export async function taskSummary(teamId: string, userId: string) {
  await authorizeTeam(teamId, userId);
  const rows = await Task.aggregate<{ _id: string; count: number }>([
    {
      $match: {
        team: new Types.ObjectId(teamId),
        deletedAt: null,
        ...approvedMissionFilter,
      },
    },
    { $group: { _id: '$status', count: { $sum: 1 } } },
  ]);
  const counts: Record<string, number> = {
    todo: 0,
    in_progress: 0,
    in_review: 0,
    done: 0,
  };
  for (const row of rows) counts[row._id] = row.count;
  return { ...counts, total: rows.reduce((sum, row) => sum + row.count, 0) };
}
async function updateTaskInternal(
  teamId: string,
  userId: string,
  taskId: string,
  input: unknown,
) {
  const membership = await authorizeTeam(teamId, userId);
  if (membership.role !== 'owner')
    throw new ApiError(
      403,
      'FORBIDDEN',
      'Only the Celestial can edit missions or change their status',
    );
  const current = await findTask(teamId, taskId);
  const values = updateTaskSchema.parse(input);
  if (values.version !== undefined && values.version !== current.__v)
    throw new ApiError(
      409,
      'TASK_CONFLICT',
      'This mission changed. Reload it before saving',
    );
  await checkAssignee(teamId, values.assigneeId);
  const start =
    values.startDate === undefined ? day(current.startDate) : values.startDate;
  const due =
    values.dueDate === undefined ? day(current.dueDate) : values.dueDate;
  if (start && due && start > due)
    throw new ApiError(
      400,
      'VALIDATION_ERROR',
      'Due date must be on or after the start date',
    );
  const changes: Change[] = [];
  const set: Record<string, unknown> = {};
  for (const key of [
    'title',
    'description',
    'status',
    'priority',
    'assigneeId',
    'startDate',
    'dueDate',
  ] as const) {
    if (values[key] === undefined) continue;
    const before =
      key === 'assigneeId'
        ? (current.assignee?.toString() ?? null)
        : key === 'startDate' || key === 'dueDate'
          ? day(current[key])
          : current[key];
    if (values[key] !== before) {
      changes.push(
        key === 'description'
          ? { field: key }
          : { field: key, from: before, to: values[key] },
      );
      set[key === 'assigneeId' ? 'assignee' : key] =
        key === 'startDate' || key === 'dueDate'
          ? date(values[key])
          : values[key];
    }
  }
  if (!changes.length)
    return (await serialize([current], userId, membership.role))[0];
  if (values.status && values.status !== current.status)
    set.completedAt = values.status === 'done' ? new Date() : null;
  if (values.priority)
    set.priorityRank = ['urgent', 'high', 'medium', 'low'].indexOf(
      values.priority,
    );
  const title = values.title ?? current.title;
  const events = [
    event(
      userId,
      'TASK_UPDATED',
      title,
      changes.filter(
        (item) => item.field !== 'status' && item.field !== 'assigneeId',
      ),
    ),
  ].filter((item) => item.changes.length);
  if (changes.some((item) => item.field === 'status'))
    events.push(
      event(
        userId,
        'STATUS_CHANGED',
        title,
        changes.filter((item) => item.field === 'status'),
      ),
    );
  if (changes.some((item) => item.field === 'assigneeId'))
    events.push(
      event(
        userId,
        'TASK_ASSIGNED',
        title,
        changes.filter((item) => item.field === 'assigneeId'),
      ),
    );
  const updated = await Task.findOneAndUpdate(
    { _id: current._id, team: teamId, deletedAt: null, __v: current.__v },
    {
      $set: set,
      $inc: { __v: 1 },
      $push: { history: { $each: events, $slice: -200 } },
    },
    { new: true },
  ).select('-history');
  if (!updated)
    throw new ApiError(
      409,
      'TASK_CONFLICT',
      'This mission changed. Reload it before saving',
    );
  if (
    values.assigneeId &&
    !(await Membership.exists({ team: teamId, user: values.assigneeId }))
  ) {
    await Task.updateOne(
      { _id: updated._id, assignee: values.assigneeId },
      {
        $set: { assignee: null },
        $inc: { __v: 1 },
        $push: {
          history: {
            $each: [
              event(userId, 'TASK_ASSIGNED', updated.title, [
                { field: 'assigneeId', from: values.assigneeId, to: null },
              ]),
            ],
            $slice: -200,
          },
        },
      },
    );
    throw new ApiError(
      409,
      'ASSIGNEE_REMOVED',
      'The assignee was removed. This mission is now unassigned',
    );
  }
  return (await serialize([updated], userId, membership.role))[0];
}
async function deleteTaskInternal(
  teamId: string,
  userId: string,
  taskId: string,
  version?: number,
) {
  const membership = await authorizeTeam(teamId, userId);
  const current = await findTask(teamId, taskId);
  if (membership.role !== 'owner')
    throw new ApiError(
      403,
      'FORBIDDEN',
      'Only the Celestial can delete missions',
    );
  if (version !== undefined && version !== current.__v)
    throw new ApiError(
      409,
      'TASK_CONFLICT',
      'This mission changed. Reload it before deleting',
    );
  const result = await Task.updateOne(
    { _id: current._id, team: teamId, deletedAt: null, __v: current.__v },
    {
      $set: { deletedAt: new Date() },
      $inc: { __v: 1 },
      $push: {
        history: {
          $each: [event(userId, 'TASK_DELETED', current.title)],
          $slice: -200,
        },
      },
    },
  );
  if (!result.modifiedCount)
    throw new ApiError(
      409,
      'TASK_CONFLICT',
      'This mission changed. Reload it before deleting',
    );
}
async function reviewProposalInternal(
  teamId: string,
  userId: string,
  taskId: string,
  input: unknown,
) {
  const membership = await authorizeTeam(teamId, userId);
  if (membership.role !== 'owner')
    throw new ApiError(
      403,
      'FORBIDDEN',
      'Only the Celestial can approve or reject mission proposals',
    );
  const values = reviewProposalSchema.parse(input);
  const current = await findTask(teamId, taskId, true);
  if (current.approvalStatus !== 'pending' || current.__v !== values.version)
    throw new ApiError(
      409,
      'TASK_CONFLICT',
      'This proposal changed or was already reviewed. Reload it',
    );
  if (values.decision === 'approved')
    await checkAssignee(teamId, current.assignee?.toString());
  const reviewed = await Task.findOneAndUpdate(
    {
      _id: current._id,
      team: teamId,
      deletedAt: null,
      approvalStatus: 'pending',
      __v: values.version,
    },
    {
      $set: {
        approvalStatus: values.decision,
        reviewedBy: userId,
        reviewedAt: new Date(),
        rejectionReason: values.decision === 'rejected' ? values.reason : '',
      },
      $inc: { __v: 1 },
      $push: {
        history: {
          $each: [
            event(
              userId,
              values.decision === 'approved'
                ? 'MISSION_APPROVED'
                : 'MISSION_REJECTED',
              current.title,
            ),
          ],
          $slice: -200,
        },
      },
    },
    { new: true },
  ).select('-history');
  if (!reviewed)
    throw new ApiError(
      409,
      'TASK_CONFLICT',
      'This proposal was already reviewed. Reload it',
    );
  return (await serialize([reviewed], userId, membership.role))[0];
}

export async function listActivity(
  teamId: string,
  userId: string,
  query: unknown,
  taskId?: string,
) {
  const membership = await authorizeTeam(teamId, userId);
  if (taskId) await findTask(teamId, taskId, membership.role !== 'member');
  const { page, limit, cursor } = paginationSchema.parse(query);
  const scope = teamId + ':' + (taskId ?? 'all') + ':' + membership.role;
  const filter: Record<string, unknown> = {
    team: teamId,
    ...(taskId ? { task: taskId } : {}),
    ...(membership.role === 'member' ? { visibleToMembers: true } : {}),
  };
  const includeTotal = (query as { count?: unknown })?.count !== 'false';
  const exactTotal = includeTotal ? await Activity.countDocuments(filter) : 0;
  if (cursor) {
    const after = decodeCursor(cursor, scope);
    filter.$or = [
      { createdAt: { $lt: after.date } },
      { createdAt: after.date, _id: { $lt: after.id } },
    ];
  }
  const rows = await Activity.find(filter)
    .sort({ createdAt: -1, _id: -1 })
    .skip(cursor ? 0 : (page - 1) * limit)
    .limit(limit + 1);
  const hasMore = rows.length > limit;
  rows.length = Math.min(rows.length, limit);
  const users = await User.find({
    _id: { $in: rows.map((r) => r.actor) },
  }).select('name');
  const tasks = await Task.find({
    _id: { $in: rows.map((r) => r.task) },
  }).select('deletedAt');
  const items = rows.map((row) => ({
    id: row.id,
    taskId: row.task.toString(),
    taskTitle: row.taskTitle,
    taskDeleted: !tasks.some((t) => t._id.equals(row.task) && !t.deletedAt),
    actor: {
      id: row.actor.toString(),
      name: users.find((u) => u._id.equals(row.actor))?.name ?? 'Former user',
    },
    type: row.type,
    changes: row.changes,
    createdAt: row.createdAt,
  }));
  const last = rows.at(-1);
  return {
    items,
    page,
    total: includeTotal ? exactTotal : rows.length,
    totalIsExact: includeTotal,
    pages: includeTotal
      ? Math.max(1, Math.ceil(exactTotal / limit))
      : hasMore
        ? page + 1
        : page,
    nextCursor:
      hasMore && last ? encodeCursor(last.id, last.createdAt, scope) : null,
  };
}

export const createTask = teamMutation(createTaskInternal);

export const updateTask = teamMutation(updateTaskInternal);

export const deleteTask = teamMutation(deleteTaskInternal);

export const reviewProposal = teamMutation(reviewProposalInternal);
