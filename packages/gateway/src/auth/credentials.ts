/**
 * Credentials on incoming requests: `Authorization: Bearer <token>`, or HTTP Basic with the
 * token as the password (what git sends for `https://x:<token>@host/...`; the user name is
 * ignored, as Artifacts does), or `?key=<token>` for the browser's live page and feed.
 */

/** The bearer or Basic-password token of a request, if any. */
export function presentedToken(request: Request): string | null {
  const header = request.headers.get('authorization');
  if (header === null) return null;
  const [scheme, value] = header.split(/\s+/, 2);
  if (value === undefined || value === '') return null;
  if (scheme?.toLowerCase() === 'bearer') return value;
  if (scheme?.toLowerCase() === 'basic') return basicPassword(value);
  return null;
}

function basicPassword(encoded: string): string | null {
  try {
    const decoded = atob(encoded);
    const separator = decoded.indexOf(':');
    const password = separator >= 0 ? decoded.slice(separator + 1) : '';
    return password === '' ? null : password;
  } catch {
    // Not base64: no usable credentials, the caller answers 401.
    return null;
  }
}

/** The `key` query parameter (view tokens in links). */
export function queryToken(request: Request): string | null {
  return new URL(request.url).searchParams.get('key');
}

/** Constant-time comparison of a presented secret with the expected one. */
export async function isSameSecret(presented: string, expected: string): Promise<boolean> {
  if (expected === '') return false;
  const encoder = new TextEncoder();
  const [left, right] = await Promise.all([
    crypto.subtle.digest('SHA-256', encoder.encode(presented)),
    crypto.subtle.digest('SHA-256', encoder.encode(expected)),
  ]);
  return crypto.subtle.timingSafeEqual(left, right);
}
