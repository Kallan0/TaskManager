import { teamMutation, mutation } from '../../utils/mutation.js';
import { createHash, randomBytes } from 'node:crypto';
import { AssignmentCleanup } from '../teams/cleanup.model.js';
import { Invitation } from './invitation.model.js';
import {
  Membership,
  memberSearchKeys,
} from '../memberships/membership.model.js';
import { Team } from '../teams/team.model.js';
import { User, type PublicUser } from '../auth/user.model.js';
import {
  authorizeTeam,
  requireManager,
} from '../../middleware/authorizeTeam.js';
import { ApiError } from '../../utils/ApiError.js';
import { env } from '../../config/env.js';
import {
  idSchema,
  inviteSchema,
  tokenSchema,
  paginationSchema,
} from '../teams/team.validation.js';

const hash = (token: string) =>
  createHash('sha256').update(token).digest('hex');
function serializeInvitation(invite: {
  _id: { toString(): string };
  invitedEmail: string;
  role: string;
  status: string;
  expiresAt: Date;
  createdAt: Date;
  team: { toString(): string };
}) {
  return {
    id: invite._id.toString(),
    teamId: invite.team.toString(),
    email: invite.invitedEmail,
    role: invite.role,
    status:
      ['pending', 'requested'].includes(invite.status) &&
      invite.expiresAt <= new Date()
        ? 'expired'
        : invite.status,
    expiresAt: invite.expiresAt,
    createdAt: invite.createdAt,
  };
}
async function createInvitationInternal(
  teamId: string,
  actorId: string,
  input: unknown,
) {
  const membership = await authorizeTeam(teamId, actorId);
  requireManager(membership.role);
  const { email, role } = inviteSchema.parse(input);
  if (role === 'admin' && membership.role !== 'owner')
    throw new ApiError(
      403,
      'FORBIDDEN',
      'Only the Celestial can invite Holy Knights',
    );
  const team = await Team.findById(teamId);
  if (!team) throw new ApiError(404, 'NOT_FOUND', 'Team not found');
  const user = await User.findOne({ email });
  if (user && (await Membership.exists({ team: teamId, user: user._id })))
    throw new ApiError(
      409,
      'CONFLICT',
      'This person already belongs to the team',
    );
  await Invitation.updateMany(
    {
      team: teamId,
      invitedEmail: email,
      status: 'pending',
      expiresAt: { $lte: new Date() },
    },
    { $set: { status: 'expired' } },
  );
  const token = randomBytes(32).toString('hex');
  const invite = await Invitation.create({
    team: teamId,
    invitedEmail: email,
    role,
    tokenHash: hash(token),
    invitedBy: actorId,
    expiresAt: new Date(Date.now() + 48 * 60 * 60 * 1000),
  });
  const inviteUrl = `${env.CLIENT_URL}/invitations/${token}`;
  return {
    ...serializeInvitation(invite),
    inviteUrl,
  };
}
export async function listTeamInvitations(
  teamId: string,
  actorId: string,
  query: unknown,
) {
  requireManager((await authorizeTeam(teamId, actorId)).role);
  const { page, limit } = paginationSchema.parse(query);
  const total = await Invitation.countDocuments({ team: teamId });
  const invites = await Invitation.find({ team: teamId })
    .sort({ createdAt: -1, _id: -1 })
    .skip((page - 1) * limit)
    .limit(limit);
  const applicants = await User.find({
    _id: {
      $in: invites.flatMap((i) => (i.requestedBy ? [i.requestedBy] : [])),
    },
  }).select('name email');
  return {
    items: invites.map((invite) => {
      const applicant = applicants.find(
        (p) => invite.requestedBy && p._id.equals(invite.requestedBy),
      );
      return {
        ...serializeInvitation(invite),
        applicant: applicant
          ? { id: applicant.id, name: applicant.name, email: applicant.email }
          : null,
      };
    }),
    page,
    total,
    pages: Math.max(1, Math.ceil(total / limit)),
  };
}
export async function listIncomingInvitations(
  user: PublicUser,
  query: unknown,
) {
  const { page, limit } = paginationSchema.parse(query);
  const filter = {
    requestedBy: user.id,
    status: { $in: ['requested', 'accepted'] },
    expiresAt: { $gt: new Date() },
  };
  const total = await Invitation.countDocuments(filter);
  const invites = await Invitation.find(filter)
    .sort({ createdAt: -1, _id: -1 })
    .skip((page - 1) * limit)
    .limit(limit);
  const teams = await Team.find({
    _id: { $in: invites.map((item) => item.team) },
  });
  return {
    items: invites.flatMap((invite) => {
      const team = teams.find((item) => item._id.equals(invite.team));
      return team
        ? [{ ...serializeInvitation(invite), teamName: team.name }]
        : [];
    }),
    page,
    total,
    pages: Math.max(1, Math.ceil(total / limit)),
  };
}
export async function findInvitation(
  selector: { token: string } | { id: string },
  user: PublicUser,
) {
  const lookup =
    'token' in selector
      ? { tokenHash: hash(tokenSchema.parse(selector.token)) }
      : { _id: idSchema.parse(selector.id), requestedBy: user.id };
  const invite = await Invitation.findOne({
    ...lookup,
    invitedEmail: user.email,
  });
  if (!invite)
    throw new ApiError(
      404,
      'NOT_FOUND',
      'Invitation not found. Sign in with the invited email address',
    );
  const team = await Team.findById(invite.team);
  if (!team) throw new ApiError(404, 'NOT_FOUND', 'This team no longer exists');
  return { invite, team };
}
export async function getInvitation(token: string, user: PublicUser) {
  const { invite, team } = await findInvitation({ token }, user);
  return { ...serializeInvitation(invite), teamName: team.name };
}
async function respondToInvitationInternal(
  selector: { token: string } | { id: string },
  user: PublicUser,
  action: 'accept' | 'decline',
) {
  const { invite, team } = await findInvitation(selector, user);
  if (action === 'accept' && invite.status === 'accepted') {
    if (await Membership.exists({ team: team._id, user: user.id }))
      return { teamId: team._id.toString(), status: 'accepted' };
    throw new ApiError(
      409,
      'INVITATION_USED',
      'This invitation has already been used. Ask the Celestial for a new invitation',
    );
  }
  if (
    !['pending', 'requested'].includes(invite.status) ||
    invite.expiresAt <= new Date()
  )
    throw new ApiError(
      409,
      'INVITATION_UNAVAILABLE',
      'This invitation is expired or no longer pending',
    );
  if (
    action === 'accept' &&
    invite.status === 'requested' &&
    invite.requestedBy?.toString() === user.id
  )
    return { teamId: team.id, status: 'requested' };
  const nextStatus = action === 'accept' ? 'requested' : 'declined';
  // Claim the invitation before granting membership: acceptance and revocation cannot both win.
  const claimed = await Invitation.findOneAndUpdate(
    {
      _id: invite._id,
      status:
        action === 'decline' ? { $in: ['pending', 'requested'] } : 'pending',
      expiresAt: { $gt: new Date() },
    },
    { $set: { status: nextStatus, requestedBy: user.id } },
    { new: true },
  );
  if (!claimed)
    throw new ApiError(
      409,
      'INVITATION_UNAVAILABLE',
      'This invitation has already been handled',
    );
  return { teamId: team._id.toString(), status: nextStatus };
}
async function revokeInvitationInternal(
  teamId: string,
  actorId: string,
  invitationId: string,
) {
  requireManager((await authorizeTeam(teamId, actorId)).role);
  idSchema.parse(invitationId);
  const result = await Invitation.updateOne(
    {
      _id: invitationId,
      team: teamId,
      status: { $in: ['pending', 'requested'] },
    },
    { $set: { status: 'revoked' } },
  );
  if (!result.modifiedCount)
    throw new ApiError(
      409,
      'INVITATION_UNAVAILABLE',
      'Invitation does not exist or is no longer pending',
    );
}

