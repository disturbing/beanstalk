/**
 * Web sessions: an opaque 32-byte id in the `__Host-bs_session` cookie, its SHA-256 in D1,
 * 30 days sliding. Revocation is a row update; "sign out everywhere" revokes every row.
 */
import { SESSION_COOKIE, readCookie } from './cookies';
import type { Clock, IdentityEnv } from './identity-env';
import { systemClock } from './identity-env';
import { hashSecret, isSameSecret, randomSecret } from './secrets';
import type { SessionUser } from './users';

export const SESSION_SECONDS = 30 * 24 * 3600;
/** A session's expiry slides forward at most once a day (one write per day per session). */
const SLIDE_AFTER_MS = 24 * 3600 * 1000;
const MAX_COOKIE_LENGTH = 128;

export type WebSession = {
  readonly user: SessionUser;
  /** The session's at-rest id, for revoking this one session. */
  readonly sessionHash: string;
  /** A CSRF token for this session's forms (see `csrfTokenFor`). */
  readonly csrfToken: string;
};

export type NewSession = { readonly secret: string; readonly expiresAt: number };

/** Opens a session for a user; the caller sets `secret` as the session cookie. */
export async function createSession(
  env: IdentityEnv,
  input: { readonly userId: string; readonly userAgent: string | null },
  now: number,
): Promise<NewSession> {
  const secret = randomSecret();
  const expiresAt = now + SESSION_SECONDS * 1000;
  await (await sessionInsert(env, { ...input, secret, expiresAt }, now)).run();
  return { secret, expiresAt };
}

/** The insert alone, for callers that batch it with the user's creation. */
export async function sessionInsert(
  env: IdentityEnv,
  input: {
    readonly userId: string;
    readonly userAgent: string | null;
    readonly secret: string;
    readonly expiresAt: number;
  },
  now: number,
): Promise<D1PreparedStatement> {
  return env.IDENTITY_DB.prepare(
    'INSERT INTO web_sessions (id_hash, user_id, created_at, expires_at, last_seen_at, user_agent) VALUES (?, ?, ?, ?, ?, ?)',
  ).bind(
    await hashSecret(input.secret),
    input.userId,
    now,
    input.expiresAt,
    now,
    input.userAgent?.slice(0, 200) ?? null,
  );
}

/**
 * The signed-in person behind a request's session cookie, or null. The web app's
 * `requireUser` adapter is built on this; any Worker with the IDENTITY_DB binding can call it.
 */
export async function getSessionUser(
  request: Request,
  env: IdentityEnv,
  clock: Clock = systemClock,
): Promise<SessionUser | null> {
  const session = await getWebSession(request.headers.get('cookie'), env, clock);
  return session?.user ?? null;
}

/** The session behind a Cookie header, sliding its expiry; null when absent or invalid. */
export async function getWebSession(
  cookieHeader: string | null,
  env: IdentityEnv,
  clock: Clock = systemClock,
): Promise<WebSession | null> {
  const secret = readCookie(cookieHeader, SESSION_COOKIE);
  if (secret === null || secret.length > MAX_COOKIE_LENGTH) return null;
  const sessionHash = await hashSecret(secret);
  const now = clock();
  const row = await env.IDENTITY_DB.prepare(
    `SELECT s.expires_at, s.last_seen_at, u.id, u.handle, u.email
       FROM web_sessions s JOIN users u ON u.id = s.user_id
      WHERE s.id_hash = ? AND s.revoked_at IS NULL AND s.expires_at > ? AND u.disabled_at IS NULL`,
  )
    .bind(sessionHash, now)
    .first<{
      expires_at: number;
      last_seen_at: number;
      id: string;
      handle: string;
      email: string | null;
    }>();
  if (row === null) return null;
  if (now - row.last_seen_at > SLIDE_AFTER_MS) await slide(env, sessionHash, now);
  return {
    user: { id: row.id, handle: row.handle, email: row.email },
    sessionHash,
    csrfToken: await csrfTokenFor(secret),
  };
}

/**
 * The CSRF token for a session's forms: a hash of the session secret, which only this
 * browser's HttpOnly cookie holds, so another site can neither read nor forge it.
 */
export async function csrfTokenFor(sessionSecret: string): Promise<string> {
  return (await hashSecret(`csrf:${sessionSecret}`)).slice(0, 43);
}

/** Whether a submitted form's CSRF token belongs to the session (constant time). */
export async function isValidCsrf(session: WebSession, presented: unknown): Promise<boolean> {
  if (typeof presented !== 'string' || presented.length === 0) return false;
  return isSameSecret(presented, session.csrfToken);
}

export async function revokeSession(
  env: IdentityEnv,
  sessionHash: string,
  now: number,
): Promise<void> {
  await env.IDENTITY_DB.prepare(
    'UPDATE web_sessions SET revoked_at = ? WHERE id_hash = ? AND revoked_at IS NULL',
  )
    .bind(now, sessionHash)
    .run();
}

/** Signs a person out of every browser; returns how many sessions ended. */
export async function revokeAllSessions(
  env: IdentityEnv,
  userId: string,
  now: number,
): Promise<number> {
  const result = await env.IDENTITY_DB.prepare(
    'UPDATE web_sessions SET revoked_at = ? WHERE user_id = ? AND revoked_at IS NULL',
  )
    .bind(now, userId)
    .run();
  return result.meta.changes;
}

async function slide(env: IdentityEnv, sessionHash: string, now: number): Promise<void> {
  await env.IDENTITY_DB.prepare(
    'UPDATE web_sessions SET last_seen_at = ?, expires_at = ? WHERE id_hash = ?',
  )
    .bind(now, now + SESSION_SECONDS * 1000, sessionHash)
    .run();
}
