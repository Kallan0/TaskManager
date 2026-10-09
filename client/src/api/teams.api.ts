import { request } from './client';
export type Role = 'owner' | 'admin' | 'member';
export type Team = {
  id: string;
  name: string;
  description: string;
  ownerId: string;
  role: Role;
  createdAt: string;
  memberCount?: number;
};
export type Member = {
  id: string;
  name: string;
  email: string;
  role: Role;
  joinedAt: string;
};
export type Invitation = {
  id: string;
  teamId: string;
  teamName?: string;
  email: string;
  role: 'admin' | 'member';
  status: 'pending' | 'accepted' | 'declined' | 'revoked' | 'expired';
  expiresAt: string;
  createdAt: string;
  inviteUrl?: string;
};
export type Page<T> = {
  items: T[];
  page: number;
  total: number;
  pages: number;
};
const json = (method: string, values?: unknown) => ({
  method,
  ...(values === undefined ? {} : { body: JSON.stringify(values) }),
});
export const teamsApi = {
  list: (page = 1) => request<Page<Team>>(`/teams?page=${page}`),
  create: (values: { name: string; description: string }) =>
    request<Team>('/teams', json('POST', values)),
  get: (id: string) => request<Team>(`/teams/${id}`),
  update: (id: string, values: { name: string; description: string }) =>
    request<Team>(`/teams/${id}`, json('PATCH', values)),
  members: (id: string, page = 1) =>
    request<Page<Member>>(`/teams/${id}/members?page=${page}`),
  changeRole: (id: string, userId: string, role: 'admin' | 'member') =>
    request(`/teams/${id}/members/${userId}`, json('PATCH', { role })),
  remove: (id: string, userId: string) =>
    request<void>(`/teams/${id}/members/${userId}`, json('DELETE')),
  invite: (id: string, values: { email: string; role: 'admin' | 'member' }) =>
    request<Invitation>(`/teams/${id}/invitations`, json('POST', values)),
  invitations: (id: string, page = 1) =>
    request<Page<Invitation>>(`/teams/${id}/invitations?page=${page}`),
  revoke: (id: string, invitationId: string) =>
    request<void>(`/teams/${id}/invitations/${invitationId}`, json('DELETE')),
};
export const invitationsApi = {
  incoming: (page = 1) =>
    request<Page<Invitation>>(`/invitations?page=${page}`),
  get: (token: string) => request<Invitation>(`/invitations/${token}`),
  respond: (id: string, action: 'accept' | 'decline', byId = true) =>
    request<{ teamId: string; status: string }>(
      `/invitations/${byId ? 'by-id/' : ''}${id}/${action}`,
      json('POST'),
    ),
};
