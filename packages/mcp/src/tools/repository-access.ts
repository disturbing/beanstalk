/**
 * Repository access for a person's agent session: every MCP tool that reads or writes a
 * repository asks here first, and here asks the gateway (`agentRepositoryAccess`), whose
 * answer is `mayUseEngine`'s: the person's role, capped by the session's scopes. A repository
 * the person may not see is missing, exactly like one that does not exist.
 */
import type {
  AgentPrincipal,
  CollaboratorsRpc,
  RepositoryAction,
  RepositoryForViewer,
} from '@beanstalk/shared-race/collaborators';

import type { AgentSessionContext } from './tool-context';

export type RepositoryAnswer =
  | { readonly ok: true; readonly repository: RepositoryForViewer }
  | { readonly ok: false; readonly status: number; readonly message: string };

/** `owner/name`, as people write it (a trailing `.git` is allowed). */
const FULL_NAME = /^([A-Za-z0-9][A-Za-z0-9-]{0,38})\/([A-Za-z0-9][A-Za-z0-9._-]{0,62}?)(?:\.git)?$/;

/** May this session do `action` with `owner/name`? */
export async function repositoryAccess(
  input: {
    readonly gateway: object;
    readonly session: AgentSessionContext;
  },
  fullName: string,
  action: RepositoryAction,
): Promise<RepositoryAnswer> {
  const match = FULL_NAME.exec(fullName.trim());
  if (match === null) return { ok: false, status: 400, message: 'name a repository as owner/name' };
  const rpc = collaboratorsOf(input.gateway);
  if (rpc === null)
    return { ok: false, status: 503, message: 'the gateway does not answer repository access yet' };
  const [, owner = '', name = ''] = match;
  const agent: AgentPrincipal = {
    user: { id: input.session.userId, handle: input.session.handle },
    scopes: input.session.scopes,
    label: input.session.clientName,
  };
  const result = await rpc.agentRepositoryAccess(agent, owner, name, action);
  if (result.ok) return { ok: true, repository: result.value };
  return { ok: false, status: result.error.status, message: result.error.message };
}

type AccessRpc = Pick<CollaboratorsRpc, 'agentRepositoryAccess'>;

/** The binding when it carries the method (an older gateway does not). */
function collaboratorsOf(binding: object): AccessRpc | null {
  return isAccessRpc(binding) ? binding : null;
}

function isAccessRpc(binding: object): binding is AccessRpc {
  return typeof Reflect.get(binding, 'agentRepositoryAccess') === 'function';
}
