import { readFile } from 'node:fs/promises';
import { createRequire } from 'node:module';

const problems = [];
for (const path of [
  '../package-lock.json',
  '../client/package-lock.json',
  '../server/package-lock.json',
]) {
  const lock = JSON.parse(
    await readFile(new URL(path, import.meta.url), 'utf8'),
  );
  for (const [parentPath, parent] of Object.entries(lock.packages)) {
    for (const [name, version] of Object.entries(
      parent.optionalDependencies ?? {},
    )) {
      if (!name.startsWith('@rollup/rollup-') && !name.startsWith('@esbuild/'))
        continue;
      const prefix = parentPath.slice(
        0,
        parentPath.lastIndexOf('node_modules/'),
      );
      const entry = lock.packages[`${prefix}node_modules/${name}`];
      if (!entry || entry.version !== version || !entry.integrity)
        problems.push(
          `${path} ${parentPath}: missing or inconsistent ${name}@${version}`,
        );
    }
  }
}
if (problems.length)
  throw new Error(
    `Incomplete native dependency lockfile:\n${problems.join('\n')}\nRepair the lockfile from a clean install before committing it.`,
  );
console.info('Rollup and esbuild platform lock entries are complete.');

if (process.argv.includes('--installed')) {
  const require = createRequire(import.meta.url);
  require('rollup');
  require('esbuild').transformSync('const check = 1;', { loader: 'js' });
  console.info(
    'Installed Rollup and esbuild native dependencies load correctly.',
  );
}
