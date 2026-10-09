import { Link, useNavigate, useParams } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { tasksApi, dateLabel, localToday, type Status } from '../api/tasks.api';
import { WorkspaceLayout } from '../components/layout/WorkspaceLayout';
import { ErrorMessage, LoadingState } from '../components/common/Feedback';
import { StatusSelect } from '../components/tasks/TaskBoard';
import { ActivityPreview } from '../components/tasks/ActivityPreview';
import { MissionDiscussion } from '../components/comments/MissionDiscussion';
import { ProposalReview } from '../components/tasks/ProposalReview';
export function TaskDetail() {
  const { teamId = '', taskId = '' } = useParams();
  const cache = useQueryClient();
  const navigate = useNavigate();
  const task = useQuery({
    queryKey: ['task', teamId, taskId],
    queryFn: () => tasksApi.get(teamId, taskId),
  });
  async function refresh() {
    await Promise.all(
      [
        'task',
        'tasks',
        'task-summary',
        'task-activity',
        'team-activity',
        'mission-proposals',
      ].map((key) => cache.invalidateQueries({ queryKey: [key, teamId] })),
    );
  }
  const move = useMutation({
    mutationFn: (status: Status) =>
      tasksApi.status(teamId, taskId, status, task.data!.version),
    onSuccess: (saved) => cache.setQueryData(['task', teamId, taskId], saved),
    onSettled: refresh,
  });
  const remove = useMutation({
    mutationFn: () => tasksApi.remove(teamId, taskId, task.data!.version),
    onSuccess: async () => {
      cache.removeQueries({ queryKey: ['task', teamId, taskId] });
      await Promise.all(
        ['tasks', 'task-summary', 'team-activity'].map((key) =>
          cache.invalidateQueries({ queryKey: [key, teamId] }),
        ),
      );
      navigate(`/teams/${teamId}/tasks`, { replace: true });
    },
  });
  const busy = move.isPending || remove.isPending;
  return (
    <WorkspaceLayout title="Mission details">
      <Link className="back-link" to={`/teams/${teamId}/tasks`}>
        ← Mission list
      </Link>
      <ErrorMessage error={task.error || move.error || remove.error} />
      {task.isPending && <LoadingState label="Loading mission…" cards={2} />}
      {task.data && (
        <>
          <div className="page-heading">
            <div>
              <span className="eyebrow">
                {task.data.approvalStatus === 'approved'
                  ? 'MISSION DETAILS'
                  : 'MISSION PROPOSAL'}
              </span>
              <h1>{task.data.title}</h1>
              <p className="muted">
                {task.data.approvalStatus === 'approved'
                  ? 'Created'
                  : 'Proposed'}{' '}
                by {task.data.creator?.name ?? 'Former user'} ·{' '}
                {new Date(task.data.createdAt).toLocaleDateString()}
              </p>
            </div>
            <div className="action-row">
              {task.data.canEdit && (
                <Link
                  className="primary"
                  to={`/teams/${teamId}/tasks/${taskId}/edit`}
                >
                  Edit mission
                </Link>
              )}
              {task.data.canDelete && (
                <button
                  className="secondary danger-button"
                  disabled={busy}
                  onClick={() => {
                    if (
                      window.confirm(
                        `Delete “${task.data!.title}”? It will be removed from mission views.`,
                      )
                    )
                      remove.mutate();
                  }}
                >
                  {remove.isPending ? 'Deleting…' : 'Delete mission'}
                </button>
              )}
            </div>
          </div>
          {task.data.approvalStatus === 'pending' && (
            <p className="proposal-notice">
              Awaiting the Celestial’s approval. This proposal is not yet
              visible to Commoners.
            </p>
          )}
          {task.data.approvalStatus === 'rejected' && (
            <p className="proposal-notice rejected">
              Proposal rejected
              {task.data.rejectionReason
                ? `: ${task.data.rejectionReason}`
                : '. You can submit a new proposal.'}
            </p>
          )}
          {task.data.canReview && (
            <ProposalReview
              task={task.data}
              onReload={() => task.refetch()}
              onReviewed={async (saved) => {
                cache.setQueryData(['task', teamId, taskId], saved);
                await refresh();
              }}
            />
          )}
          <div className="task-detail-grid">
            <div>
              <section className="content-panel">
                <h2 className="panel-title">Description</h2>
                <p className="task-description">
                  {task.data.description || 'No description added yet.'}
                </p>
              </section>
              {task.data.approvalStatus === 'approved' && (
                <section className="content-panel discussion-panel">
                  <MissionDiscussion
                    key={taskId}
                    teamId={teamId}
                    taskId={taskId}
                  />
                </section>
              )}
            </div>
            <div>
              <section className="content-panel task-properties">
                <div>
                  <span>Status</span>
                  <StatusSelect
                    task={task.data}
                    disabled={busy}
                    onMove={(_task, status) => move.mutate(status)}
                  />
                </div>
                <div>
                  <span>Priority</span>
                  <span className={`priority-badge ${task.data.priority}`}>
                    {task.data.priority}
                  </span>
                </div>
                <div>
                  <span>Assignee</span>
                  <strong>{task.data.assignee?.name ?? 'Unassigned'}</strong>
                </div>
                <div>
                  <span>Start date</span>
                  <strong>
                    {task.data.startDate
                      ? dateLabel(task.data.startDate)
                      : 'Not set'}
                  </strong>
                </div>
                <div>
                  <span>Due date</span>
                  <strong
                    className={
                      task.data.dueDate &&
                      task.data.dueDate < localToday() &&
                      task.data.status !== 'done'
                        ? 'overdue-date'
                        : ''
                    }
                  >
                    {task.data.dueDate
                      ? dateLabel(task.data.dueDate)
                      : 'Not set'}
                  </strong>
                </div>
                {task.data.completedAt && (
                  <div>
                    <span>Completed</span>
                    <strong>
                      {new Date(task.data.completedAt).toLocaleString()}
                    </strong>
                  </div>
                )}
              </section>
              <section className="content-panel">
                <ActivityPreview
                  key={`${teamId}-${taskId}`}
                  teamId={teamId}
                  taskId={taskId}
                />
              </section>
              <section className="content-panel command-guide">
                <h2 className="panel-title">A clear chain of command</h2>
                <p>
                  The Celestial creates and manages missions. Holy Knights
                  propose missions for approval. Commoners view approved
                  missions and join the discussion.
                </p>
                <p>
                  Authors can edit or delete their own comments. The Celestial
                  and Holy Knights can remove other comments, but cannot edit
                  their text.
                </p>
              </section>
            </div>
          </div>
        </>
      )}
    </WorkspaceLayout>
  );
}
