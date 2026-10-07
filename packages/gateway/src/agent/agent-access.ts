/**
 * Which repository an agent session may work on, by the rule git uses: the session's person
 * becomes a git credential (a person's token, bound to no engine) and `mayUseEngine` decides.
 * A repository the person may not use answers 404, as git's proxy does: its existence is not
 * told. Deploy tokens never reach here (MCP sessions are people, verified by the MCP Worker).
 */
import type {
  AgentPrincipal,
  AgentRepository,
  SessionScope,
} from '@beanstalk/shared-race/agent-repos';
import { RepoSlug } from '@beanstalk/shared-race/agent-repos';
import { RunId } from '@beanstalk/shared-race/ids';
import type { RepositoryRecord } from '@beanstalk/shared-race/repos';
import type { RpcError, RpcResult } from '@beanstalk/shared-race/rpc';

import type { GitCredential, GitScope, RepositoryAccess } from '../auth/git-credential';
import { mayUseEngine } from '../auth/git-credential';
import type { Deps } from '../deps';
import type { RunDO } from '../run/run-do';

/** A repository the session may use, with its engine. */
export type Opened = {
  readonly repository: AgentRepository;
  readonly engineId: RunId;
  readonly engine: DurableObjectStub<RunDO>;
};

/** What a call needs: reading, or work that changes something (with the scope it takes). */
export type Need =
  | { readonly kind: 'read' }
  | { readonly kind: 'act'; readonly scopes: readonly SessionScope[]; readonly what: string };

/** Opens `owner/name` for the principal, or says why not (400, 403, 404). */
export async function openRepository(
  deps: Deps,
  input: { readonly principal: AgentPrincipal; readonly repo: string; readonly need: Need },
): Promise<RpcResult<Opened>> {
  const { principal, need } = input;
  if (!principal.scopes.includes('read'))
    return failure('forbidden', 403, 'this session has no read scope');
  if (need.kind === 'act' && !need.scopes.some((scope) => principal.scopes.includes(scope)))
    return failure('insufficient_scope', 403, scopeMessage(need));
  const slug = RepoSlug.safeParse(input.repo);
  if (!slug.success) return failure('invalid_request', 400, 'name the repository as owner/name');
  const [owner = '', name = ''] = slug.data.split('/');
  const record = await deps.registry.byName(owner, name);
  const engineId = RunId.safeParse(record?.engine_id);
  const missing = failure('not_found', 404, `no repository ${slug.data} you can use`);
  if (record === null || !engineId.success) return missing;
  const credential = credentialOf(principal);
  const target = {
    engine: engineId.data,
    ownerHandle: record.owner.handle,
    visibility: record.visibility,
  };
  if (!mayUseEngine(credential, target, 'read')) return missing;
  if (need.kind === 'act' && !isContributor(principal, target))
    return failure('forbidden', 403, `you may read ${slug.data} but not work on it`);
  const engine = deps.run(engineId.data);
  if ((await engine.repoEngine()) === null) return missing;
  return {
    ok: true,
    value: {
      repository: describe(record, accessOf(principal, target)),
      engineId: engineId.data,
      engine,
    },
  };
}

/** The repositories the person owns, as the session may use them. */
export async function ownRepositories(
  deps: Deps,
  principal: AgentPrincipal,
): Promise<RpcResult<readonly AgentRepository[]>> {
  if (!principal.scopes.includes('read'))
    return failure('forbidden', 403, 'this session has no read scope');
  const records = await deps.registry.byOwner(principal.user.id);
  return {
    ok: true,
    value: records.flatMap((record) => {
      const engine = RunId.safeParse(record.engine_id);
      if (!engine.success) return [];
      const target = {
        engine: engine.data,
        ownerHandle: record.owner.handle,
        visibility: record.visibility,
      };
      return [describe(record, accessOf(principal, target))];
    }),
  };
}

export function failure(
  code: string,
  status: number,
  message: string,
): { ok: false; error: RpcError } {
  return { ok: false, error: { code, status, message } };
}

/** `write` when both the person may push beans here and the session holds `write`. */
function accessOf(principal: AgentPrincipal, target: RepositoryAccess): 'write' | 'read' {
  return principal.scopes.includes('write') && isContributor(principal, target) ? 'write' : 'read';
}

/**
 * Whether the person (whatever this session's scopes) may push beans here: only they open
 * beans and claim tasks, so a reader of a public repository cannot take its tasks.
 */
function isContributor(principal: AgentPrincipal, target: RepositoryAccess): boolean {
  const writer = { ...credentialOf(principal), scopes: ['repo:read', 'bean:write'] as const };
  return mayUseEngine(writer, target, 'write');
}

/** The session as git would see it: a person's token with the session's git reach. */
function credentialOf(principal: AgentPrincipal): GitCredential {
  const scopes: GitScope[] = ['repo:read'];
  if (principal.scopes.includes('write')) scopes.push('bean:write');
  return {
    user: { id: principal.user.id, handle: principal.user.handle },
    scopes,
    engine: null,
    runPrincipal: null,
  };
}

function describe(record: RepositoryRecord, access: 'write' | 'read'): AgentRepository {
  const repo = `${record.owner.handle}/${record.name}`;
  return {
    repo,
    description: record.description,
    visibility: record.visibility,
    access,
    engine_id: record.engine_id,
    git_path: `/git/${repo}.git`,
  };
}

function scopeMessage(need: Extract<Need, { kind: 'act' }>): string {
  const scopes = need.scopes.join(' or ');
  return `${need.what} needs the ${scopes} scope; reconnect the agent and tick ${scopes} on the consent page`;
}
