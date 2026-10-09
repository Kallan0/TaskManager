export function getTrustedOrigins(clientUrl: string, environment: string) {
  const origins = new Set([clientUrl]);
  const url = new URL(clientUrl);
  if (
    environment !== 'production' &&
    ['localhost', '127.0.0.1'].includes(url.hostname)
  ) {
    url.hostname = url.hostname === 'localhost' ? '127.0.0.1' : 'localhost';
    origins.add(url.origin);
  }
  return origins;
}
