/**
 * The one place a git credential is checked (`verifyGitCredential`) and the one place
 * repository access is decided (`mayUseEngine`). Git presents a credential as HTTP Basic (the
 * token as the password, the user name ignored: `https://x:<token>@host/...` or a credential
 * helper) or as a Bearer header. Three kinds of token, one shape of answer:
 *
 * - the gateway's run tokens (`bst1.…`, HMAC-signed by RUN_TOKEN_SECRET):
 *   - `git`: a person or an agent (`sub`) on one repository engine; read and push beans;
 *   - `view`: read (clone, fetch) one engine or run;
 *   - `slot` and `seed`: a race's driver and its admin seed, on the per-run URLs only;
 *   - `contributor`: the collaboration tools only, no git;
 * - people's tokens (`bsu_…` personal, `bss_…` minted for an MCP session), verified against the
 *   identity database by `verifyUserToken` (@beanstalk/shared-identity). They are bound to no
 *   engine (`engine: null`); `mayUseEngine` asks the person's role on the repository instead. A
 *   session token minted by the MCP tool `git_credentials` is bound to its one repository;
 * - deploy tokens (`bsd_…`), made by a repository's owner or maintainers for CI and other
 *   machines: bound to that repository's engine, read or read and write, pushing as the person
 *   who made them (../repos/deploy-tokens.ts), independent of collaborators.
 *
 * `verifyGitCredential` only says who is asking and with which scopes; `mayUseEngine` says
 * what they may do. Never throws for bad input; never logs the token.
 */
import type { IdentityEnv } from '@beanstalk/shared-identity/identity-env';
import type { Scope } from '@beanstalk/shared-identity/scopes';
import { verifyUserToken } from '@beanstalk/shared-identity/user-tokens';
import type {
  RepoRole,
  RepositoryAction,
  SessionVia,
  ViewerRole,
} from '@beanstalk/shared-race/collaborators';
import { RunId } from '@beanstalk/shared-race/ids';

import { JOB_TOKEN_PREFIX, verifyJobToken } from '../actions/job-tokens';
import { assertNever } from '../engine/errors';
import { DEPLOY_TOKEN_PREFIX, verifyDeployToken } from '../repos/deploy-tokens';
import { verifyToken } from './tokens';

/** What a credential may do with a repository. Landing is never one of them. */
export type GitScope = 'repo:read' | 'bean:write';

export type GitUser = { readonly id: string; readonly handle: string };

/** A race's run token, for the per-run proxy URLs (`/git/<namespace>/race-<run>.git`). */
export type RunPrincipal = { readonly scope: 'slot' | 'seed' | 'view'; readonly sub: string };

/** A person's credential as the repository's sessions list names it (`<via>:<id>`). */
export type CredentialSession = { readonly via: SessionVia; readonly id: string };

export type GitCredential = {
  readonly user: GitUser;
  readonly scopes: readonly GitScope[];
  /** The engine (or race run) the credential is bound to; null for people's tokens. */
  readonly engine: RunId | null;
  /** Set for race run tokens: the per-run proxy decides by it, as before. */
  readonly runPrincipal: RunPrincipal | null;
  /** Which credential this is, for the repository's sessions list; null for run tokens. */
  readonly session: CredentialSession | null;
};

/** What verification needs: the run-token secret, the clock and, for people's tokens, the identity DB. */
export type GitCredentialEnv = {
  readonly tokenSecret: string;
  readonly now: () => number;
  readonly identity?: IdentityEnv;
  /** The registry database, for deploy tokens. */
  readonly forge?: D1Database;
  /** Where the request comes from ("US · git/2.53.0"), kept as a deploy token's last use. */
  readonly usedFrom?: string | null;
};

/** The repository a request names, as access rules see it. */
export type RepositoryAccess = {
  readonly engine: RunId;
  /** The owner (the registry's; for an engine opened without one, the URL's handle and no id). */
  readonly owner: { readonly id: string | null; readonly handle: string };
  readonly visibility: 'public' | 'private';
  /** The asking person's collaborator role as the registry records it; null when none. */
  readonly collaboratorRole: RepoRole | null;
  /** Archived by its owner: read-only for everyone until it is unarchived. */
  readonly archived: boolean;
};

/** Who is asking: nobody signed in, a person on the web, or a credential (token, key, session). */
export type RepositoryPrincipal =
  | { readonly kind: 'anonymous' }
  | { readonly kind: 'person'; readonly user: GitUser }
  | { readonly kind: 'credential'; readonly credential: GitCredential };

