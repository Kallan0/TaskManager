import { AsyncLocalStorage } from 'node:async_hooks';
import { createHash } from 'node:crypto';
import type { RequestHandler } from 'express';
import { Schema, model } from 'mongoose';
import { ApiError } from './ApiError.js';
const schema = new Schema({
  _id: String,
  fingerprint: String,
  authorization: String,
  result: Schema.Types.Mixed,
  expiresAt: Date,
});
schema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 });
export const Idempotency = model('Idempotency', schema);
export const requestContext = new AsyncLocalStorage<{
  key: string;
  fingerprint: string;
  actor: () => string;
}>();
const digest = (s: string) => createHash('sha256').update(s).digest('hex');
export const idempotencyContext: RequestHandler = (req, res, next) => {
  // Invitations return their plaintext link only once; never persist that secret.
  const eligible =
    req.method === 'POST' &&
    /^\/api\/v1\/teams(?:$|\/[a-f\d]{24}\/tasks(?:$|\/proposals$|\/[a-f\d]{24}\/comments$))/.test(
      req.path,
    );
  const key = req.get('Idempotency-Key');
  if (!eligible || !key) {
    next();
    return;
  }
  if (!/^[a-zA-Z0-9_-]{16,100}$/.test(key)) {
    next(
      new ApiError(400, 'INVALID_IDEMPOTENCY_KEY', 'Use a valid request key'),
    );
    return;
  }
  requestContext.run(
    {
      key: digest(req.method + req.path + key),
      fingerprint: digest(JSON.stringify(req.body)),
      actor: () => res.locals.user?.id ?? '',
    },
    next,
  );
};
export async function idempotent<T>(
  work: () => Promise<T>,
  authorization = '',
): Promise<T> {
  const ctx = requestContext.getStore();
  if (!ctx) return work();
  const id = digest(ctx.actor() + ctx.key);
  const existing = await Idempotency.findById(id);
  if (existing && existing.expiresAt! > new Date()) {
    if ((existing.authorization ?? '') !== authorization)
      throw new ApiError(
        403,
        'FORBIDDEN',
        'Your crew permissions changed. Start a new request',
      );
    if (existing.fingerprint !== ctx.fingerprint)
      throw new ApiError(
        409,
        'IDEMPOTENCY_CONFLICT',
        'This request key was already used for different content',
      );
    return existing.result as T;
  }
  if (existing) await Idempotency.deleteOne({ _id: id });
  const result = await work();
  await Idempotency.create({
    _id: id,
    fingerprint: ctx.fingerprint,
    authorization,
    result,
    expiresAt: new Date(Date.now() + 86400000),
  });
  return result;
}
