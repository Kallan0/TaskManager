import { request } from './client';
import { teamsApi, type Member, type Page } from './teams.api';
export const statuses = ['todo', 'in_progress', 'in_review', 'done'] as const;
export const priorities = ['low', 'medium', 'high', 'urgent'] as const;
export type Status = (typeof statuses)[number];
export type Priority = (typeof priorities)[number];
export const statusLabels: Record<Status, string> = {
  todo: 'To do',
  in_progress: 'In progress',
  in_review: 'In review',
  done: 'Done',
};
export type TaskInput = {
  title: string;
  description: string;
  status: Status;
  priority: Priority;
  assigneeId: string | null;
  startDate: string | null;
  dueDate: string | null;
};
export type Task = TaskInput & {
  id: string;
  teamId: string;
  creatorId: string;
  creator: { id: string; name: string } | null;
  assignee: { id: string; name: string } | null;
  completedAt: string | null;
  createdAt: string;
  updatedAt: string;
  version: number;
  canDelete: boolean;
  canEdit: boolean;
  canChangeStatus: boolean;
  canReview: boolean;
  approvalStatus: 'approved' | 'pending' | 'rejected';
  reviewedAt: string | null;
  rejectionReason: string;
};
export type Filters = {
  approval?: 'approved' | 'pending' | 'rejected';
  q?: string;
  status?: Status;
  priority?: Priority;
  assignee?: string;
  due?: 'overdue' | 'upcoming' | 'undated';
  sort?: 'newest' | 'oldest' | 'due' | 'priority';
  dueBefore?: string;
  dueAfter?: string;
};
export type Activity = {
  id: string;
  taskId: string;
  taskTitle: string;
  taskDeleted: boolean;
  actor: { id: string; name: string };
  type: string;
  changes: { field: string; from?: string | null; to?: string | null }[];
  createdAt: string;
};
export function localToday() {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
}
export function dateLabel(date: string) {
  return new Date(`${date}T12:00:00`).toLocaleDateString(undefined, {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  });
}
const json = (method: string, body?: unknown) => ({
  method,
  ...(body === undefined ? {} : { body: JSON.stringify(body) }),
});
export const tasksApi = {
  propose: (team: string, values: TaskInput) =>
    request<Task>(`/teams/${team}/tasks/proposals`, json('POST', values)),
  review: (
    team: string,
    task: string,
    decision: 'approved' | 'rejected',
    version: number,
    reason = '',
  ) =>
    request<Task>(
      `/teams/${team}/tasks/${task}/review`,
      json('POST', { decision, version, reason }),
    ),
  list: (team: string, filters: Filters = {}, page = 1) => {
    const params = new URLSearchParams({
      page: String(page),
      today: localToday(),
    });
    Object.entries(filters).forEach(([key, value]) => {
      if (value) params.set(key, value);
    });
    return request<Page<Task>>(`/teams/${team}/tasks?${params}`);
  },
  summary: (team: string) =>
    request<Record<Status, number> & { total: number }>(
      `/teams/${team}/tasks/summary`,
    ),
  get: (team: string, task: string) =>
    request<Task>(`/teams/${team}/tasks/${task}`),
  create: (team: string, values: TaskInput) =>
    request<Task>(`/teams/${team}/tasks`, json('POST', values)),
  update: (
    team: string,
    task: string,
    values: Partial<TaskInput> & { version: number },
  ) => request<Task>(`/teams/${team}/tasks/${task}`, json('PATCH', values)),
  status: (team: string, task: string, status: Status, version: number) =>
    request<Task>(
      `/teams/${team}/tasks/${task}/status`,
      json('PATCH', { status, version }),
    ),
  remove: (team: string, task: string, version: number) =>
    request<void>(
      `/teams/${team}/tasks/${task}?version=${version}`,
      json('DELETE'),
    ),
  activity: (team: string, task?: string, page = 1, limit = 20) =>
    request<Page<Activity>>(
      task
        ? `/teams/${team}/tasks/${task}/activity?page=${page}&limit=${limit}`
        : `/teams/${team}/activity?page=${page}&limit=${limit}`,
    ),
  members: async (team: string): Promise<Member[]> => {
    const first = await teamsApi.members(team);
    const rest = await Promise.all(
      Array.from({ length: first.pages - 1 }, (_, index) =>
        teamsApi.members(team, index + 2),
      ),
    );
    return [...first.items, ...rest.flatMap((page) => page.items)];
  },
};
