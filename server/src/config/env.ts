import 'dotenv/config';
import { z } from 'zod';

const schema = z.object({
  NODE_ENV: z
    .enum(['development', 'test', 'production'])
    .default('development'),
  PORT: z.coerce.number().int().min(1).max(65535).default(5000),
  TRUST_PROXY_HOPS: z.coerce.number().int().min(0).max(5).default(0),
  DB_POOL_SIZE: z.coerce.number().int().min(2).max(100).default(20),
  PROXY_TRUST_CONFIRMED: z.enum(['true', 'false']).default('false'),
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

if (
  env.NODE_ENV === 'production' &&
  env.TRUST_PROXY_HOPS > 0 &&
  env.PROXY_TRUST_CONFIRMED !== 'true'
)
  throw new Error(
    'Confirm the trusted proxy chain before enabling forwarded-IP trust',
  );
