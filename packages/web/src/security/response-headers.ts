/**
 * Headers every web response carries, set once in the Worker's entry (worker/index.ts) for the
 * app and for site pages served at the same origin: never framed (clickjacking), no MIME
 * sniffing, a referrer that stays on the origin for cross-site links, and HSTS on https only
 * (a local `wrangler dev` is plain http). A page that sets its own Referrer-Policy (the account
 * pages, `same-origin`) keeps it. Uploaded pictures under /media/ are content-addressed and
 * cached immutably, so the router's Vary (its RSC headers) is dropped there: it only fragments
 * the cache.
 */

const STRICT_TRANSPORT_SECURITY = 'max-age=31536000; includeSubDomains';
const FRAME_ANCESTORS = "frame-ancestors 'none'";
const MEDIA_PREFIX = '/media/';

/** `response` with the security headers (and, for /media/, without Vary); a WebSocket passes. */
export function withResponseHeaders(response: Response, request: Request): Response {
  if (response.status === 101) return response;
  const url = new URL(request.url);
  const served = new Response(response.body, response);
  const { headers } = served;
  headers.set('x-frame-options', 'DENY');
  if (!(headers.get('content-security-policy') ?? '').includes('frame-ancestors'))
    headers.append('content-security-policy', FRAME_ANCESTORS);
  headers.set('x-content-type-options', 'nosniff');
  if (!headers.has('referrer-policy'))
    headers.set('referrer-policy', 'strict-origin-when-cross-origin');
  if (url.protocol === 'https:')
    headers.set('strict-transport-security', STRICT_TRANSPORT_SECURITY);
  if (url.pathname.startsWith(MEDIA_PREFIX)) headers.delete('vary');
  return served;
}
