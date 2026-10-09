import { useState, type DragEvent } from 'react';
import { Link } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import {
  tasksApi,
  statuses,
  statusLabels,
  dateLabel,
  localToday,
  type Filters,
  type Status,
  type Task,
} from '../../api/tasks.api';
import { ErrorMessage, Pagination, LoadingState } from '../common/Feedback';
export function StatusSelect({
  task,
  disabled,
  onMove,
}: {
  task: Task;
  disabled: boolean;
  onMove: (task: Task, status: Status) => void;
}) {
  if (!task.canChangeStatus)
    return (
      <span className={`task-status status-display ${task.status}`}>
        {statusLabels[task.status]}
      </span>
    );
  return (
    <select
      className={`task-status ${task.status}`}
      aria-label={`Status for ${task.title}`}
      value={task.status}
      disabled={disabled}
      onChange={(event) => onMove(task, event.target.value as Status)}
    >
      {statuses.map((status) => (
        <option key={status} value={status}>
          {statusLabels[status]}
        </option>
      ))}
    </select>
  );
}
function Column({
  teamId,
  status,
  filters,
  busy,
  onMove,
  role,
}: {
  teamId: string;
  status: Status;
  filters: Filters;
  busy: boolean;
  onMove: (task: Pick<Task, 'id' | 'version'>, status: Status) => void;
  role: 'owner' | 'admin' | 'member';
}) {
  const [page, setPage] = useState(1);
  const [dragging, setDragging] = useState(false);
  const tasks = useQuery({
    queryKey: ['tasks', teamId, 'board', filters, status, page],
    queryFn: () => tasksApi.list(teamId, { ...filters, status }, page),
  });
  function drop(event: DragEvent) {
    event.preventDefault();
    setDragging(false);
    if (busy || role !== 'owner') return;
    try {
      const value = JSON.parse(
        event.dataTransfer.getData('application/x-planner-task'),
      );
      if (
        value.teamId === teamId &&
        typeof value.id === 'string' &&
        Number.isInteger(value.version)
      )
        onMove(value, status);
    } catch {
      /* Ignore external or malformed drag data. */
    }
  }
  return (
    <section
      className={`kanban-column ${status} ${dragging ? 'drag-over' : ''}`}
      aria-label={`${statusLabels[status]} column`}
      onDragOver={(event) => {
        if (
          !busy &&
          role === 'owner' &&
          event.dataTransfer.types.includes('application/x-planner-task')
        ) {
          event.preventDefault();
          setDragging(true);
        }
      }}
      onDragLeave={(event) => {
        if (!event.currentTarget.contains(event.relatedTarget as Node | null))
          setDragging(false);
      }}
      onDrop={drop}
    >
      <header>
        <h2>
          <span />
          {statusLabels[status]}
        </h2>
        <span>{tasks.data?.total ?? 0}</span>
      </header>
      <ErrorMessage error={tasks.error} />
      {tasks.isPending && <LoadingState label="Loading missions…" cards={2} />}
      {tasks.data?.total === 0 && (
        <p className="column-empty">No matching missions.</p>
      )}
      <div className="kanban-cards">
        {tasks.data?.items.map((task) => (
          <article
            className="kanban-card"
            key={task.id}
            draggable={!busy && task.canChangeStatus}
            onDragStart={(event) => {
              event.dataTransfer.setData(
                'application/x-planner-task',
                JSON.stringify({ id: task.id, teamId, version: task.version }),
              );
              event.dataTransfer.effectAllowed = 'move';
            }}
          >
            <span className={`priority-badge ${task.priority}`}>
              {task.priority}
            </span>
            <Link
              className="task-card-title"
              to={`/teams/${teamId}/tasks/${task.id}`}
            >
              {task.title}
            </Link>
            {task.description && <p>{task.description}</p>}
            <div className="task-card-meta">
              <span>{task.assignee?.name ?? 'Unassigned'}</span>
              {task.dueDate && (
                <span
                  className={
                    task.dueDate < localToday() && task.status !== 'done'
                      ? 'overdue-date'
                      : ''
                  }
                >
                  {dateLabel(task.dueDate)}
                </span>
              )}
            </div>
            <StatusSelect task={task} disabled={busy} onMove={onMove} />
            <Link
              className="secondary"
              aria-label={`Open mission & comments for ${task.title}`}
              to={`/teams/${teamId}/tasks/${task.id}`}
            >
              Open mission & comments
            </Link>
          </article>
        ))}
      </div>
      {tasks.data && (
        <Pagination page={page} pages={tasks.data.pages} onChange={setPage} />
      )}
      {role !== 'member' && (
        <Link
          className="add-column-task"
          to={`/teams/${teamId}/tasks/new?status=${status}`}
        >
          {role === 'owner' ? '+ Add mission' : '+ Propose mission'}
        </Link>
      )}
    </section>
  );
}
export function TaskBoard({
  teamId,
  filters,
  busy,
  onMove,
  role,
}: {
  teamId: string;
  filters: Filters;
  busy: boolean;
  onMove: (task: Pick<Task, 'id' | 'version'>, status: Status) => void;
  role: 'owner' | 'admin' | 'member';
}) {
  const visible = filters.status ? [filters.status] : statuses;
  return (
    <div className="kanban-board">
      {visible.map((status) => (
        <Column
          key={`${status}-${JSON.stringify(filters)}`}
          teamId={teamId}
          status={status}
          filters={filters}
          busy={busy}
          onMove={onMove}
          role={role}
        />
      ))}
    </div>
  );
}
