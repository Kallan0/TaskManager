import {
  Link,
  useNavigate,
  useParams,
  useSearchParams,
} from 'react-router-dom';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { teamsApi } from '../api/teams.api';
import { tasksApi, statuses, type Status } from '../api/tasks.api';
import { WorkspaceLayout } from '../components/layout/WorkspaceLayout';
import { TaskForm } from '../components/tasks/TaskForm';
import { ErrorMessage, LoadingState } from '../components/common/Feedback';
export function TaskEditor() {
  const { teamId = '', taskId } = useParams();
  const [params] = useSearchParams();
  const navigate = useNavigate();
  const cache = useQueryClient();
  const team = useQuery({
    queryKey: ['team', teamId],
    queryFn: () => teamsApi.get(teamId),
  });
  const members = useQuery({
    queryKey: ['task-assignees', teamId],
    queryFn: () => tasksApi.members(teamId),
    enabled: !!team.data,
  });
  const task = useQuery({
    queryKey: ['task', teamId, taskId],
    queryFn: () => tasksApi.get(teamId, taskId!),
    enabled: !!taskId && !!team.data,
  });
  const requestedStatus = params.get('status');
  const proposal = !taskId && team.data?.role === 'admin';
  const allowed = taskId
    ? !!task.data?.canEdit
    : team.data?.role === 'owner' || proposal;
  const initialStatus =
    statuses.includes(requestedStatus as Status) && !proposal
      ? (requestedStatus as Status)
      : 'todo';
  return (
    <WorkspaceLayout title={team.data?.name ?? 'Mission'}>
      <Link
        className="back-link"
        to={
          taskId ? `/teams/${teamId}/tasks/${taskId}` : `/teams/${teamId}/tasks`
        }
      >
        ← Back to {taskId ? 'mission' : 'mission list'}
      </Link>
      <div className="page-heading">
        <div>
          <span className="eyebrow">{team.data?.name}</span>
          <h1>
            {taskId
              ? 'Edit mission'
              : proposal
                ? 'Propose mission'
                : 'Create mission'}
          </h1>
          <p className="muted">
            Give your team a clear goal and a person to move it forward.
          </p>
        </div>
      </div>
      <ErrorMessage error={team.error || members.error || task.error} />
      {team.data && (!taskId || task.data) && !allowed && (
        <ErrorMessage error="Only the Celestial can create or edit missions. Holy Knights can propose missions." />
      )}
      {proposal && (
        <p className="proposal-notice">
          Your proposal needs the Celestial’s approval before it becomes a
          mission.
        </p>
      )}
      {(team.isPending || members.isPending || (taskId && task.isPending)) && (
        <LoadingState label="Loading mission form…" cards={1} />
      )}
      {allowed && team.data && members.data && (!taskId || task.data) && (
        <section className="content-panel form-panel">
          <TaskForm
            key={`${taskId ?? 'new'}-${task.data?.version ?? 0}`}
            initial={task.data}
            proposal={proposal}
            initialStatus={initialStatus}
            members={members.data}
            onReload={() => task.refetch()}
            onSubmit={async (values) => {
              const saved = taskId
                ? await tasksApi.update(teamId, taskId, {
                    ...values,
                    version: task.data!.version,
                  })
                : proposal
                  ? await tasksApi.propose(teamId, {
                      ...values,
                      status: 'todo',
                    })
                  : await tasksApi.create(teamId, values);
              cache.setQueryData(['task', teamId, saved.id], saved);
              await Promise.all(
                [
                  'tasks',
                  'task-summary',
                  'task-activity',
                  'team-activity',
                  'mission-proposals',
                ].map((key) =>
                  cache.invalidateQueries({ queryKey: [key, teamId] }),
                ),
              );
              navigate(`/teams/${teamId}/tasks/${saved.id}`, { replace: true });
            }}
          />
        </section>
      )}
    </WorkspaceLayout>
  );
}
