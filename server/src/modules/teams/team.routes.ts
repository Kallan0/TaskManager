import { Router } from 'express';
import { sharedLimit } from '../../middleware/sharedLimit.js';
import { authenticate } from '../../middleware/authenticate.js';
import * as teams from './team.service.js';
import * as invitations from '../invitations/invitation.service.js';
import { idSchema } from './team.validation.js';
import { listActivity } from '../tasks/task.service.js';

export const teamRouter = Router();
teamRouter.use(authenticate);
teamRouter.get('/:teamId/activity', async (req, res) =>
  res.json({
    success: true,
    data: await listActivity(req.params.teamId, res.locals.user.id, req.query),
  }),
);
teamRouter.get('/', async (req, res) =>
  res.json({
    success: true,
    data: await teams.listTeams(res.locals.user.id, req.query),
  }),
);
teamRouter.post('/', async (req, res) =>
  res.status(201).json({
    success: true,
    data: await teams.createTeam(res.locals.user.id, req.body),
  }),
);
teamRouter.get('/:teamId', async (req, res) =>
  res.json({
    success: true,
    data: await teams.getTeam(req.params.teamId, res.locals.user.id),
  }),
);
teamRouter.patch('/:teamId', async (req, res) =>
  res.json({
    success: true,
    data: await teams.updateTeam(
      req.params.teamId,
      res.locals.user.id,
      req.body,
    ),
  }),
);
teamRouter.get('/:teamId/members', async (req, res) =>
  res.json({
    success: true,
    data: await teams.listMembers(
      req.params.teamId,
      res.locals.user.id,
      req.query,
    ),
  }),
);
teamRouter.patch('/:teamId/members/:userId', async (req, res) =>
  res.json({
    success: true,
    data: await teams.changeRole(
      req.params.teamId,
      res.locals.user.id,
      req.params.userId,
      req.body,
    ),
  }),
);
teamRouter.delete('/:teamId/members/:userId', async (req, res) => {
  await teams.removeMember(
    req.params.teamId,
    res.locals.user.id,
    req.params.userId,
  );
  res.status(204).end();
});
const inviteLimit = sharedLimit('invitations', {
  windowMs: 60 * 60 * 1000,
  limit: 30,
  standardHeaders: 'draft-8',
  legacyHeaders: false,
  keyGenerator: (_req, res) => res.locals.user.id,
  message: {
    success: false,
    error: {
      code: 'RATE_LIMITED',
      message: 'Too many invitations. Try again later',
    },
  },
});
teamRouter.post('/:teamId/invitations', inviteLimit, async (req, res) =>
  res.status(201).json({
    success: true,
    data: await invitations.createInvitation(
      idSchema.parse(req.params.teamId),
      res.locals.user.id,
      req.body,
    ),
  }),
);
teamRouter.get('/:teamId/invitations', async (req, res) =>
  res.json({
    success: true,
    data: await invitations.listTeamInvitations(
      req.params.teamId,
      res.locals.user.id,
      req.query,
    ),
  }),
);
teamRouter.post(
  '/:teamId/invitations/:invitationId/approve',
  async (req, res) =>
    res.json({
      success: true,
      data: await invitations.approveInvitation(
        req.params.teamId,
        res.locals.user.id,
        req.params.invitationId,
        req.body,
      ),
    }),
);
teamRouter.delete('/:teamId/invitations/:invitationId', async (req, res) => {
  await invitations.revokeInvitation(
    req.params.teamId,
    res.locals.user.id,
    req.params.invitationId,
  );
  res.status(204).end();
});
