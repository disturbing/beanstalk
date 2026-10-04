/**
 * The demo gate for decisions: a password (the DEMO_PASSWORD secret) exchanged for a signed
 * session cookie. The signature is an HMAC keyed by the password itself, so changing the
 * secret signs everyone out. Comparisons are constant-time.
 */
export const SESSION_COOKIE = 'bs_session';
/** A signed-in demo session lasts twelve hours. */
export const SESSION_SECONDS = 12 * 3600;

const encoder = new TextEncoder();

/** Whether `attempt` is the demo password (false when no password is configured). */
export async function isDemoPassword(attempt: string, password: string): Promise<boolean> {
  if (password === '') return false;
  return timingSafeTextEqual(attempt, password);
}

/** A cookie value that proves a sign-in until `expiresAt` (epoch seconds). */
export async function sessionToken(password: string, expiresAt: number): Promise<string> {
  return `${expiresAt}.${await signature(password, expiresAt)}`;
}

/** Whether a cookie value is a valid, unexpired session for this password. */
export async function isValidSession(
  token: string | undefined,
  password: string,
  nowSeconds: number,
): Promise<boolean> {
  if (token === undefined || password === '') return false;
  const [expiry, provided] = token.split('.');
  const expiresAt = Number(expiry);
  if (!Number.isInteger(expiresAt) || expiresAt <= nowSeconds || provided === undefined)
    return false;
  return timingSafeTextEqual(provided, await signature(password, expiresAt));
}

async function signature(password: string, expiresAt: number): Promise<string> {
  const key = await crypto.subtle.importKey(
    'raw',
    encoder.encode(password),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  );
  const mac = await crypto.subtle.sign(
    'HMAC',
    key,
    encoder.encode(`beanstalk-session:${expiresAt}`),
  );
  return base64url(new Uint8Array(mac));
}

/**
 * Hash both sides to 32 bytes first so the comparison leaks no length, then compare every
 * byte without an early exit. (The app's types are the DOM's, whose SubtleCrypto lacks the
 * Workers-only `timingSafeEqual`; over two fixed-size digests this loop is equivalent.)
 */
async function timingSafeTextEqual(a: string, b: string): Promise<boolean> {
  const [left, right] = await Promise.all([
    crypto.subtle.digest('SHA-256', encoder.encode(a)),
    crypto.subtle.digest('SHA-256', encoder.encode(b)),
  ]);
  const x = new Uint8Array(left);
  const y = new Uint8Array(right);
  let difference = x.length ^ y.length;
  for (let index = 0; index < x.length; index += 1) difference |= (x[index] ?? 0) ^ (y[index] ?? 0);
  return difference === 0;
}

function base64url(bytes: Uint8Array): string {
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}
