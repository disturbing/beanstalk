/**
 * Git credentials: the password git sends (Basic) or a bearer token. Two kinds, one check:
 * - run tokens (`bst1.…`, HMAC-signed by RUN_TOKEN_SECRET): driver slots and seeds of a race;
 * - people's tokens (`bsu_…` personal, `bss_…` minted for an MCP session), verified against
 *   the identity database by `verifyUserToken` (@beanstalk/shared-identity).
 * Callers decide what each kind may open; this only says who is asking.
 */
import type { Scope } from '@beanstalk/shared-identity/scopes';
import type { TokenKind } from '@beanstalk/shared-identity/user-tokens';
import { verifyUserToken } from '@beanstalk/shared-identity/user-tokens';
import type { SessionUser } from '@beanstalk/shared-identity/users';

import { readSecrets } from '../config';
import type { TokenClaims, TokenFailure } from './tokens';
import { verifyToken } from './tokens';

export type GitCredential =
  | { readonly ok: true; readonly kind: 'run'; readonly claims: TokenClaims }
  | {
      readonly ok: true;
      readonly kind: 'user';
      readonly user: SessionUser;
      readonly scopes: readonly Scope[];
      readonly tokenKind: TokenKind;
    }
  | { readonly ok: false; readonly reason: TokenFailure | 'unknown_user_token' };

const USER_TOKEN = /^bs[us]_/;

/** Who a git credential belongs to. Never throws for bad input; never logs the token. */
export async function verifyGitCredential(
  env: Env,
  token: string,
  nowMs: number = Date.now(),
): Promise<GitCredential> {
  if (USER_TOKEN.test(token)) {
    const verified = await verifyUserToken(env, token, () => nowMs);
    if (verified === null) return { ok: false, reason: 'unknown_user_token' };
    return {
      ok: true,
      kind: 'user',
      user: verified.user,
      scopes: verified.scopes,
      tokenKind: verified.token.kind,
    };
  }
  const check = await verifyToken(readSecrets(env).tokenSecret, token, nowMs);
  if (!check.ok) return { ok: false, reason: check.failure };
  return { ok: true, kind: 'run', claims: check.claims };
}

/** The 401 text for a refused credential. */
export function credentialFailure(reason: GitCredential & { readonly ok: false }): string {
  return reason.reason === 'unknown_user_token'
    ? 'user token unknown, expired or revoked'
    : `run token ${reason.reason.replace('_', ' ')}`;
}
