import mongoose from 'mongoose';
import { app } from './app.js';
import { env } from './config/env.js';
import { connectDatabase } from './config/database.js';

try {
  await connectDatabase();
  const server = app.listen(env.PORT, () =>
    console.log(`API listening on http://localhost:${env.PORT}`),
  );
  const stop = () => {
    server.close(() => {
      void mongoose.disconnect().then(() => process.exit(0));
    });
    setTimeout(() => process.exit(1), 10000).unref();
  };
  process.on('SIGINT', stop);
  process.on('SIGTERM', stop);
} catch {
  console.error(
    'API startup failed. Check environment configuration and MongoDB connectivity.',
  );
  process.exit(1);
}
