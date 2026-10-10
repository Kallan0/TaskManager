import { cp, mkdtemp, readFile, rename } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { basename, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawn } from 'node:child_process';
import { createServer } from 'node:net';
import { MongoMemoryReplSet } from 'mongodb-memory-server';

const root = fileURLToPath(new URL('../', import.meta.url));
const directory = await mkdtemp(join(tmpdir(), 'planner-separate-deployment-'));
const npm = process.env.npm_execpath;
if (!npm) throw new Error('Run this check with npm run test:deployment.');
const baseEnv = {
  ...process.env,
  NODE_ENV: 'production',
  VITE_API_BASE_URL: '/api/v1',
  VERCEL: '1',
  RENDER_API_URL: 'https://backend.example.test',
  MONGOMS_DOWNLOAD_DIR: resolve(root, '.cache/mongodb'),
  MONGOMS_DISABLE_POSTINSTALL: '1',
};

function child(folder, args, env = baseEnv) {
  const process = spawn(globalThis.process.execPath, args, {
    cwd: join(directory, folder),
    env,
    windowsHide: true,
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  let output = '';
  for (const stream of [process.stdout, process.stderr])
    stream.on('data', (chunk) => {
      output = (output + chunk).slice(-6000);
    });
  return {
    process,
    output: () => output,
    done: new Promise((resolve, reject) => {
      process.once('error', reject);
      process.once('exit', (code) => resolve(code));
    }),
  };
}
async function run(folder, args, env) {
  const task = child(folder, args, env);
  if ((await task.done) !== 0)
    throw new Error(`${folder} command failed:\n${task.output()}`);
}

await Promise.all(
  ['client', 'server'].map(async (folder) => {
    await cp(join(root, folder), join(directory, folder), {
      recursive: true,
      filter: (path) =>
        !['node_modules', 'dist', 'coverage', '.vercel'].includes(
          basename(path),
        ) && !basename(path).startsWith('.env'),
    });
    await run(folder, [
      npm,
      'ci',
      '--include=dev',
      '--include=optional',
      '--workspaces=false',
      '--no-audit',
      '--no-fund',
    ]);
    await run(folder, [npm, 'run', 'build', '--workspaces=false']);
    console.info(
      `PASS ${folder}: clean standalone production install and build`,
    );
  }),
);

const config = JSON.parse(
  await readFile(join(directory, 'client/vercel.json'), 'utf8'),
);
const proxy = config.routes.find((route) =>
  route.dest?.includes('${RENDER_API_URL}'),
);
if (!proxy || !proxy.env.includes('RENDER_API_URL'))
  throw new Error('API proxy is not configured');
const apiPattern = new RegExp(`^${proxy.src}$`);
for (const path of ['/api/v1/auth/login', '/api/v1/teams', '/api/v1/unknown'])
  if (!apiPattern.test(path))
    throw new Error('API route could fall through to HTML');
const asset404 = config.routes.find(
  (route) => route.src === '/assets/.*' && route.status === 404,
);
if (!asset404 || config.routes.at(-1).dest !== '/index.html')
  throw new Error('Missing-asset or SPA routing is invalid');
console.info(
  'PASS Vercel: API proxy precedes static files and SPA fallback; missing assets remain 404',
);
await rename(join(directory, 'client'), join(directory, 'frontend'));

process.env.MONGOMS_DOWNLOAD_DIR = baseEnv.MONGOMS_DOWNLOAD_DIR;
const mongo = await MongoMemoryReplSet.create({ replSet: { count: 1 } });
let api;
const probe = createServer();
await new Promise((resolve) => probe.listen(0, '127.0.0.1', resolve));
const port = probe.address().port;
await new Promise((resolve) => probe.close(resolve));
const env = {
  ...baseEnv,
  VERCEL: '0',
  PORT: String(port),
  MONGODB_URI: mongo.getUri('separate_deployment_test'),
  CLIENT_URL: 'https://frontend.example.test',
  SESSION_SECRET: 'disposable-deployment-check-secret-never-production',
  DB_ADMIN_CONFIRM: 'separate_deployment_test',
  TRUST_PROXY_HOPS: '0',
  PROXY_TRUST_CONFIRMED: 'false',
};
const origin = `http://127.0.0.1:${port}`;
async function call(path, options = {}) {
  return fetch(origin + path, {
    ...options,
    signal: AbortSignal.timeout(12000),
  });
}
try {
  // The server fixture has no sibling client build; it must run as an API only.
  const denied = child('server', ['dist/server.js'], env);
  if (
    (await denied.done) === 0 ||
    !denied.output().includes('DATABASE_MIGRATION_REQUIRED')
  )
    throw new Error(
      'Missing production migration did not produce a clear error',
    );
  await run('server', ['dist/admin/database.js', 'migrate'], env);
  api = child('server', ['dist/server.js'], env);
  let ready = false;
  for (let attempt = 0; attempt < 60; attempt++) {
    try {
      if ((await call('/health')).status === 200) {
        ready = true;
        break;
      }
    } catch {
      /* Wait for owned API only. */
    }
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  if (!ready)
    throw new Error(`Standalone API did not become ready: ${api.output()}`);
  for (const path of ['/login', '/assets/missing.js', '/api/v1/unknown'])
    if ((await call(path)).status !== 404)
      throw new Error('API-only deployment returned unexpected HTML');
  const headers = {
    Origin: env.CLIENT_URL,
    'Content-Type': 'application/json',
  };
  const registered = await call('/api/v1/auth/register', {
    method: 'POST',
    headers,
    body: JSON.stringify({
      name: 'Deployment check',
      email: 'deployment@example.test',
      password: 'disposable-password-123',
    }),
  });
  if (registered.status !== 201)
    throw new Error('Standalone registration failed');
  const cookie = registered.headers.get('set-cookie');
  if (
    !cookie ||
    !/HttpOnly/i.test(cookie) ||
    !/Secure/i.test(cookie) ||
    !/SameSite=Lax/i.test(cookie) ||
    /(?:^|;)\s*Domain=/i.test(cookie)
  )
    throw new Error(
      'Production cookie attributes are incorrect for a same-origin proxy',
    );
  const sessionHeaders = { ...headers, Cookie: cookie.split(';')[0] };
  if (
    (await call('/api/v1/auth/me', { headers: sessionHeaders })).status !== 200
  )
    throw new Error('Cookie session lookup failed');
  const team = await call('/api/v1/teams', {
    method: 'POST',
    headers: sessionHeaders,
    body: '{"name":"Deployment crew"}',
  });
  if (team.status !== 201)
    throw new Error('Standalone transactional write failed');
  const rejected = await call('/api/v1/teams', {
    method: 'POST',
    headers: { ...sessionHeaders, Origin: 'https://untrusted.example.test' },
    body: '{"name":"Rejected"}',
  });
  if (rejected.status !== 403) throw new Error('Untrusted origin was accepted');
  if (
    (
      await call('/api/v1/auth/logout', {
        method: 'POST',
        headers: sessionHeaders,
      })
    ).status !== 204
  )
    throw new Error('Logout failed');
  if (
    (await call('/api/v1/auth/me', { headers: sessionHeaders })).status !== 401
  )
    throw new Error('Signed-out cookie was still accepted');
  console.info(
    'PASS Render: API-only startup, migration gate, readiness, password workers, cookies, transactions, trusted origin and logout',
  );
} finally {
  if (api && api.process.exitCode === null) {
    api.process.kill('SIGTERM');
    await Promise.race([
      api.done,
      new Promise((resolve) => setTimeout(resolve, 5000)),
    ]);
    if (api.process.exitCode === null) api.process.kill('SIGKILL');
  }
  await mongo.stop();
}
console.info(
  'Separate deployment checks passed using isolated folders and a disposable database.',
);