/**
 * The answer to "may they?": allowed; forbidden (they can see the repository, but their role
 * or credential does not reach this action); or not-found (they may not learn it exists).
 */
export type AccessVerdict = 'allowed' | 'forbidden' | 'not-found';

/** The least role each action needs; the owner's is above all of them. */
const LEAST_ROLE: Readonly<Record<RepositoryAction, ViewerRole>> = {
  read: 'read',
  write: 'write',
  decide: 'maintain',
  'deploy-tokens': 'maintain',
  actions: 'maintain',
  administer: 'owner',
};
const RANK: Readonly<Record<ViewerRole, number>> = { read: 1, write: 2, maintain: 3, owner: 4 };
/** What an archived repository refuses everyone: it is read-only (its owner still administers). */
const ARCHIVE_REFUSES: ReadonlySet<RepositoryAction> = new Set([
  'write',
  'decide',
  'deploy-tokens',
  'actions',
]);

const USER_TOKEN = /^bs[us]_/;

/** The credential a token carries, or null when it is not a valid git credential. */
export async function verifyGitCredential(
  env: GitCredentialEnv,
  token: string,
): Promise<GitCredential | null> {
  if (USER_TOKEN.test(token)) return verifyPersonToken(env, token);
  if (token.startsWith(DEPLOY_TOKEN_PREFIX)) return verifyDeploy(env, token);
  if (token.startsWith(JOB_TOKEN_PREFIX)) return verifyJob(env, token);
  const check = await verifyToken(env.tokenSecret, token, env.now());
  if (!check.ok) return null;
  const { scope, sub, run } = check.claims;
  const bound = { user: tokenUser(sub), engine: run, session: null };
  switch (scope) {
    case 'git':
      return { ...bound, scopes: ['repo:read', 'bean:write'], runPrincipal: null };
    case 'view':
      return { ...bound, scopes: ['repo:read'], runPrincipal: { scope, sub } };
    case 'slot':
      return { ...bound, scopes: ['repo:read', 'bean:write'], runPrincipal: { scope, sub } };
    case 'seed':
      return { ...bound, scopes: ['repo:read'], runPrincipal: { scope, sub } };
    case 'contributor':
      // A valid identity whose token authorizes the collaboration tools only: no git scope.
      return { ...bound, scopes: [], runPrincipal: null };
    default:
      return null;
  }
}

/**
 * Whether a principal may do `action` with a repository: the one place repository access is
 * decided, for HTTPS and SSH git, MCP and the web alike.
 *
 * - A credential bound to an engine (a run's `git` token, a deploy token) reads and pushes
 *   that engine only, as far as its scopes go, and never decides or administers; any other
 *   repository is not found. Race run principals never reach repositories.
 * - Everyone else is their role: the owner, a collaborator's `read` / `write` / `maintain`, or
 *   none. With no role a private repository is not found and a public one only reads.
 * - A token, key or agent session is its person's role capped by its scopes (`repo:read`,
 *   `bean:write`); deciding, deploy tokens and settings are people's, on the web, only.
 * - An archived repository is read-only: whoever could push, decide or manage deploy tokens
 *   is refused (`refusedByArchive` says so); its owner still administers it (to unarchive).
 */
export function mayUseEngine(
  principal: RepositoryPrincipal,
  repository: RepositoryAccess,
  action: RepositoryAction,
): AccessVerdict {
  return refusedByArchive(principal, repository, action)
    ? 'forbidden'
    : roleVerdict(principal, repository, action);
}

/**
 * Whether `action` is refused only because the repository is archived: the principal's role
 * and credential would allow it otherwise. Refusals say so, and how to undo it.
 */
export function refusedByArchive(
  principal: RepositoryPrincipal,
  repository: RepositoryAccess,
  action: RepositoryAction,
): boolean {
  return (
    repository.archived &&
    ARCHIVE_REFUSES.has(action) &&
    roleVerdict(principal, repository, action) === 'allowed'
  );
}

function roleVerdict(
  principal: RepositoryPrincipal,
  repository: RepositoryAccess,
  action: RepositoryAction,
): AccessVerdict {
  if (principal.kind === 'credential') {
    const { credential } = principal;
    if (credential.engine !== null)
      return credential.engine === repository.engine
        ? withinScopes(credential, action)
        : 'not-found';
    if (credential.runPrincipal !== null) return 'not-found';
  }
  const role = roleOf(principal, repository);
  if (role === null) {
    if (repository.visibility === 'private') return 'not-found';
    if (action !== 'read') return 'forbidden';
  } else if (RANK[role] < RANK[LEAST_ROLE[action]]) {
    return 'forbidden';
  }
  return principal.kind === 'credential' ? withinScopes(principal.credential, action) : 'allowed';
}

