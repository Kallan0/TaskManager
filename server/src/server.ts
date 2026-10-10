import { startMetrics } from './middleware/metrics.js';
import { startDraining } from './middleware/readiness.js';
import { cleanupAssignments } from './modules/teams/cleanup.service.js';
import mongoose from 'mongoose';
import { app } from './app.js';
import { env } from './config/env.js';
import { connectDatabase } from './config/database.js';

try {
  await connectDatabase();
  const server = app.listen(env.PORT, () =>
    console.log(`API listening on http://localhost:${env.PORT}`),
  );
  const stopMetrics = startMetrics();
  server.requestTimeout = 15000;
  server.headersTimeout = 10000;
  let cleanupRunning = false;
  const timer = setInterval(() => {
    if (cleanupRunning) return;
    cleanupRunning = true;
    void cleanupAssignments()
      .catch(() => console.error('assignment_cleanup_failed'))
      .finally(() => {
        cleanupRunning = false;
      });
  }, 30000).unref();
  const stop = () => {
    startDraining();
    clearInterval(timer);
    stopMetrics();
    server.closeIdleConnections();
    server.close(() => {
      void mongoose.disconnect().then(() => process.exit(0));
    });
    setTimeout(() => process.exit(1), 30000).unref();
  };
  process.on('SIGINT', stop);
  process.on('SIGTERM', stop);
} catch (error) {
  const message = error instanceof Error ? error.message : '';
  const category = /migration/i.test(message)
    ? 'DATABASE_MIGRATION_REQUIRED'
    : /replica|mongos|transaction/i.test(message)
      ? 'DATABASE_REPLICA_SET_REQUIRED'
      : /auth|credential/i.test(message)
        ? 'DATABASE_AUTHENTICATION_FAILED'
        : /ECONN|ENOTFOUND|timeout|server selection|connect/i.test(message)
          ? 'DATABASE_CONNECTION_FAILED'
          : 'STARTUP_CHECK_FAILED';
  console.error(
    'API startup failed. Check environment configuration and MongoDB connectivity.',
    {
      category,
      errorType: error instanceof Error ? error.name : 'UnknownError',
    },
  );
  process.exit(1);
}
