import { MongoMemoryReplSet } from 'mongodb-memory-server';
import { spawn } from 'node:child_process';
import { createServer } from 'node:net';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { mkdir, writeFile } from 'node:fs/promises';
import mongoose from 'mongoose';

// Always creates its own disposable replica set. Never reads the user's DB URI.
const root = fileURLToPath(new URL('../', import.meta.url));
const sessions = Number(process.env.LOAD_SESSIONS ?? 20);
const rounds = Number(process.env.LOAD_ROUNDS ?? 10);
const seededMissions = Number(process.env.LOAD_MISSIONS ?? 100);
const seededComments = Number(process.env.LOAD_COMMENTS ?? 0);
if (
  !Number.isInteger(sessions) ||
  sessions < 2 ||
  sessions > 100 ||
  !Number.isInteger(rounds) ||
  rounds < 1 ||
  rounds > 100
)
  throw new Error('Use 2–100 sessions and 1–100 rounds');
if (
  !Number.isInteger(seededMissions) ||
  seededMissions < 100 ||
  seededMissions > 20000 ||
  !Number.isInteger(seededComments) ||
  seededComments < 0 ||
  seededComments > 5000
)
  throw new Error('Use 100–20,000 missions and 0–5,000 comments');
process.env.MONGOMS_DOWNLOAD_DIR = resolve(root, '.cache/mongodb');
const mongo = await MongoMemoryReplSet.create({ replSet: { count: 1 } });
let server;
const portProbe = createServer();
await new Promise((resolve) => portProbe.listen(0, '127.0.0.1', resolve));
const port = portProbe.address().port;
await new Promise((resolve) => portProbe.close(resolve));
const uri = mongo.getUri('planner_isolated_load');
const origin = 'https://load.example.test';
const env = {
  ...process.env,
  NODE_ENV: 'production',
  PORT: String(port),
  MONGODB_URI: uri,
  CLIENT_URL: origin,
  SESSION_SECRET: 'isolated-load-test-secret-never-used-in-production',
  TRUST_PROXY_HOPS: '0',
  PROXY_TRUST_CONFIRMED: 'false',
  DB_ADMIN_CONFIRM: 'planner_isolated_load',
};
function child(args) {
  const process = spawn(globalThis.process.execPath, args, {
    cwd: resolve(root, 'server'),
    env,
    windowsHide: true,
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  // Consume output without exposing identifiers, cookies, URI or invitation links.
  process.stdout.on('data', () => {});
  process.stderr.on('data', () => {});
  return process;
}
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
async function call(path, cookie, method = 'GET', body, key) {
  const started = performance.now();
  const response = await fetch(`http://127.0.0.1:${port}${path}`, {
    method,
    signal: AbortSignal.timeout(15000),
    headers: {
      Origin: origin,
      'Content-Type': 'application/json',
      ...(cookie ? { Cookie: cookie } : {}),
      ...(key ? { 'Idempotency-Key': key } : {}),
    },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
  const data = await response.json().catch(() => null);
  return {
    status: response.status,
    ms: performance.now() - started,
    data: data?.data,
    cookie: response.headers.get('set-cookie')?.split(';')[0],
  };
}
try {
  const migration = child(['dist/admin/database.js', 'migrate']);
  const migrated = await new Promise((resolve) =>
    migration.once('exit', resolve),
  );
  if (migrated !== 0) throw new Error('Isolated migration failed');
  server = child(['dist/server.js']);
  let ready = false;
  for (let i = 0; i < 60; i++) {
    try {
      if ((await call('/health')).status === 200) {
        ready = true;
        break;
      }
    } catch {
      /* Wait for own process only. */
    }
    await sleep(250);
  }
  if (!ready) throw new Error('Isolated API did not become ready');
  for (const path of ['/login', '/invitations/' + 'a'.repeat(64)]) {
    const html = await fetch(`http://127.0.0.1:${port}${path}`);
    if (
      html.status !== 200 ||
      !html.headers.get('content-type')?.includes('text/html')
    )
      throw new Error('Production SPA fallback failed');
  }
  for (const path of ['/api/v1/unknown', '/assets/missing.js']) {
    const missing = await call(path);
    if (missing.status !== 404)
      throw new Error('Production 404 handling failed');
  }
  const users = [];
  for (let i = 0; i < sessions; i++) {
    const result = await call('/api/v1/auth/register', null, 'POST', {
      name: `Load user ${i}`,
      email: `user${i}@load.example.test`,
      password: 'isolated-test-password-123',
    });
    if (result.status !== 201) throw new Error('Synthetic registration failed');
    users.push({ id: result.data.id, cookie: result.cookie });
  }
  const crew = await call(
    '/api/v1/teams',
    users[0].cookie,
    'POST',
    { name: 'Isolated load crew' },
    'load-team-creation-123',
  );
  if (crew.status !== 201) throw new Error('Synthetic crew creation failed');
  const team = crew.data.id;
  await mongoose.connect(uri);
  await mongoose.connection.db.collection('teammemberships').insertMany(
    users.slice(1).map((user) => ({
      team: new mongoose.Types.ObjectId(team),
      user: new mongoose.Types.ObjectId(user.id),
      role: 'member',
      joinedAt: new Date(),
    })),
  );
  let mission;
  for (let i = 0; i < 100; i++) {
    const result = await call(
      `/api/v1/teams/${team}/tasks`,
      users[0].cookie,
      'POST',
      {
        title: `Synthetic mission ${i}`,
        description: 'A staging-only workload',
      },
      `load-mission-creation-${i}`,
    );
    if (result.status !== 201)
      throw new Error('Synthetic mission creation failed');
    mission ??= result.data.id;
  }
  const db = mongoose.connection.db;
  const teamObject = new mongoose.Types.ObjectId(team);
  const actor = new mongoose.Types.ObjectId(users[0].id);
  // Seed large read datasets in bounded batches, after exercising real API
  // creation above. Direct inserts are only into the owned disposable DB.
  for (let start = 100; start < seededMissions; start += 1000) {
    const docs = [],
      events = [];
    for (let i = start; i < Math.min(start + 1000, seededMissions); i++) {
      const id = new mongoose.Types.ObjectId(),
        eventId = new mongoose.Types.ObjectId();
      const createdAt = new Date(Date.now() - i * 1000),
        title = `Synthetic mission ${i}`;
      const history = {
        _id: eventId,
        actor,
        type: 'TASK_CREATED',
        taskTitle: title,
        changes: [],
        createdAt,
      };
      docs.push({
        _id: id,
        team: teamObject,
        createdBy: actor,
        title,
        description: 'A synthetic read dataset',
        status: 'todo',
        priority: 'medium',
        priorityRank: 2,
        approvalStatus: 'approved',
        assignee: null,
        deletedAt: null,
        startDate: null,
        dueDate: null,
        completedAt: null,
        createdAt,
        updatedAt: createdAt,
        __v: 0,
        history: [history],
      });
      events.push({
        ...history,
        team: teamObject,
        task: id,
        visibleToMembers: true,
        purgeAt: new Date(createdAt.getTime() + 365 * 86400000),
      });
    }
    await db.collection('tasks').insertMany(docs);
    await db.collection('activities').insertMany(events);
  }
  for (let start = 0; start < seededComments; start += 1000) {
    const docs = [],
      events = [];
    for (let i = start; i < Math.min(start + 1000, seededComments); i++) {
      const id = new mongoose.Types.ObjectId(),
        eventId = new mongoose.Types.ObjectId();
      const createdAt = new Date(Date.now() - i * 1000),
        task = new mongoose.Types.ObjectId(mission);
      const history = {
        _id: eventId,
        actor,
        type: 'COMMENT_ADDED',
        taskTitle: 'Synthetic mission 0',
        changes: [],
        createdAt,
      };
      docs.push({
        _id: id,
        team: teamObject,
        task,
        author: actor,
        body: `Synthetic discussion ${i}`,
        deletedAt: null,
        editedAt: null,
        createdAt,
        updatedAt: createdAt,
        __v: 0,
        history: [history],
      });
      events.push({
        ...history,
        team: teamObject,
        task,
        visibleToMembers: true,
        purgeAt: new Date(createdAt.getTime() + 365 * 86400000),
      });
    }
    await db.collection('taskcomments').insertMany(docs);
    await db.collection('activities').insertMany(events);
  }
  const paths = [
    `/api/v1/teams/${team}/tasks`,
    `/api/v1/teams/${team}/tasks/summary`,
    `/api/v1/teams/${team}/activity?limit=20`,
    `/api/v1/teams/${team}/tasks/${mission}/comments`,
  ];
  const results = [];
  const started = performance.now();
  await Promise.all(
    users.map(async (user, index) => {
      for (let i = 0; i < rounds; i++)
        results.push(
          await call(paths[(index + i) % paths.length], user.cookie),
        );
    }),
  );
  const elapsedMs = performance.now() - started;
  const durations = results.map((r) => r.ms).sort((a, b) => a - b);
  const percentile = (p) =>
    Math.round(durations[Math.max(0, Math.ceil(durations.length * p) - 1)]);
  const statuses = results.reduce(
    (all, r) => ({ ...all, [r.status]: (all[r.status] ?? 0) + 1 }),
    {},
  );
  const report = {
    kind: 'local-isolated-smoke-not-production-capacity',
    sessions,
    rounds,
    seededMissions,
    seededComments,
    requests: results.length,
    requestsPerSecond: Math.round((results.length * 1000) / elapsedMs),
    p50Ms: percentile(0.5),
    p95Ms: percentile(0.95),
    p99Ms: percentile(0.99),
    statuses,
  };
  await mkdir(resolve(root, '.local/load'), { recursive: true });
  await writeFile(
    resolve(root, '.local/load/report.json'),
    JSON.stringify(report, null, 2),
  );
  console.info(JSON.stringify(report, null, 2));
  if (results.some((r) => r.status !== 200))
    throw new Error('Unexpected responses in isolated load smoke test');
} finally {
  await mongoose.disconnect();
  if (server && server.exitCode === null) {
    server.kill('SIGTERM');
    await Promise.race([
      new Promise((resolve) => server.once('exit', resolve)),
      sleep(5000),
    ]);
    if (server.exitCode === null) server.kill('SIGKILL');
  }
  await mongo.stop();
}
