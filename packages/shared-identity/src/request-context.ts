/**
 * What the identity endpoints read from a request: the caller's IP (for limits and audit
 * hashes), the user agent, and whether a state-changing request came from this site.
 */

export function clientIp(request: Request): string | null {
  return request.headers.get('cf-connecting-ip');
}

export function userAgent(request: Request): string | null {
  return request.headers.get('user-agent');
}

/**
 * CSRF defence for state-changing requests: browsers send `Origin` on every cross-site POST,
 * so a foreign origin is refused. When the origin is withheld (`null` under some referrer
 * policies) the browser's `Sec-Fetch-Site` must say `same-origin`; with neither, refuse.
 * Signed-in forms also carry a session-bound token (`csrfTokenFor`); JSON endpoints also
 * require `application/json`, which a cross-site form cannot send without a CORS preflight.
 */
export function isSameOrigin(request: Request): boolean {
  const origin = request.headers.get('origin');
  if (origin !== null && origin !== 'null') return origin === new URL(request.url).origin;
  return request.headers.get('sec-fetch-site') === 'same-origin';
}

/** The relying party (passkeys) and link origin for a request to this site. */
export function siteOrigin(request: Request): { readonly id: string; readonly origin: string } {
  const url = new URL(request.url);
  return { id: url.hostname, origin: url.origin };
}
