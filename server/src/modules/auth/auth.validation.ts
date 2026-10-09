import { z } from 'zod';

const email = z.string().trim().toLowerCase().max(254).pipe(z.email());
// bcrypt uses at most 72 bytes. Reject longer passwords rather than truncate them.
const password = z
  .string()
  .min(10, 'Use at least 10 characters')
  .refine(
    (value) => Buffer.byteLength(value, 'utf8') <= 72,
    'Password must be at most 72 UTF-8 bytes',
  );
export const registerSchema = z
  .object({ name: z.string().trim().min(2).max(80), email, password })
  .strict();
export const loginSchema = z
  .object({
    email,
    password: z
      .string()
      .min(1)
      .refine((value) => Buffer.byteLength(value, 'utf8') <= 72),
  })
  .strict();
