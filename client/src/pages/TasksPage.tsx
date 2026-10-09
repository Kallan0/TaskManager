import { Link, useParams, useSearchParams } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Plus, List, Columns3 } from 'lucide-react';
import { teamsApi } from '../api/teams.api';
import {
  tasksApi,
  statuses,
  priorities,
  statusLabels,
  dateLabel,
  localToday,
  type Filters,
  type Status,
  type Task,
} from '../api/tasks.api';
import { WorkspaceLayout } from '../components/layout/WorkspaceLayout';
import { TeamNavigation } from '../components/teams/TeamNavigation';
import {
  ErrorMessage,
  Pagination,
  LoadingState,
} from '../components/common/Feedback';
import { TaskBoard, StatusSelect } from '../components/tasks/TaskBoard';
import { ActivityPreview } from '../components/tasks/ActivityPreview';
import { MissionProposals } from '../components/tasks/MissionProposals';
export function TasksPage({ board = false }: { board?: boolean }) {
  const { teamId = '' } = useParams();
  const [params, setParams] = useSearchParams();
  const cache = useQueryClient();
  const filters: Filters = {
    q: params.get('q') ?? '',
    status: (params.get('status') || undefined) as Filters['status'],
    priority: (params.get('priority') || undefined) as Filters['priority'],
    assignee: params.get('assignee') || undefined,
    due: (params.get('due') || undefined) as Filters['due'],
    sort: (params.get('sort') || 'newest') as Filters['sort'],
  };
  const page = Math.max(1, Number(params.get('page')) || 1);
  const team = useQuery({
    queryKey: ['team', teamId],
    queryFn: () => teamsApi.get(teamId),
  });
  const members = useQuery({
    queryKey: ['task-assignees', teamId],
    queryFn: () => tasksApi.members(teamId),
    enabled: !!team.data,
  });
  const summary = useQuery({
    queryKey: ['task-summary', teamId],
    queryFn: () => tasksApi.summary(teamId),
    enabled: !!team.data,
  });
  const tasks = useQuery({
    queryKey: ['tasks', teamId, 'list', filters, page],
    queryFn: () => tasksApi.list(teamId, filters, page),
    enabled: !!team.data && !board,
  });
  async function refresh() {
    await Promise.all(
      [
        'tasks',
        'task-summary',
        'task',
        'task-activity',
        'team-activity',
        'mission-proposals',
      ].map((key) => cache.invalidateQueries({ queryKey: [key, teamId] })),
    );
  }
  const move = useMutation({
    mutationFn: ({
      task,
      status,
    }: {
      task: Pick<Task, 'id' | 'version'>;
      status: Status;
    }) => tasksApi.status(teamId, task.id, status, task.version),
    onSettled: refresh,
  });
  function change(name: string, value: string) {
    const next = new URLSearchParams(params);
    if (value) next.set(name, value);
    else next.delete(name);
    if (name !== 'page') next.delete('page');
    setParams(next, { replace: true });
  }
  const search = params.toString() ? `?${params}` : '';
  return (
    <WorkspaceLayout title={team.data?.name ?? 'Missions'}>
      <Link className="back-link" to="/dashboard">
        ← All teams
      </Link>
      <ErrorMessage error={team.error} />
      {team.isPending && <LoadingState label="Loading team…" />}
      {team.data && (
        <>
          <div className="page-heading">
            <div>
              <span className="eyebrow">TEAM PLANNING</span>
              <h1>{team.data.name}</h1>
              <p className="muted">Keep work moving, one mission at a time.</p>
            </div>
            {team.data.role !== 'member' && (
              <Link className="primary" to={`/teams/${teamId}/tasks/new`}>
                <Plus size={17} />
                {team.data.role === 'owner'
                  ? 'Create mission'
                  : 'Propose mission'}
              </Link>
            )}
          </div>
          <TeamNavigation teamId={teamId} />
          <ErrorMessage error={summary.error} />
          {summary.isPending && (
            <LoadingState label="Loading mission totals…" cards={1} />
          )}
          {summary.data && (
            <section className="task-summary" aria-label="Team mission totals">
              <div className="summary-total">
                <span>Approved missions</span>
                <strong>{summary.data.total}</strong>
              </div>
              {statuses.map((status) => (
                <div key={status} className={`summary-${status}`}>
                  <span>{statusLabels[status]}</span>
                  <strong>{summary.data[status]}</strong>
                </div>
              ))}
            </section>
          )}
          <section className="task-toolbar" aria-label="Mission filters">
            <div className="task-search">
              <label htmlFor="task-search">Search</label>
              <input
                id="task-search"
                placeholder="Search missions…"
                maxLength={100}
                value={filters.q}
                onChange={(event) => change('q', event.target.value)}
              />
            </div>
            <div>
              <label htmlFor="filter-status">Status</label>
              <select
                id="filter-status"
                value={filters.status ?? ''}
                onChange={(event) => change('status', event.target.value)}
              >
                <option value="">All statuses</option>
                {statuses.map((status) => (
                  <option key={status} value={status}>
                    {statusLabels[status]}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label htmlFor="filter-priority">Priority</label>
              <select
                id="filter-priority"
                value={filters.priority ?? ''}
                onChange={(event) => change('priority', event.target.value)}
              >
                <option value="">All priorities</option>
                {priorities.map((priority) => (
                  <option key={priority} value={priority}>
                    {priority}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label htmlFor="filter-assignee">Assignee</label>
              <select
                id="filter-assignee"
                disabled={members.isPending}
                value={filters.assignee ?? ''}
                onChange={(event) => change('assignee', event.target.value)}
              >
                <option value="">Everyone</option>
                <option value="unassigned">Unassigned</option>
                {members.data?.map((member) => (
                  <option key={member.id} value={member.id}>
                    {member.name}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label htmlFor="filter-due">Due date</label>
              <select
                id="filter-due"
                value={filters.due ?? ''}
                onChange={(event) => change('due', event.target.value)}
              >
                <option value="">Any date</option>
                <option value="overdue">Overdue</option>
                <option value="upcoming">Next 7 days</option>
                <option value="undated">No due date</option>
              </select>
            </div>
            <div>
              <label htmlFor="filter-sort">Sort</label>
              <select
                id="filter-sort"
                value={filters.sort}
                onChange={(event) => change('sort', event.target.value)}
              >
                <option value="newest">Newest first</option>
                <option value="oldest">Oldest first</option>
                <option value="due">Due date</option>
                <option value="priority">Priority</option>
              </select>
            </div>
            <button className="quiet" onClick={() => setParams({})}>
              Clear filters
            </button>
          </section>
          <ErrorMessage error={members.error} />
          <ErrorMessage error={move.error} />
          <div className="task-view-heading">
            <span>
              {board
                ? team.data.role === 'owner'
                  ? 'Drag mission cards between columns or change their status.'
                  : 'View missions and open a card to discuss progress.'
                : `${tasks.data?.total ?? 0} matching missions`}
            </span>
            <div className="view-toggle">
              <Link
                className={!board ? 'active' : ''}
                to={`/teams/${teamId}/tasks${search}`}
              >
                <List size={15} />
                List
              </Link>
              <Link
                className={board ? 'active' : ''}
                to={`/teams/${teamId}/board${search}`}
              >
                <Columns3 size={15} />
                Board
              </Link>
            </div>
          </div>
          {board ? (
            <TaskBoard
              teamId={teamId}
              filters={filters}
              busy={move.isPending}
              role={team.data.role}
              onMove={(task, status) => move.mutate({ task, status })}
            />
          ) : (
            <>
              <ErrorMessage error={tasks.error} />
              {tasks.isPending && <LoadingState label="Loading missions…" />}
              {tasks.data?.total === 0 && (
                <section className="empty-panel">
                  <h2>No missions to show</h2>
                  <p>
                    {team.data.role === 'member'
                      ? 'Approved missions will appear here. You can also change the filters.'
                      : 'Create or propose a mission, or change the filters.'}
                  </p>
                  {team.data.role !== 'member' && (
                    <Link className="primary" to={`/teams/${teamId}/tasks/new`}>
                      {team.data.role === 'owner'
                        ? 'Create mission'
                        : 'Propose mission'}
                    </Link>
                  )}
                </section>
              )}
              {!!tasks.data?.items.length && (
                <div className="task-table-wrap">
                  <table className="task-table">
                    <thead>
                      <tr>
                        <th>Mission</th>
                        <th>Status</th>
                        <th>Priority</th>
                        <th>Assignee</th>
                        <th>Due date</th>
                        <th>Discussion</th>
                      </tr>
                    </thead>
                    <tbody>
                      {tasks.data.items.map((task) => (
                        <tr key={task.id}>
                          <td>
                            <Link to={`/teams/${teamId}/tasks/${task.id}`}>
                              {task.title}
                            </Link>
                            <small>
                              Created by {task.creator?.name ?? 'Former user'}
                            </small>
                          </td>
                          <td>
                            <StatusSelect
                              task={task}
                              disabled={move.isPending}
                              onMove={(task, status) =>
                                move.mutate({ task, status })
                              }
                            />
                          </td>
                          <td>
                            <span className={`priority-badge ${task.priority}`}>
                              {task.priority}
                            </span>
                          </td>
                          <td>{task.assignee?.name ?? 'Unassigned'}</td>
                          <td
                            className={
                              task.dueDate &&
                              task.dueDate < localToday() &&
                              task.status !== 'done'
                                ? 'overdue-date'
                                : ''
                            }
                          >
                            {task.dueDate
                              ? dateLabel(task.dueDate)
                              : 'No due date'}
                          </td>
                          <td>
                            <Link
                              className="secondary"
                              aria-label={`Open mission & comments for ${task.title}`}
                              to={`/teams/${teamId}/tasks/${task.id}`}
                            >
                              Open mission & comments
                            </Link>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
              {tasks.data && (
                <Pagination
                  page={page}
                  pages={tasks.data.pages}
                  onChange={(page) => change('page', String(page))}
                />
              )}
            </>
          )}
          <div className="content-panel activity-panel">
            {team.data.role !== 'member' && (
              <MissionProposals key={teamId} teamId={teamId} />
            )}
            <ActivityPreview key={teamId} teamId={teamId} />
          </div>
        </>
      )}
    </WorkspaceLayout>
  );
}
