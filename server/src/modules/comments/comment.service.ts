import { encodeCursor, decodeCursor } from '../../utils/cursor.js';
import { mutation, captureEvent } from '../../utils/mutation.js';
import { Types, type HydratedDocument, type InferSchemaType } from 'mongoose';
import { z } from 'zod';
import { TaskComment } from './comment.model.js';
import { Task, approvedMissionFilter } from '../tasks/task.model.js';
import { User } from '../auth/user.model.js';
import { idSchema, paginationSchema } from '../teams/team.validation.js';
import { authorizeTeam } from '../../middleware/authorizeTeam.js';
import { ApiError } from '../../utils/ApiError.js';
const bodySchema = z
  .string()
  .trim()
  .min(1, 'Write a comment before posting')
  .max(4000, 'Use at most 4000 characters');
const createSchema = z.object({ body: bodySchema }).strict();
const updateSchema = createSchema.extend({
  version: z.number().int().nonnegative(),
});
export const deleteCommentSchema = z
  .object({ version: z.coerce.number().int().nonnegative() })
  .strict();
type CommentDoc = HydratedDocument<InferSchemaType<typeof TaskComment.schema>>;
type Scope = { teamId: string; taskId: string };
async function authorizeMission(
  teamId: string,
  taskId: string,
  userId: string,
) {
  const membership = await authorizeTeam(teamId, userId);
  idSchema.parse(taskId);
  const task = await Task.findOne({
    _id: taskId,
    team: teamId,
    deletedAt: null,
    ...approvedMissionFilter,
  }).select('title');
  if (!task)
    throw new ApiError(404, 'NOT_FOUND', 'Mission not found in this team');
  return { role: membership.role, task };
}
async function serialize(comments: CommentDoc[], userId: string, role: string) {
  const users = await User.find({
    _id: { $in: comments.map((comment) => comment.author) },
  }).select('name');
  return comments.map((comment) => ({
    id: comment.id,
    teamId: comment.team.toString(),
    taskId: comment.task.toString(),
    author: {
      id: comment.author.toString(),
      name:
        users.find((user) => user._id.equals(comment.author))?.name ??
        'Former user',
    },
    body: comment.body,
    editedAt: comment.editedAt,
    createdAt: comment.createdAt,
    updatedAt: comment.updatedAt,
    version: comment.__v,
    canEdit: comment.author.toString() === userId,
    canDelete: comment.author.toString() === userId || role !== 'member',
  }));
}
function event(actor: string, type: string, taskTitle: string) {
  const id = new Types.ObjectId();
  captureEvent(id);
  return {
    _id: id,
    actor,
    type,
    taskTitle,
    changes: [],
    createdAt: new Date(),
  };
}
export async function listComments(
  teamId: string,
  taskId: string,
  userId: string,
  query: unknown,
) {
  const { role } = await authorizeMission(teamId, taskId, userId);
  const { page, limit, cursor } = paginationSchema.parse(query);
  const filter: Record<string, unknown> = {
    team: teamId,
    task: taskId,
    deletedAt: null,
  };
  const total = await TaskComment.countDocuments(filter);
  const scope = teamId + ':' + taskId;
  const remainder = total % limit || limit;
  const lastBoundary =
    total > limit
      ? await TaskComment.findOne(filter)
          .select('createdAt')
          .sort({ createdAt: -1, _id: -1 })
          .skip(remainder)
      : null;
  const lastCursor = lastBoundary
    ? encodeCursor(lastBoundary.id, lastBoundary.createdAt, scope)
    : null;
  if (cursor) {
    const after = decodeCursor(cursor, scope);
    filter.$or = [
      { createdAt: { $gt: after.date } },
      { createdAt: after.date, _id: { $gt: after.id } },
    ];
  }
  const comments = await TaskComment.find(filter)
    .select('-history')
    .sort({ createdAt: 1, _id: 1 })
    .skip(cursor ? 0 : (page - 1) * limit)
    .limit(limit + 1);
  const hasMore = comments.length > limit;
  comments.length = Math.min(comments.length, limit);
  const last = comments.at(-1);
  return {
    items: await serialize(comments, userId, role),
    lastCursor,
    nextCursor:
      hasMore && last ? encodeCursor(last.id, last.createdAt, scope) : null,
    page,
    total,
    pages: Math.max(1, Math.ceil(total / limit)),
  };
}
async function createCommentInternal(
  teamId: string,
  taskId: string,
  userId: string,
  input: unknown,
) {
  const { role, task } = await authorizeMission(teamId, taskId, userId);
  const { body } = createSchema.parse(input);
  const comment = await TaskComment.create({
    team: teamId,
    task: taskId,
    author: userId,
    body,
    history: [event(userId, 'COMMENT_ADDED', task.title)],
  });
  // Reconcile a mission deletion that raced creation on standalone MongoDB.
  if (!(await Task.exists({ _id: taskId, team: teamId, deletedAt: null }))) {
    await TaskComment.deleteOne({ _id: comment._id });
    throw new ApiError(
      404,
      'NOT_FOUND',
      'This mission was deleted before your comment was saved',
    );
  }
  return (await serialize([comment], userId, role))[0];
}
async function findAuthorized(
  commentId: string,
  userId: string,
  scope?: Scope,
) {
  idSchema.parse(commentId);
  if (scope) await authorizeMission(scope.teamId, scope.taskId, userId);
  const comment = await TaskComment.findOne({
    _id: commentId,
    deletedAt: null,
    ...(scope ? { team: scope.teamId, task: scope.taskId } : {}),
  }).select('-history');
  if (!comment) throw new ApiError(404, 'NOT_FOUND', 'Comment not found');
  const access = await authorizeMission(
    comment.team.toString(),
    comment.task.toString(),
    userId,
  );
  return { comment, ...access };
}
const conflict = () =>
  new ApiError(
    409,
    'COMMENT_CONFLICT',
    'This comment changed. Reload it before trying again',
  );
