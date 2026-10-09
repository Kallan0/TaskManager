import { z } from 'zod';
export const idSchema = z.string().regex(/^[a-f\d]{24}$/i, 'Invalid ID');
export const teamSchema = z
  .object({
    name: z.string().trim().min(2).max(80),
    description: z.string().trim().max(2000).default(''),
  })
  .strict();
export const teamUpdateSchema = z
  .object({
    name: z.string().trim().min(2).max(80).optional(),
    description: z.string().trim().max(2000).optional(),
  })
  .strict()
  .refine(
    (value) => Object.keys(value).length > 0,
    'Provide a name or description',
  );
export const inviteSchema = z
  .object({
    email: z.string().trim().toLowerCase().max(254).pipe(z.email()),
    role: z.enum(['admin', 'member']).default('member'),
  })
  .strict();
export const roleSchema = z
  .object({ role: z.enum(['admin', 'member']) })
  .strict();
export const paginationSchema = z.object({
  cursor: z.string().max(5000).optional(),
  page: z.coerce.number().int().min(1).max(250).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(20),
});
export const tokenSchema = z
  .string()
  .regex(/^[a-f\d]{64}$/, 'Invalid invitation link');
