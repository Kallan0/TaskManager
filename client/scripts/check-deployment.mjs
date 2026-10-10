import { readFile } from 'node:fs/promises';

export function validateBackendOrigin(value) {
  let url;
  try {
    url = new URL(value);
  } catch {
    throw new Error(
      'Set RENDER_API_URL to the backend HTTPS origin on Vercel.',
    );
  }
  if (
    url.protocol !== 'https:' ||
    url.origin !== value ||
    url.username ||
    url.password ||
    ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname)
  )
    throw new Error(
      'RENDER_API_URL must be an HTTPS origin without credentials, paths or a trailing slash.',
    );
}

if (process.env.VERCEL === '1') {
  const config = JSON.parse(
    await readFile(new URL('../vercel.json', import.meta.url), 'utf8'),
  );
  if (config.routes.some((route) => route.env?.includes('RENDER_API_URL')))
    validateBackendOrigin(process.env.RENDER_API_URL);
  else console.info('Frontend-only deployment: no backend URL required.');
}
