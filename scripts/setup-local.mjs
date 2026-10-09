import { randomBytes } from 'node:crypto';
import { readFile, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';

const serverEnv = fileURLToPath(new URL('../server/.env', import.meta.url));
let contents;
try {
  contents = await readFile(serverEnv, 'utf8');
} catch (error) {
  if (error.code !== 'ENOENT') throw error;
  contents = await readFile(
    new URL('../server/.env.example', import.meta.url),
    'utf8',
  );
}
function setValue(key, value) {
  const pattern = new RegExp(`^${key}=.*$`, 'm');
  contents = pattern.test(contents)
    ? contents.replace(pattern, `${key}=${value}`)
    : `${contents.trimEnd()}\n${key}=${value}\n`;
}
setValue('MONGODB_URI', 'mongodb://127.0.0.1:27017/team_task_planner');
if (!/^SESSION_SECRET=(?!replace-).{32,}$/m.test(contents)) {
  setValue('SESSION_SECRET', randomBytes(48).toString('hex'));
}
await writeFile(serverEnv, contents, { mode: 0o600 });
try {
  await writeFile(
    new URL('../client/.env', import.meta.url),
    'VITE_API_BASE_URL=/api/v1\n',
    { flag: 'wx' },
  );
} catch (error) {
  if (error.code !== 'EEXIST') throw error;
}
console.log(
  'Local environment configured. Existing valid session secret preserved; secrets were not printed.',
);
