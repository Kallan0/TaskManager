import { createHash } from 'node:crypto';
import { Schema, model } from 'mongoose';
import {
  rateLimit,
  ipKeyGenerator,
  type Store,
  type Options,
} from 'express-rate-limit';
import { env } from '../config/env.js';

const schema = new Schema({ _id: String, hits: Number, resetTime: Date });
schema.index({ resetTime: 1 }, { expireAfterSeconds: 0 });
export const LimitBucket = model('LimitBucket', schema);
export class MongoLimitStore implements Store {
  windowMs = 60000;
  localKeys = false;
  constructor(readonly prefix: string) {}
  init(options: Options) {
    this.windowMs = options.windowMs;
  }
  private id(key: string) {
    const window = Math.floor(Date.now() / this.windowMs);
    return `${this.prefix}:${window}:${createHash('sha256').update(key).digest('hex')}`;
  }
  async increment(key: string) {
    const resetTime = new Date(
      (Math.floor(Date.now() / this.windowMs) + 1) * this.windowMs,
    );
    const result = await LimitBucket.findOneAndUpdate(
      { _id: this.id(key) },
      {
        $inc: { hits: 1 },
        $setOnInsert: { resetTime },
      },
      { upsert: true, new: true },
    ).maxTimeMS(2000);
    return { totalHits: result!.hits!, resetTime: result!.resetTime! };
  }
  async decrement(key: string) {
    await LimitBucket.updateOne(
      { _id: this.id(key), hits: { $gt: 0 } },
      { $inc: { hits: -1 } },
    ).maxTimeMS(2000);
  }
  async resetKey(key: string) {
    await LimitBucket.deleteOne({ _id: this.id(key) });
  }
}
export const ipKey = (ip?: string) => ipKeyGenerator(ip ?? 'unknown');
export function sharedLimit(prefix: string, options: Partial<Options>) {
  return rateLimit({
    windowMs: 15 * 60000,
    limit: 600,
    standardHeaders: 'draft-8',
    legacyHeaders: false,
    message: {
      success: false,
      error: {
        code: 'RATE_LIMITED',
        message: 'Too many requests. Please try again later',
      },
    },
    ...(env.NODE_ENV === 'test' ? {} : { store: new MongoLimitStore(prefix) }),
    ...options,
  });
}
