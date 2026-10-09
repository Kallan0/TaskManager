import { spawn } from 'node:child_process';
import { mkdir } from 'node:fs/promises';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { setTimeout as delay } from 'node:timers/promises';
import mongoose from 'mongoose';
import { MongoBinary } from 'mongodb-memory-server-core/lib/util/MongoBinary.js';

const root = fileURLToPath(new URL('../', import.meta.url));
const dataPath = resolve(root, '.local/mongodb/data');
const logPath = resolve(root, '.local/mongodb/mongod.log');
const uri = 'mongodb://127.0.0.1:27017/team_task_planner';
const command = process.argv[2];

async function connect() {
  const connection = mongoose.createConnection(uri, {
    serverSelectionTimeoutMS: 1000,
    directConnection: true,
  });
  try {
    await connection.asPromise();
    return connection;
  } catch {
    await connection.close();
    return null;
  }
}
async function verifyManaged(connection) {
  const options = await connection.db.admin().command({ getCmdLineOpts: 1 });
  if (
    !options.parsed?.storage?.dbPath ||
    resolve(options.parsed.storage.dbPath) !== dataPath
  ) {
    throw new Error(
      'Port 27017 belongs to another MongoDB instance. This command only manages this project’s database.',
    );
  }
}
async function main() {
  if (!['start', 'stop', 'status'].includes(command))
    throw new Error('Usage: node scripts/local-db.mjs start|stop|status');
  const existing = await connect();
  if (existing) {
    try {
      if (command === 'stop') {
        await verifyManaged(existing);
        try {
          await existing.db.admin().command({ shutdown: 1 });
        } catch (error) {
          if (!error.name?.includes('MongoNetwork') && error.code !== 11600)
            throw error;
        }
      } else {
        const options = await existing.db
          .admin()
          .command({ getCmdLineOpts: 1 });
        const path = options.parsed?.storage?.dbPath;
        const managed = path && resolve(path) === dataPath;
        if (
          command === 'start' &&
          managed &&
          !options.parsed?.replication?.replSetName
        )
          throw new Error(
            'The managed DB is running standalone. Run db:stop then db:start to enable transactions; data is preserved.',
          );
        console.log(
          `MongoDB is running at ${uri}\nPersistent data: ${path ?? 'configured by existing installation'}\n${managed ? 'Managed by this project.' : 'Using existing installation; db:stop will not stop it.'}`,
        );
        return;
      }
    } finally {
      await existing.close();
    }
    for (let attempt = 0; attempt < 20; attempt++) {
      const connection = await connect();
      if (!connection) {
        console.log('Local MongoDB stopped. Data has been preserved.');
        return;
      }
      await connection.close();
      await delay(250);
    }
    throw new Error(
      'MongoDB did not stop in time. Check the local database log.',
    );
  }
  if (command !== 'start') {
    console.log('Local MongoDB is not running.');
    if (command === 'status') process.exitCode = 1;
    return;
  }
  await mkdir(dataPath, { recursive: true });
  const binary = await MongoBinary.getPath({
    version: '7.0.24',
    downloadDir: resolve(root, '.cache/mongodb'),
  });
  const child = spawn(
    binary,
    [
      '--replSet',
      'planner-rs',
      '--dbpath',
      dataPath,
      '--bind_ip',
      '127.0.0.1',
      '--port',
      '27017',
      '--logpath',
      logPath,
      '--logappend',
      '--wiredTigerCacheSizeGB',
      '0.25',
    ],
    { detached: true, windowsHide: true, stdio: 'ignore', cwd: root },
  );
  await new Promise((accept, reject) => {
    child.once('spawn', accept);
    child.once('error', reject);
  });
  child.unref();
  for (let attempt = 0; attempt < 20; attempt++) {
    const connection = await connect();
    if (connection) {
      try {
        await verifyManaged(connection);
        const hello = await connection.db.admin().command({ hello: 1 });
        if (!hello.setName) {
          await connection.db.admin().command({
            replSetInitiate: {
              _id: 'planner-rs',
              members: [{ _id: 0, host: '127.0.0.1:27017' }],
            },
          });
        }
        for (let wait = 0; wait < 40; wait++) {
          const state = await connection.db.admin().command({ hello: 1 });
          if (state.isWritablePrimary) break;
          if (wait === 39)
            throw new Error('Local replica set did not elect a primary');
          await delay(250);
        }
      } finally {
        await connection.close();
      }
      console.log(`MongoDB started at ${uri}\nPersistent data: ${dataPath}`);
      return;
    }
    await delay(250);
  }
  child.kill();
  throw new Error(`MongoDB failed to start. Inspect ${logPath}`);
}
main().catch((error) => {
  console.error(error.message);
  process.exitCode = 1;
});
