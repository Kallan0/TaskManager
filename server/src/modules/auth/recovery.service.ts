import { createHash, randomBytes } from 'node:crypto';
import { z } from 'zod';
import { User, publicUser } from './user.model.js';
import { registerSchema } from './auth.validation.js';
import { hashPassword } from './passwords.js';
import { ApiError } from '../../utils/ApiError.js';
export const recoveryHash = (value: string) =>
  createHash('sha256').update(value).digest('hex');
export const newRecoveryCode = () => randomBytes(32).toString('hex');
export async function recoverAccount(input: unknown) {
  const data = z
    .object({
      email: registerSchema.shape.email,
      password: registerSchema.shape.password,
      recoveryCode: z.string().regex(/^[a-f\d]{64}$/),
    })
    .strict()
    .parse(input);
  const passwordHash = await hashPassword(data.password);
  const recoveryCode = newRecoveryCode();
  const user = await User.findOneAndUpdate(
    { email: data.email, recoveryHash: recoveryHash(data.recoveryCode) },
    {
      $set: { passwordHash, recoveryHash: recoveryHash(recoveryCode) },
      $inc: { tokenVersion: 1 },
    },
    { new: true },
  );
  if (!user)
    throw new ApiError(
      400,
      'RECOVERY_FAILED',
      'The recovery details are invalid',
    );
  return { user: publicUser(user), recoveryCode };
}
