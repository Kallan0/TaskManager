import { Router } from 'express';
import { authenticate } from '../../middleware/authenticate.js';
import { idSchema } from '../teams/team.validation.js';
import {
  statusSchema,
  assigneeSchema,
  deleteTaskSchema,
} from './task.validation.js';
import * as tasks from './task.service.js';
import { taskCommentRouter } from '../comments/comment.routes.js';
export const taskRouter = Router({ mergeParams: true });
taskRouter.use(authenticate);
taskRouter.use('/:taskId/comments', taskCommentRouter);
const teamId = (params: Record<string, unknown>) =>
  idSchema.parse(params.teamId);
taskRouter.get('/', async (req, res) =>
  res.json({
    success: true,
    data: await tasks.listTasks(
      teamId(req.params),
      res.locals.user.id,
      req.query,
    ),
  }),
);
taskRouter.post('/', async (req, res) =>
  res.status(201).json({
    success: true,
    data: await tasks.createTask(
      teamId(req.params),
      res.locals.user.id,
      req.body,
    ),
  }),
);
taskRouter.get('/summary', async (req, res) =>
  res.json({
    success: true,
    data: await tasks.taskSummary(teamId(req.params), res.locals.user.id),
  }),
);
taskRouter.post('/proposals', async (req, res) =>
  res.status(201).json({
    success: true,
    data: await tasks.createTask(
      teamId(req.params),
      res.locals.user.id,
      req.body,
      true,
    ),
  }),
);
taskRouter.post('/:taskId/review', async (req, res) =>
  res.json({
    success: true,
    data: await tasks.reviewProposal(
      teamId(req.params),
      res.locals.user.id,
      req.params.taskId,
      req.body,
    ),
  }),
);
taskRouter.get('/:taskId', async (req, res) =>
  res.json({
    success: true,
    data: await tasks.getTask(
      teamId(req.params),
      res.locals.user.id,
      req.params.taskId,
    ),
  }),
);
taskRouter.patch('/:taskId', async (req, res) =>
  res.json({
    success: true,
    data: await tasks.updateTask(
      teamId(req.params),
      res.locals.user.id,
      req.params.taskId,
      req.body,
    ),
  }),
);
taskRouter.patch('/:taskId/status', async (req, res) =>
  res.json({
    success: true,
    data: await tasks.updateTask(
      teamId(req.params),
      res.locals.user.id,
      req.params.taskId,
      statusSchema.parse(req.body),
    ),
  }),
);
taskRouter.patch('/:taskId/assignee', async (req, res) =>
  res.json({
    success: true,
    data: await tasks.updateTask(
      teamId(req.params),
      res.locals.user.id,
      req.params.taskId,
      assigneeSchema.parse(req.body),
    ),
  }),
);
taskRouter.delete('/:taskId', async (req, res) => {
  const query = deleteTaskSchema.parse(req.query);
  await tasks.deleteTask(
    teamId(req.params),
    res.locals.user.id,
    req.params.taskId,
    query.version,
  );
  res.status(204).end();
});
taskRouter.get('/:taskId/activity', async (req, res) =>
  res.json({
    success: true,
    data: await tasks.listActivity(
      teamId(req.params),
      res.locals.user.id,
      req.query,
      req.params.taskId,
    ),
  }),
);
