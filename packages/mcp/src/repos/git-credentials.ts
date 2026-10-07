/**
 * `git_credentials`: a session token (`bss_`) for one repository, at most an hour, no wider
 * than the session (read; push beans with `write`) and the person's access there, revoked
 * with the session's grant. Returned as `git credential approve` input so it goes to git's
 * own credential store and never into a URL, a remote or a file. The gateway's git proxy
 * opens only that repository with it; /mcp refuses it as a bearer.
 *
 * It is visible to the model that asked for it: the trade-off `16` §3.3 accepts until git is
 * connected through setup (SSH keys) on the machine. Logs never carry it.
 */
import type { ToolScope } from '../tools/tool-context';
import { ToolError } from '../mcp/tool-result';
import { RepositoryAnswer, parsed } from './agent-gateway';
import { cloneUrl, sessionOf } from './repo-answers';

const DEFAULT_MINUTES = 60;

export async function gitCredentials(
  scope: ToolScope,
  input: { readonly repo: string; readonly ttl_minutes?: number | undefined },
): Promise<object> {
  const { agents, principal } = sessionOf(scope);
  const { session } = scope;
  if (session === undefined) throw new ToolError('git_credentials needs a signed-in agent session');
  const repository = parsed(await agents.agentRepository(principal, input.repo), RepositoryAnswer);
  const minted = await session.mintGitToken({
    engineId: repository.engine_id,
    access: repository.access,
    ttlSeconds: (input.ttl_minutes ?? DEFAULT_MINUTES) * 60,
  });
  if (minted === null) throw new ToolError('this session has no git scope (read or write)');
  const url = new URL(cloneUrl(scope, repository.git_path));
  const credential = [
    'protocol=https',
    `host=${url.host}`,
    `path=${url.pathname.replace(/^\//, '')}`,
    'username=x',
    `password=${minted.token}`,
    '',
  ].join('\n');
  return {
    repo: repository.repo,
    clone_url: url.toString(),
    scopes: minted.scopes,
    expires_at: minted.expiresAt,
    credential,
    how: [
      `git config --global credential.https://${url.host}.useHttpPath true   # one token per repository`,
      `git config --global credential.https://${url.host}.helper 'cache --timeout=3600'   # only if no helper is set: memory, not disk`,
      'printf \'%s\\n\' "<credential>" | git credential approve   # the credential field, as is, on stdin',
    ],
    summary: `A ${minted.scopes.join('+')} credential for ${repository.repo} until ${minted.expiresAt}. Give it to git credential approve; never print it, write it to a file, put it in a URL or commit it.`,
  };
}
