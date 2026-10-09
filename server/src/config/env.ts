import 'dotenv/config';
import { z } from 'zod';

const schema = z.object({
  NODE_ENV: z
    .enum(['development', 'test', 'production'])
    .default('development'),
  PORT: z.coerce.number().int().min(1).max(65535).default(5000),
  TRUST_PROXY_HOPS: z.coerce.number().int().min(0).max(5).default(0),
  MONGODB_URI: z.string().regex(/^mongodb(\+srv)?:\/\//),
  CLIENT_URL: z
    .url()
    .refine(
      (url) => new URL(url).origin === url,
      'Use an origin without a trailing slash',
    ),
  SESSION_SECRET: z
    .string()
    .min(32)
    .refine(
      (secret) => !secret.startsWith('replace-'),
      'Generate a real session secret',
    ),
});
export const env = schema.parse(process.env);
if (env.NODE_ENV === 'production' && !env.CLIENT_URL.startsWith('https://')) {
  throw new Error('Production CLIENT_URL must use HTTPS');
}
