/**
 * The one place a git credential is checked (`verifyGitCredential`). Git presents it as HTTP
 * Basic (the token as the password, the user name ignored: `https://x:<token>@host/...` or a
 * credential helper) or as a Bearer header. Today it accepts the gateway's own run tokens:
 *
 * - `git` tokens: a person or an agent (`sub`) on one repository engine; read and push beans.
 * - `view` tokens: read (clone, fetch) one engine or run.
 * - `slot` and `seed` tokens: a race's driver and its admin seed, on the per-run URLs only.
 *
 * User tokens (accounts, OAuth for MCP, personal tokens for git) extend this function: they
 * verify to the same `GitCredential`, with `engine: null` and the scopes their grant names, and
 * `mayUseEngine` then asks the repository's access rules instead of comparing engine ids.
 */
import type { RunId } from '@beanstalk/shared-race/ids';

import { verifyToken } from './tokens';

/** What a credential may do with a repository. Landing is never one of them. */
export type GitScope = 'repo:read' | 'bean:write';

export type GitUser = { readonly id: string; readonly handle: string };

/** A race's run token, for the per-run proxy URLs (`/git/<namespace>/race-<run>.git`). */
export type RunPrincipal = { readonly scope: 'slot' | 'seed' | 'view'; readonly sub: string };

export type GitCredential = {
  readonly user: GitUser;
  readonly scopes: readonly GitScope[];
  /** The engine (or race run) the credential is bound to; null when it is not bound to one. */
  readonly engine: RunId | null;
  /** Set for race run tokens: the per-run proxy decides by it, as before. */
  readonly runPrincipal: RunPrincipal | null;
};

/** What verification needs from the gateway: the token signing secret and the clock. */
export type GitCredentialEnv = { readonly tokenSecret: string; readonly now: () => number };

/** The credential a token carries, or null when it is not a valid git credential. */
export async function verifyGitCredential(
  env: GitCredentialEnv,
  token: string,
): Promise<GitCredential | null> {
  const check = await verifyToken(env.tokenSecret, token, env.now());
  if (!check.ok) return null;
  const { scope, sub, run } = check.claims;
  switch (scope) {
    case 'git':
      return {
        user: tokenUser(sub),
        scopes: ['repo:read', 'bean:write'],
        engine: run,
        runPrincipal: null,
      };
    case 'view':
      return {
        user: tokenUser(sub),
        scopes: ['repo:read'],
        engine: run,
        runPrincipal: { scope, sub },
      };
    case 'slot':
      return {
        user: tokenUser(sub),
        scopes: ['repo:read', 'bean:write'],
        engine: run,
        runPrincipal: { scope, sub },
      };
    case 'seed':
      return {
        user: tokenUser(sub),
        scopes: ['repo:read'],
        engine: run,
        runPrincipal: { scope, sub },
      };
    case 'contributor':
      // A valid identity whose token authorizes the collaboration tools only: no git scope.
      return { user: tokenUser(sub), scopes: [], engine: run, runPrincipal: null };
    default:
      return null;
  }
}

/** Whether the credential may use the engine at all (its scopes then say how). */
export function mayUseEngine(credential: GitCredential, engine: RunId): boolean {
  return credential.engine === engine;
}

function tokenUser(sub: string): GitUser {
  return { id: `token:${sub}`, handle: sub };
}
