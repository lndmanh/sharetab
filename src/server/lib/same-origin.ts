/** Access authenticates the browser; this rejects cross-site write attempts. */
export function isSameOriginWrite(request: Request): boolean {
  if (request.method === 'GET' || request.method === 'HEAD') return true;
  const site = request.headers.get('sec-fetch-site');
  if (site === 'cross-site') return false;
  const origin = request.headers.get('origin');
  if (!origin) return true; // non-browser local/automation clients have no Origin header
  try {
    return new URL(origin).origin === new URL(request.url).origin;
  } catch {
    return false;
  }
}