/** What the principal is on the repository: its owner, a collaborator role, or nothing. */
export function roleOf(
  principal: RepositoryPrincipal,
  repository: RepositoryAccess,
): ViewerRole | null {
  const user = personOf(principal);
  if (user === null) return null;
  const { owner } = repository;
  const isOwner =
    owner.id === null
      ? user.handle.toLowerCase() === owner.handle.toLowerCase()
      : user.id === owner.id;
  return isOwner ? 'owner' : repository.collaboratorRole;
}

/** The person whose role the registry is asked for; null for nobody and for bound tokens. */
export function personOf(principal: RepositoryPrincipal): GitUser | null {
  switch (principal.kind) {
    case 'anonymous':
      return null;
    case 'person':
      return principal.user;
    case 'credential': {
      const { credential } = principal;
      const isBound = credential.engine !== null || credential.runPrincipal !== null;
      return isBound ? null : credential.user;
    }
    default:
      return assertNever(principal);
  }
}

function withinScopes(credential: GitCredential, action: RepositoryAction): AccessVerdict {
  switch (action) {
    case 'read':
      return credential.scopes.includes('repo:read') ? 'allowed' : 'forbidden';
    case 'write':
      return credential.scopes.includes('bean:write') ? 'allowed' : 'forbidden';
    case 'decide':
    case 'deploy-tokens':
    case 'actions':
    case 'administer':
      return 'forbidden';
    default:
      return assertNever(action);
  }
}

async function verifyPersonToken(
  env: GitCredentialEnv,
  token: string,
): Promise<GitCredential | null> {
  if (env.identity === undefined) return null;
  const verified = await verifyUserToken(env.identity, token, env.now);
  if (verified === null) return null;
  // A session token minted for one repository (MCP `git_credentials`) opens that one only.
  const bound = verified.token.repository;
  const engine = bound === null ? null : RunId.safeParse(bound);
  if (engine !== null && !engine.success) return null;
  return {
    user: { id: verified.user.id, handle: verified.user.handle },
    scopes: gitScopes(verified.scopes),
    engine: engine === null ? null : engine.data,
    runPrincipal: null,
    session: {
      via: verified.token.kind === 'personal' ? 'personal-token' : 'agent-session',
      id: verified.token.id,
    },
  };
}

async function verifyDeploy(env: GitCredentialEnv, token: string): Promise<GitCredential | null> {
  if (env.forge === undefined) return null;
  const verified = await verifyDeployToken(env.forge, token, {
    now: env.now(),
    from: env.usedFrom ?? null,
  });
  const engine = RunId.safeParse(verified?.engineId);
  if (verified === null || !engine.success) return null;
  return {
    user: verified.createdBy,
    scopes: verified.access === 'write' ? ['repo:read', 'bean:write'] : ['repo:read'],
    engine: engine.data,
    runPrincipal: null,
    session: { via: 'deploy-token', id: verified.id },
  };
}

/**
 * An Actions job token (`bsj_`, the job's GITHUB_TOKEN): bound to its repository's engine,
 * read, and push (beans only) when the job's permissions allow `contents: write`.
 */
async function verifyJob(env: GitCredentialEnv, token: string): Promise<GitCredential | null> {
  if (env.forge === undefined) return null;
  const verified = await verifyJobToken(env.forge, token, env.now());
  const engine = RunId.safeParse(verified?.engineId);
  if (verified === null || !engine.success) return null;
  return {
    user: { id: `actions-job:${verified.jobId}`, handle: 'github-actions' },
    scopes: verified.canPush ? ['repo:read', 'bean:write'] : ['repo:read'],
    engine: engine.data,
    runPrincipal: null,
    session: null,
  };
}

/** An account grant's git reach: `read` reads, `write` also pushes beans; `collaborate` has none. */
export function gitScopes(scopes: readonly Scope[]): GitScope[] {
  const git: GitScope[] = [];
  if (scopes.includes('read') || scopes.includes('write')) git.push('repo:read');
  if (scopes.includes('write')) git.push('bean:write');
  return git;
}

function tokenUser(sub: string): GitUser {
  return { id: `token:${sub}`, handle: sub };
}
