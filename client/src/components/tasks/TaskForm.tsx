import { useState } from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { ApiError } from '../../api/client';
import {
  statuses,
  priorities,
  statusLabels,
  type Task,
  type TaskInput,
  type Status,
} from '../../api/tasks.api';
import type { Member } from '../../api/teams.api';
import { ErrorMessage } from '../common/Feedback';
const schema = z
  .object({
    title: z.string().trim().min(1, 'Title is required').max(200),
    description: z.string().trim().max(10000),
    status: z.enum(statuses),
    priority: z.enum(priorities),
    assigneeId: z.string(),
    startDate: z.string(),
    dueDate: z.string(),
  })
  .refine(
    (values) =>
      !values.startDate ||
      !values.dueDate ||
      values.startDate <= values.dueDate,
    {
      path: ['dueDate'],
      message: 'Due date must be on or after the start date',
    },
  );
type Values = z.infer<typeof schema>;
export function TaskForm({
  initial,
  initialStatus = 'todo',
  members,
  onSubmit,
  onReload,
  proposal = false,
}: {
  initial?: Task;
  initialStatus?: Status;
  members: Member[];
  onSubmit: (values: TaskInput) => Promise<unknown>;
  onReload?: () => Promise<unknown>;
  proposal?: boolean;
}) {
  const [error, setError] = useState<unknown>(null);
  const {
    register,
    handleSubmit,
    setError: fieldError,
    formState: { errors, isSubmitting },
  } = useForm<Values>({
    resolver: zodResolver(schema),
    defaultValues: {
      title: initial?.title ?? '',
      description: initial?.description ?? '',
      status: initial?.status ?? initialStatus,
      priority: initial?.priority ?? 'medium',
      assigneeId: initial?.assigneeId ?? '',
      startDate: initial?.startDate ?? '',
      dueDate: initial?.dueDate ?? '',
    },
  });
  const fields = Object.keys(schema.shape);
  return (
    <form
      className="task-form"
      noValidate
      onSubmit={handleSubmit(async (values) => {
        setError(null);
        try {
          await onSubmit({
            ...values,
            assigneeId: values.assigneeId || null,
            startDate: values.startDate || null,
            dueDate: values.dueDate || null,
          });
        } catch (caught) {
          setError(caught);
          if (caught instanceof ApiError)
            caught.error.details?.forEach((detail) => {
              if (fields.includes(detail.field))
                fieldError(detail.field as keyof Values, {
                  message: detail.message,
                });
            });
        }
      })}
    >
      <div className="field">
        <label htmlFor="task-title">Mission title</label>
        <input
          id="task-title"
          placeholder="What needs to be done?"
          maxLength={200}
          {...register('title')}
          aria-invalid={!!errors.title}
          aria-describedby={errors.title ? 'task-title-error' : undefined}
        />
        {errors.title && (
          <small id="task-title-error" className="field-error">
            {errors.title.message}
          </small>
        )}
      </div>
      <div className="field">
        <label htmlFor="task-description">Description</label>
        <textarea
          id="task-description"
          rows={5}
          maxLength={10000}
          placeholder="Add the details your team needs."
          {...register('description')}
          aria-invalid={!!errors.description}
        />
        {errors.description && (
          <small className="field-error">{errors.description.message}</small>
        )}
      </div>
      <div className="form-grid">
        <div className="field">
          <label htmlFor="task-status">Status</label>
          <select id="task-status" {...register('status')}>
            {(proposal ? (['todo'] as const) : statuses).map((status) => (
              <option key={status} value={status}>
                {statusLabels[status]}
              </option>
            ))}
          </select>
        </div>
        <div className="field">
          <label htmlFor="task-priority">Priority</label>
          <select id="task-priority" {...register('priority')}>
            {priorities.map((priority) => (
              <option key={priority} value={priority}>
                {priority[0].toUpperCase() + priority.slice(1)}
              </option>
            ))}
          </select>
        </div>
        <div className="field wide">
          <label htmlFor="task-assignee">Assignee</label>
          <select id="task-assignee" {...register('assigneeId')}>
            <option value="">Unassigned</option>
            {members.map((member) => (
              <option key={member.id} value={member.id}>
                {member.name}
              </option>
            ))}
          </select>
          {errors.assigneeId && (
            <small className="field-error">{errors.assigneeId.message}</small>
          )}
        </div>
        <div className="field">
          <label htmlFor="task-start">Start date</label>
          <input
            id="task-start"
            type="date"
            {...register('startDate')}
            aria-invalid={!!errors.startDate}
          />
          {errors.startDate && (
            <small className="field-error">{errors.startDate.message}</small>
          )}
        </div>
        <div className="field">
          <label htmlFor="task-due">Due date</label>
          <input
            id="task-due"
            type="date"
            {...register('dueDate')}
            aria-invalid={!!errors.dueDate}
            aria-describedby={errors.dueDate ? 'task-due-error' : undefined}
          />
          {errors.dueDate && (
            <small id="task-due-error" className="field-error">
              {errors.dueDate.message}
            </small>
          )}
        </div>
      </div>
      <ErrorMessage error={error} />
      {error instanceof ApiError && error.status === 409 && onReload && (
        <button
          type="button"
          className="secondary"
          onClick={() => void onReload()}
        >
          Reload latest mission
        </button>
      )}
      <button className="primary" disabled={isSubmitting}>
        {isSubmitting
          ? 'Saving…'
          : proposal
            ? 'Submit proposal'
            : initial
              ? 'Save mission'
              : 'Create mission'}
      </button>
    </form>
  );
}
