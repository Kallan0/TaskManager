import { request } from './client';
import type { Page } from './teams.api';
export type MissionComment = {
  id: string;
  teamId: string;
  taskId: string;
  author: { id: string; name: string };
  body: string;
  editedAt: string | null;
  createdAt: string;
  updatedAt: string;
  version: number;
  canEdit: boolean;
  canDelete: boolean;
};
const path = (team: string, mission: string) =>
  `/teams/${team}/tasks/${mission}/comments`;
export const commentsApi = {
  list: (team: string, mission: string, page = 1) =>
    request<Page<MissionComment>>(`${path(team, mission)}?page=${page}`),
  create: (team: string, mission: string, body: string) =>
    request<MissionComment>(path(team, mission), {
      method: 'POST',
      body: JSON.stringify({ body }),
    }),
  update: (
    team: string,
    mission: string,
    comment: string,
    body: string,
    version: number,
  ) =>
    request<MissionComment>(`${path(team, mission)}/${comment}`, {
      method: 'PATCH',
      body: JSON.stringify({ body, version }),
    }),
  remove: (team: string, mission: string, comment: string, version: number) =>
    request<void>(`${path(team, mission)}/${comment}?version=${version}`, {
      method: 'DELETE',
    }),
};
