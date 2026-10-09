import { z } from 'zod';
import { idSchema, paginationSchema } from '../teams/team.validation.js';
export const statuses = ['todo', 'in_progress', 'in_review', 'done'] as const;
export const priorities = ['low', 'medium', 'high', 'urgent'] as const;
export const calendarDate = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, 'Use YYYY-MM-DD')
  .refine((value) => {
    const date = new Date(`${value}T00:00:00.000Z`);
    return (
      Number.isFinite(date.getTime()) &&
      date.toISOString().slice(0, 10) === value
    );
  }, 'Enter a real calendar date');
const fields = {
  title: z.string().trim().min(1, 'Title is required').max(200),
  description: z.string().trim().max(10000),
  status: z.enum(statuses),
  priority: z.enum(priorities),
  assigneeId: idSchema.nullable(),
  startDate: calendarDate.nullable(),
  dueDate: calendarDate.nullable(),
};
const orderedDates = (value: {
  startDate?: string | null;
  dueDate?: string | null;
}) => !value.startDate || !value.dueDate || value.startDate <= value.dueDate;
export const createTaskSchema = z
  .object({
    ...fields,
    description: fields.description.default(''),
    status: fields.status.default('todo'),
    priority: fields.priority.default('medium'),
    assigneeId: fields.assigneeId.default(null),
    startDate: fields.startDate.default(null),
    dueDate: fields.dueDate.default(null),
  })
  .strict()
  .refine(orderedDates, {
    path: ['dueDate'],
    message: 'Due date must be on or after the start date',
  });
export const updateTaskSchema = z
  .object(fields)
  .partial()
  .extend({ version: z.number().int().nonnegative().optional() })
  .strict()
  .refine(
    (value) => Object.keys(value).some((key) => key !== 'version'),
    'Provide at least one mission field',
  )
  .refine(orderedDates, {
    path: ['dueDate'],
    message: 'Due date must be on or after the start date',
  });
export const statusSchema = z
  .object({
    status: fields.status,
    version: z.number().int().nonnegative().optional(),
  })
  .strict();
export const assigneeSchema = z
  .object({
    assigneeId: fields.assigneeId,
    version: z.number().int().nonnegative().optional(),
  })
  .strict();
export const listTaskSchema = paginationSchema
  .extend({
    approval: z.enum(['approved', 'pending', 'rejected']).default('approved'),
    q: z.string().trim().max(100).optional(),
    status: fields.status.optional(),
    priority: fields.priority.optional(),
    assignee: z.union([idSchema, z.literal('unassigned')]).optional(),
    due: z.enum(['overdue', 'upcoming', 'undated']).optional(),
    dueBefore: calendarDate.optional(),
    dueAfter: calendarDate.optional(),
    today: calendarDate.optional(),
    sort: z.enum(['newest', 'oldest', 'due', 'priority']).default('newest'),
  })
  .strict()
  .refine(
    (value) =>
      !value.dueAfter || !value.dueBefore || value.dueAfter <= value.dueBefore,
    {
      path: ['dueBefore'],
      message: 'End of range must be on or after its start',
    },
  );
export const deleteTaskSchema = z
  .object({ version: z.coerce.number().int().nonnegative().optional() })
  .strict();
export const reviewProposalSchema = z
  .object({
    decision: z.enum(['approved', 'rejected']),
    version: z.number().int().nonnegative(),
    reason: z.string().trim().max(500).default(''),
  })
  .strict();