async function updateCommentInternal(
  commentId: string,
  userId: string,
  input: unknown,
  scope?: Scope,
) {
  const { comment, role, task } = await findAuthorized(
    commentId,
    userId,
    scope,
  );
  if (comment.author.toString() !== userId)
    throw new ApiError(403, 'FORBIDDEN', 'Only the comment author can edit it');
  const { body, version } = updateSchema.parse(input);
  if (version !== undefined && version !== comment.__v) throw conflict();
  if (body === comment.body)
    return (await serialize([comment], userId, role))[0];
  const updated = await TaskComment.findOneAndUpdate(
    { _id: comment._id, deletedAt: null, __v: comment.__v },
    {
      $set: { body, editedAt: new Date() },
      $inc: { __v: 1 },
      $push: {
        history: {
          $each: [event(userId, 'COMMENT_EDITED', task.title)],
          $slice: -200,
        },
      },
    },
    { new: true },
  ).select('-history');
  if (!updated) throw conflict();
  return (await serialize([updated], userId, role))[0];
}
async function deleteCommentInternal(
  commentId: string,
  userId: string,
  version?: number,
  scope?: Scope,
) {
  const { comment, role, task } = await findAuthorized(
    commentId,
    userId,
    scope,
  );
  if (comment.author.toString() !== userId && role === 'member')
    throw new ApiError(
      403,
      'FORBIDDEN',
      'Only the author, Celestial or Holy Knights can delete this comment',
    );
  if (version !== undefined && version !== comment.__v) throw conflict();
  const result = await TaskComment.updateOne(
    { _id: comment._id, deletedAt: null, __v: comment.__v },
    {
      $set: { deletedAt: new Date(), body: '' },
      $inc: { __v: 1 },
      $push: {
        history: {
          $each: [event(userId, 'COMMENT_DELETED', task.title)],
          $slice: -200,
        },
      },
    },
  );
  if (!result.modifiedCount) throw conflict();
}

export const createComment = (
  team: string,
  task: string,
  user: string,
  input: unknown,
) => mutation(team, () => createCommentInternal(team, task, user, input));
async function commentMutation<T>(id: string, work: () => Promise<T>) {
  idSchema.parse(id);
  const comment = await TaskComment.findById(id).select('team');
  if (!comment) throw new ApiError(404, 'NOT_FOUND', 'Comment not found');
  return mutation(comment.team.toString(), work);
}
export const updateComment = (
  id: string,
  user: string,
  input: unknown,
  scope?: Scope,
) => commentMutation(id, () => updateCommentInternal(id, user, input, scope));
export const deleteComment = (
  id: string,
  user: string,
  version?: number,
  scope?: Scope,
) => commentMutation(id, () => deleteCommentInternal(id, user, version, scope));
