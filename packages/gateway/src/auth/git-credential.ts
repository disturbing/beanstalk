/**
 * The one place a git credential is checked (`verifyGitCredential`). Git presents it as HTTP
 * Basic (the token as the password, the user name ignored: `https://x:<token>@host/...` or a
 * credential helper) or as a Bearer header. Two kinds of token, one shape of answer:
 *
 * - the gateway's run tokens (`bst1.…`, HMAC-signed by RUN_TOKEN_SECRET):
 *   - `git`: a person or an agent (`sub`) on one repository engine; read and push beans;
 *   - `view`: read (clone, fetch) one engine or run;
 *   - `slot` and `seed`: a race's driver and its admin seed, on the per-run URLs only;
 *   - `contributor`: the collaboration tools only, no git;
 * - people's tokens (`bsu_…` personal, `bss_…` minted for an MCP session), verified against the
 *   identity database by `verifyUserToken` (@beanstalk/shared-identity). They are bound to no
 *   engine (`engine: null`); `mayUseEngine` asks the repository's access rules instead.
 *
 * Callers decide what each credential may open; this only says who is asking and with which
 * scopes. Never throws for bad input; never logs the token.
 */
import type { IdentityEnv } from '@beanstalk/shared-identity/identity-env';
import type { Scope } from '@beanstalk/shared-identity/scopes';
import { verifyUserToken } from '@beanstalk/shared-identity/user-tokens';
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
  /** The engine (or race run) the credential is bound to; null for people's tokens. */
  readonly engine: RunId | null;
  /** Set for race run tokens: the per-run proxy decides by it, as before. */
  readonly runPrincipal: RunPrincipal | null;
};

/** What verification needs: the run-token secret, the clock and, for people's tokens, the identity DB. */
export type GitCredentialEnv = {
  readonly tokenSecret: string;
  readonly now: () => number;
  readonly identity?: IdentityEnv;
};

const USER_TOKEN = /^bs[us]_/;

/** The credential a token carries, or null when it is not a valid git credential. */
export async function verifyGitCredential(
  env: GitCredentialEnv,
  token: string,
): Promise<GitCredential | null> {
  if (USER_TOKEN.test(token)) return verifyPersonToken(env, token);
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

/**
 * Whether the credential may use the repository engine `engine` of `owner` at all (its scopes
 * then say how). Run tokens are bound to one engine. People's tokens open the repositories
 * their user owns; collaborators come with the repository registry.
 */
export function mayUseEngine(credential: GitCredential, engine: RunId, owner: string): boolean {
  if (credential.engine !== null) return credential.engine === engine;
  return credential.runPrincipal === null && credential.user.handle === owner;
}

async function verifyPersonToken(
  env: GitCredentialEnv,
  token: string,
): Promise<GitCredential | null> {
  if (env.identity === undefined) return null;
  const verified = await verifyUserToken(env.identity, token, env.now);
  if (verified === null) return null;
  return {
    user: { id: verified.user.id, handle: verified.user.handle },
    scopes: gitScopes(verified.scopes),
    engine: null,
    runPrincipal: null,
  };
}

/** An account grant's git reach: `read` reads, `write` also pushes beans; `collaborate` has none. */
function gitScopes(scopes: readonly Scope[]): GitScope[] {
  const git: GitScope[] = [];
  if (scopes.includes('read') || scopes.includes('write')) git.push('repo:read');
  if (scopes.includes('write')) git.push('bean:write');
  return git;
}

function tokenUser(sub: string): GitUser {
  return { id: `token:${sub}`, handle: sub };
}
