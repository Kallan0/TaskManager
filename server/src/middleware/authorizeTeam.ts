import { Membership } from '../modules/memberships/membership.model.js';
import { idSchema } from '../modules/teams/team.validation.js';
import { ApiError } from '../utils/ApiError.js';
export async function authorizeTeam(teamId: string, userId: string) {
  idSchema.parse(teamId);
  const membership = await Membership.findOne({ team: teamId, user: userId });
  if (!membership)
    throw new ApiError(403, 'FORBIDDEN', 'You do not belong to this team');
  return membership;
}
export function requireManager(role: string) {
  if (!['owner', 'admin'].includes(role))
    throw new ApiError(
      403,
      'FORBIDDEN',
      'Only the Celestial or Holy Knights can do this',
    );
}