export const createInvitation = teamMutation(createInvitationInternal);

export const revokeInvitation = teamMutation(revokeInvitationInternal);

export async function respondToInvitation(
  selector: { token: string } | { id: string },
  user: PublicUser,
  action: 'accept' | 'decline',
) {
  const { team } = await findInvitation(selector, user);
  return mutation(team.id, () =>
    respondToInvitationInternal(selector, user, action),
  );
}
export const approveInvitation = teamMutation(
  async (teamId: string, actorId: string, id: string, input: unknown) => {
    const access = await authorizeTeam(teamId, actorId);
    if (access.role !== 'owner')
      throw new ApiError(
        403,
        'FORBIDDEN',
        'Only the Celestial can confirm a new crew member',
      );
    idSchema.parse(id);
    const applicantId = idSchema.parse(
      (input as { applicantId?: unknown })?.applicantId,
    );
    if (await AssignmentCleanup.exists({ team: teamId, user: applicantId }))
      throw new ApiError(
        409,
        'CLEANUP_PENDING',
        'Earlier assignments are still being cleared. Try again shortly',
      );
    const invite = await Invitation.findOneAndUpdate(
      {
        _id: id,
        team: teamId,
        status: 'requested',
        requestedBy: applicantId,
        expiresAt: { $gt: new Date() },
      },
      { $set: { status: 'accepted' } },
      { new: true },
    );
    if (!invite)
      throw new ApiError(
        409,
        'INVITATION_UNAVAILABLE',
        'This request changed or expired. Refresh before approving',
      );
    const applicant = await User.findById(applicantId).select('name email');
    if (!applicant)
      throw new ApiError(
        404,
        'NOT_FOUND',
        'Applicant account no longer exists',
      );
    await Membership.updateOne(
      { team: teamId, user: applicantId },
      {
        $setOnInsert: {
          role: invite.role,
          joinedAt: new Date(),
          searchKeys: memberSearchKeys(applicant.name, applicant.email),
        },
      },
      { upsert: true },
    );
    return { teamId, status: 'accepted' };
  },
);
