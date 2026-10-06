import { UpstreamError } from '../errors';
import type { GitPath } from './git-path';

/** A clone or push of the arena repo takes seconds; this bounds a stuck upstream. */
const UPSTREAM_TIMEOUT_MS = 10 * 60 * 1000;

/** Request headers git needs upstream; the client's own Authorization is never forwarded. */
const FORWARDED_REQUEST_HEADERS = [
  'accept',
  'content-type',
  'content-encoding',
  'content-length',
  'git-protocol',
  'user-agent',
] as const;

/** Response headers that must not reach the client (credential challenges, hop-by-hop). */
const DROPPED_RESPONSE_HEADERS = new Set([
  'www-authenticate',
  'set-cookie',
  'connection',
  'keep-alive',
  'transfer-encoding',
]);

/**
 * Forwards one smart-HTTP request to the Artifacts remote with the gateway's token, and
 * streams the response back. Bodies are never read here.
 */
export async function forwardGit(
  request: Request,
  target: {
    upstream: string;
    path: GitPath;
    token: string;
    body: ReadableStream<Uint8Array> | null;
  },
): Promise<Response> {
  const query = target.path.rest === 'info/refs' ? `?service=${target.path.service}` : '';
  const headers = new Headers();
  for (const name of FORWARDED_REQUEST_HEADERS) {
    const value = request.headers.get(name);
    if (value !== null) headers.set(name, value);
  }
  headers.set('authorization', `Bearer ${target.token}`);
  const upstream = await fetch(`${target.upstream}/${target.path.rest}${query}`, {
    method: request.method,
    headers,
    body: target.body,
    redirect: 'manual',
    signal: AbortSignal.timeout(UPSTREAM_TIMEOUT_MS),
  });
  if (upstream.status >= 300 && upstream.status < 400) {
    // Never hand the client a redirect: its `location` would send git (with its credentials)
    // to a host the gateway did not choose.
    await upstream.body?.cancel();
    throw new UpstreamError(`the git remote answered ${upstream.status}, a redirect`, false);
  }
  const responseHeaders = new Headers();
  upstream.headers.forEach((value, name) => {
    if (!DROPPED_RESPONSE_HEADERS.has(name.toLowerCase())) responseHeaders.set(name, value);
  });
  return new Response(upstream.body, {
    status: upstream.status,
    statusText: upstream.statusText,
    headers: responseHeaders,
  });
}
