import { Router } from 'express';
import { authenticate } from '../../middleware/authenticate.js';
import { idSchema } from '../teams/team.validation.js';
import * as comments from './comment.service.js';
export const taskCommentRouter = Router({ mergeParams: true });
const scope = (params: Record<string, unknown>) => ({
  teamId: idSchema.parse(params.teamId),
  taskId: idSchema.parse(params.taskId),
});
taskCommentRouter.get('/', async (req, res) => {
  const { teamId, taskId } = scope(req.params);
  res.json({
    success: true,
    data: await comments.listComments(
      teamId,
      taskId,
      res.locals.user.id,
      req.query,
    ),
  });
});
taskCommentRouter.post('/', async (req, res) => {
  const { teamId, taskId } = scope(req.params);
  res.status(201).json({
    success: true,
    data: await comments.createComment(
      teamId,
      taskId,
      res.locals.user.id,
      req.body,
    ),
  });
});
taskCommentRouter.patch('/:commentId', async (req, res) =>
  res.json({
    success: true,
    data: await comments.updateComment(
      req.params.commentId,
      res.locals.user.id,
      req.body,
      scope(req.params),
    ),
  }),
);
taskCommentRouter.delete('/:commentId', async (req, res) => {
  await comments.deleteComment(
    req.params.commentId,
    res.locals.user.id,
    comments.deleteCommentSchema.parse(req.query).version,
    scope(req.params),
  );
  res.status(204).end();
});
export const commentRouter = Router();
commentRouter.use(authenticate);
commentRouter.patch('/:commentId', async (req, res) =>
  res.json({
    success: true,
    data: await comments.updateComment(
      req.params.commentId,
      res.locals.user.id,
      req.body,
    ),
  }),
);
commentRouter.delete('/:commentId', async (req, res) => {
  await comments.deleteComment(
    req.params.commentId,
    res.locals.user.id,
    comments.deleteCommentSchema.parse(req.query).version,
  );
  res.status(204).end();
});
