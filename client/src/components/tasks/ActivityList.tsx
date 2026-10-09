import { useState } from 'react';
import { Link } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { tasksApi, statusLabels, type Status } from '../../api/tasks.api';
import { ErrorMessage, Pagination, LoadingState } from '../common/Feedback';
const labels: Record<string, string> = {
  TASK_CREATED: 'created the mission',
  TASK_UPDATED: 'updated the mission',
  TASK_ASSIGNED: 'changed the assignee',
  STATUS_CHANGED: 'changed the status',
  TASK_DELETED: 'deleted the mission',
  COMMENT_ADDED: 'added a comment',
  COMMENT_EDITED: 'edited a comment',
  COMMENT_DELETED: 'deleted a comment',
  MISSION_PROPOSED: 'proposed a mission',
  MISSION_APPROVED: 'approved the mission',
  MISSION_REJECTED: 'rejected the mission proposal',
};
export function ActivityList({
  teamId,
  taskId,
  latestOnly = false,
}: {
  teamId: string;
  taskId?: string;
  latestOnly?: boolean;
}) {
  const [page, setPage] = useState(1);
  const activity = useQuery({
    queryKey: [
      taskId ? 'task-activity' : 'team-activity',
      teamId,
      taskId,
      latestOnly ? 'latest' : page,
    ],
    queryFn: () => tasksApi.activity(teamId, taskId, page, latestOnly ? 1 : 20),
  });
  return (
    <>
      <ErrorMessage error={activity.error} />
      {activity.isPending && (
        <LoadingState label="Loading activity…" cards={1} />
      )}
      {activity.data?.total === 0 && <p className="muted">No activity yet.</p>}
      <ol className="activity-list">
        {(latestOnly
          ? activity.data?.items.slice(0, 1)
          : activity.data?.items
        )?.map((item) => (
          <li key={`${item.taskId}-${item.id}`}>
            <span className="activity-dot" />
            <div>
              <p>
                <strong>{item.actor.name}</strong>{' '}
                {labels[item.type] ?? 'updated the mission'}
                {!taskId && (
                  <>
                    {' '}
                    ·{' '}
                    {item.taskDeleted ? (
                      <span>{item.taskTitle}</span>
                    ) : (
                      <Link to={`/teams/${teamId}/tasks/${item.taskId}`}>
                        {item.taskTitle}
                      </Link>
                    )}
                  </>
                )}
              </p>
              {item.changes
                .filter((change) => change.field === 'status')
                .map((change) => (
                  <small key={change.field}>
                    {statusLabels[change.from as Status] ?? change.from} →{' '}
                    {statusLabels[change.to as Status] ?? change.to}
                  </small>
                ))}
              <time dateTime={item.createdAt}>
                {new Date(item.createdAt).toLocaleString()}
              </time>
            </div>
          </li>
        ))}
      </ol>
      {!latestOnly && activity.data && (
        <Pagination
          page={page}
          pages={activity.data.pages}
          onChange={setPage}
        />
      )}
    </>
  );
}
