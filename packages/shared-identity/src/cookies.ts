/**
 * Cookie parsing and the Set-Cookie values the identity endpoints send. Every cookie is
 * `__Host-` (Secure, Path=/, no Domain: this origin only), HttpOnly, SameSite=Lax.
 */

export const SESSION_COOKIE = '__Host-bs_session';
/** Ceremony handles: a passkey options request, and the browser a magic link was asked from. */
export const CHALLENGE_COOKIE = '__Host-bs_challenge';
export const PREAUTH_COOKIE = '__Host-bs_preauth';

/** The value of one cookie in a request's Cookie header. */
export function readCookie(header: string | null | undefined, name: string): string | null {
  if (header === null || header === undefined) return null;
  for (const part of header.split(';')) {
    const separator = part.indexOf('=');
    if (separator < 0) continue;
    if (part.slice(0, separator).trim() !== name) continue;
    const value = part.slice(separator + 1).trim();
    return value === '' ? null : value;
  }
  return null;
}

/** A `Set-Cookie` value for a host-only, HttpOnly, Secure, Lax cookie. */
export function setCookie(name: string, value: string, maxAgeSeconds: number): string {
  return `${name}=${value}; Path=/; Max-Age=${maxAgeSeconds}; HttpOnly; Secure; SameSite=Lax`;
}

export function clearCookie(name: string): string {
  return setCookie(name, '', 0);
}
