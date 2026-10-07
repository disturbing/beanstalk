/**
 * The shared start of every `/<owner>/<repo>` page: who is looking, and the repository if
 * they may read it (a 404 otherwise, the same for private and missing). Server-only.
 */
import { env } from 'cloudflare:workers';
import { headers } from 'next/headers';
import { notFound } from 'next/navigation';

import { currentUser } from '../auth/user';
import type { User as SessionUser } from '../auth/user';
import { lookupRepository } from '../repositories/flows';
import type { StartConfig } from '../repositories/paths';
import { repositoryPath, sshEndpoint } from '../repositories/paths';
import type { RepositoryRecord } from '../repositories/registry-client';
import { registryClient } from '../repositories/registry-client';

export type RepositoryParams = Promise<{ readonly owner: string; readonly repo: string }>;

export type RepositoryPage = {
  readonly user: SessionUser | null;
  readonly record: RepositoryRecord;
  readonly isOwner: boolean;
  /** `/<owner>/<repo>` as the record names it now. */
  readonly base: string;
};

export async function repositoryPage(params: RepositoryParams): Promise<RepositoryPage> {
  const { owner, repo } = await params;
  const user = await currentUser();
  const found = await lookupRepository(
    decodeURIComponent(owner),
    decodeURIComponent(repo),
    user,
    registryClient(env.GATEWAY),
  );
  if (found.kind === 'not-found') notFound();
  return {
    user,
    record: found.record,
    isOwner: found.isOwner,
    base: repositoryPath(found.record.owner.handle, found.record.name),
  };
}

/** The start page's addresses: the vars, and this site's own origin (from the request). */
export async function startConfig(): Promise<StartConfig> {
  const host = (await headers()).get('host') ?? 'localhost';
  const scheme = /^(localhost|127\.0\.0\.1)(:\d+)?$/.test(host) ? 'http' : 'https';
  const ssh = sshEndpoint(env);
  const base = { gitOrigin: env.GIT_ORIGIN, mcpUrl: env.MCP_URL, webOrigin: `${scheme}://${host}` };
  return ssh === undefined ? base : { ...base, ssh };
}
