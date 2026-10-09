import { Worker } from 'node:worker_threads';
import { ApiError } from '../../utils/ApiError.js';
type Job = {
  operation: 'hash' | 'compare';
  password: string;
  hash?: string;
  resolve: (value: string | boolean) => void;
  reject: (error: Error) => void;
};
const queue: Job[] = [];
const workers: { worker: Worker; job?: Job; timer?: NodeJS.Timeout }[] = [];
const source = `const { parentPort } = require('node:worker_threads');
const bcrypt = require('bcryptjs');
parentPort.on('message', async ({ operation, password, hash }) => {
 try { parentPort.postMessage({ value: operation === 'hash' ? await bcrypt.hash(password, 12) : await bcrypt.compare(password, hash) }); }
 catch { parentPort.postMessage({ error: true }); }
});`;
function dispatch() {
  while (
    workers.length < 2 &&
    queue.length > workers.filter((w) => !w.job).length
  ) {
    const entry: (typeof workers)[number] = {
      worker: new Worker(source, { eval: true }),
    };
    workers.push(entry);
    const failed = () => {
      if (!workers.includes(entry)) return;
      clearTimeout(entry.timer);
      entry.job?.reject(
        new ApiError(
          503,
          'AUTH_BUSY',
          'Sign-in is temporarily busy. Please try again',
        ),
      );
      workers.splice(workers.indexOf(entry), 1);
      void entry.worker.terminate();
      dispatch();
    };
    entry.worker.on('error', failed);
    entry.worker.on(
      'message',
      (message: { value: string | boolean; error?: boolean }) => {
        if (!workers.includes(entry)) return;
        clearTimeout(entry.timer);
        if (message.error)
          entry.job?.reject(new Error('Password operation failed'));
        else entry.job?.resolve(message.value);
        entry.job = undefined;
        entry.worker.unref();
        dispatch();
      },
    );
    entry.worker.unref();
  }
  for (const entry of workers) {
    if (entry.job || !queue.length) continue;
    entry.job = queue.shift()!;
    entry.worker.ref();
    entry.timer = setTimeout(() => {
      if (!workers.includes(entry)) return;
      entry.job?.reject(
        new ApiError(503, 'AUTH_BUSY', 'Sign-in timed out. Please try again'),
      );
      entry.job = undefined;
      workers.splice(workers.indexOf(entry), 1);
      void entry.worker.terminate();
      dispatch();
    }, 10000);
    entry.worker.postMessage({
      operation: entry.job.operation,
      password: entry.job.password,
      hash: entry.job.hash,
    });
  }
}
function execute(operation: Job['operation'], password: string, hash?: string) {
  if (queue.length >= 16)
    return Promise.reject(
      new ApiError(
        503,
        'AUTH_BUSY',
        'Sign-in is temporarily busy. Please try again',
      ),
    );
  return new Promise<string | boolean>((resolve, reject) => {
    queue.push({ operation, password, hash, resolve, reject });
    dispatch();
  });
}
export const hashPassword = (password: string) =>
  execute('hash', password) as Promise<string>;
export const comparePassword = (password: string, hash: string) =>
  execute('compare', password, hash) as Promise<boolean>;
