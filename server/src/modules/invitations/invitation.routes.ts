import { Router } from 'express';
import { authenticate } from '../../middleware/authenticate.js';
import * as invitations from './invitation.service.js';
export const invitationRouter = Router();
invitationRouter.use(authenticate);
invitationRouter.get('/', async (req, res) =>
  res.json({
    success: true,
    data: await invitations.listIncomingInvitations(res.locals.user, req.query),
  }),
);
// Inbox actions are addressed by ID, but are always scoped to the authenticated recipient's email.
invitationRouter.post('/by-id/:invitationId/accept', async (req, res) =>
  res.json({
    success: true,
    data: await invitations.respondToInvitation(
      { id: req.params.invitationId },
      res.locals.user,
      'accept',
    ),
  }),
);
invitationRouter.post('/by-id/:invitationId/decline', async (req, res) =>
  res.json({
    success: true,
    data: await invitations.respondToInvitation(
      { id: req.params.invitationId },
      res.locals.user,
      'decline',
    ),
  }),
);
invitationRouter.get('/:token', async (req, res) =>
  res.json({
    success: true,
    data: await invitations.getInvitation(req.params.token, res.locals.user),
  }),
);
invitationRouter.post('/:token/accept', async (req, res) =>
  res.json({
    success: true,
    data: await invitations.respondToInvitation(
      { token: req.params.token },
      res.locals.user,
      'accept',
    ),
  }),
);
invitationRouter.post('/:token/decline', async (req, res) =>
  res.json({
    success: true,
    data: await invitations.respondToInvitation(
      { token: req.params.token },
      res.locals.user,
      'decline',
    ),
  }),
);
