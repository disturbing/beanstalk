/**
 * Run tokens: short-lived, HMAC-SHA256-signed bearer tokens the gateway issues and checks
 * itself. `bst1.<base64url(claims)>.<base64url(signature)>`.
 *
 * - `slot` tokens let one driver slot poll, report and use the git proxy for its own work.
 * - `seed` tokens let the admin push the arena base to a run repo's sprout and stalk
 *   before the run starts.
 * - `view` tokens let a browser read a run's live page and event feed.
 * - `git` tokens let a person or an agent clone a repository engine and push beans to it
 *   (`sub` is who, `run` the engine); see `git-credential.ts`.
 */
import { z } from 'zod';

import { RunId, TaskId } from '@gitstalk/shared-race/ids';

import { base64UrlDecode, base64UrlEncode } from './base64url';

const PREFIX = 'bst1';

export const TokenScope = z.enum(['slot', 'seed', 'view', 'contributor', 'git']);
export type TokenScope = z.infer<typeof TokenScope>;

const Claims = z
  .strictObject({
    run: RunId,
    /** The slot id for `slot` tokens, the user's handle for `git` tokens, `admin` otherwise. */
    sub: z.string().min(1).max(32),
    scope: TokenScope,
    /** The stable bean this contributor may revise; independent of a driver slot. */
    bean: TaskId.optional(),
    /** Expiry, unix seconds. */
    exp: z.number().int().positive(),
  })
  .refine(
    (claims) => (claims.scope === 'contributor') === (claims.bean !== undefined),
    'only contributor tokens name an owning bean',
  );
export type TokenClaims = z.infer<typeof Claims>;

export type IssuedToken = { readonly token: string; readonly expiresAt: string };

export type TokenFailure = 'malformed' | 'bad_signature' | 'expired';

export type TokenCheck =
  | { readonly ok: true; readonly claims: TokenClaims }
  | { readonly ok: false; readonly failure: TokenFailure };

/** Issues a token for `claims` (with `exp` from the TTL) signed with `secret`. */
export async function issueToken(
  secret: string,
  claims: Omit<TokenClaims, 'exp'>,
  options: { ttlSeconds: number; nowMs: number },
): Promise<IssuedToken> {
  const exp = Math.floor(options.nowMs / 1000) + options.ttlSeconds;
  const checked = Claims.parse({ ...claims, exp });
  const payload = base64UrlEncode(new TextEncoder().encode(JSON.stringify(checked)));
  const signature = await crypto.subtle.sign('HMAC', await hmacKey(secret), signedBytes(payload));
  return {
    token: `${PREFIX}.${payload}.${base64UrlEncode(new Uint8Array(signature))}`,
    expiresAt: new Date(exp * 1000).toISOString(),
  };
}

/** Checks a token's signature (constant time), shape and expiry. Never throws. */
export async function verifyToken(
  secret: string,
  token: string,
  nowMs: number,
): Promise<TokenCheck> {
  const parts = token.split('.');
  const [prefix, payload, signature] = parts;
  if (parts.length !== 3 || prefix !== PREFIX || payload === undefined || signature === undefined) {
    return { ok: false, failure: 'malformed' };
  }
  const signatureBytes = base64UrlDecode(signature);
  const payloadBytes = base64UrlDecode(payload);
  if (signatureBytes === null || payloadBytes === null) return { ok: false, failure: 'malformed' };
  const isValid = await crypto.subtle.verify(
    'HMAC',
    await hmacKey(secret),
    signatureBytes,
    signedBytes(payload),
  );
  if (!isValid) return { ok: false, failure: 'bad_signature' };
  const claims = parseClaims(payloadBytes);
  if (claims === null) return { ok: false, failure: 'malformed' };
  if (claims.exp * 1000 <= nowMs) return { ok: false, failure: 'expired' };
  return { ok: true, claims };
}

function parseClaims(bytes: Uint8Array): TokenClaims | null {
  try {
    const parsed = Claims.safeParse(JSON.parse(new TextDecoder().decode(bytes)));
    return parsed.success ? parsed.data : null;
  } catch {
    // Not JSON: the token is malformed, which the caller reports as such.
    return null;
  }
}

function signedBytes(payload: string): Uint8Array {
  return new TextEncoder().encode(`${PREFIX}.${payload}`);
}

async function hmacKey(secret: string): Promise<CryptoKey> {
  return crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign', 'verify'],
  );
}
