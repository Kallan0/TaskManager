import { defineConfig } from 'vitest/config';
import { resolve } from 'node:path';
export default defineConfig({
  test: {
    fileParallelism: false,
    hookTimeout: 900000,
    testTimeout: 30000,
    env: {
      NODE_ENV: 'test',
      MONGODB_URI: 'mongodb://127.0.0.1:27017/planner_test',
      CLIENT_URL: 'http://localhost:5173',
      SESSION_SECRET: 'test-only-session-secret-with-32-characters',
      MONGOMS_DOWNLOAD_DIR: resolve('../.cache/mongodb'),
    },
  },
});
