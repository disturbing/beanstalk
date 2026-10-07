/**
 * The repository index through the GATEWAY binding (`RepoIndexRpc`, backlog 2.6): History's
 * validation view and Home's growth lines, read from D1 by the gateway. Every answer is validated; a
 * gateway without the methods reads as "unavailable", so pages fall back to the engine.
 */
import { z } from 'zod';

import type { RepoIndexRpc } from '@beanstalk/shared-race/repo-events';
import { BEAN_STATES } from '@beanstalk/shared-race/repo-events';
import type { Viewer } from '@beanstalk/shared-race/repos';
import type { RpcResult } from '@beanstalk/shared-race/rpc';

import type { Outcome } from './registry-client';
import { RepositoryActivity } from './registry-client';

export const IndexedBean = z.object({
  bean: z.string(),
  title: z.string(),
  actor: z.string().nullable(),
  state: z.enum(BEAN_STATES),
  opened_at: z.string().nullable(),
  landed_at: z.string().nullable(),
  landed_sha: z.string().nullable(),
  promoted_at: z.string().nullable(),
  promoted_sha: z.string().nullable(),
  reverted_at: z.string().nullable(),
  reason: z.string(),
  reworks: z.number(),
  updated_at: z.string(),
});
export type IndexedBean = z.infer<typeof IndexedBean>;

const Day = z.object({
  day: z.string(),
  landed: z.number(),
  promoted: z.number(),
  reverted: z.number(),
  red_validations: z.number(),
  reworks: z.number(),
  decisions: z.number(),
});
export type RepoDay = z.infer<typeof Day>;

export const RepositoryStalk = z.object({
  lines: z
    .object({
      sprout_sha: z.string().nullable(),
      sprout_idx: z.number().nullable(),
      stalk_sha: z.string().nullable(),
      stalk_idx: z.number().nullable(),
      updated_at: z.string(),
    })
    .nullable(),
  validating: z.array(IndexedBean),
  promotions: z.array(
    z.object({
      at: z.string(),
      sha: z.string(),
      kind: z.enum(['promoted', 'demoted']),
      beans: z.array(IndexedBean),
      text: z.string(),
    }),
  ),
  off: z.array(IndexedBean),
  growing: z.array(IndexedBean),
  days: z.array(Day),
  activity: z.array(RepositoryActivity),
  /** Absent from a gateway before History folded the Stalk tab. */
  verdicts: z.array(RepositoryActivity).default([]),
});
export type RepositoryStalk = z.infer<typeof RepositoryStalk>;

export const RepositoryGrowth = z.object({
  repo_id: z.string(),
  landed: z.number(),
  growing: z.number(),
  indexed: z.boolean(),
});
export type RepositoryGrowth = z.infer<typeof RepositoryGrowth>;

export type IndexClient = {
  stalk(repoId: string, viewer: Viewer): Promise<Outcome<RepositoryStalk>>;
  growth(repoIds: readonly string[], viewer: Viewer): Promise<Outcome<readonly RepositoryGrowth[]>>;
};

const UNAVAILABLE = {
  code: 'unavailable',
  message: 'The repository index is not reachable from this deployment.',
} as const;

export function indexClient(binding: object): IndexClient {
  const rpc = isIndexRpc(binding) ? binding : null;
  const call = async <S extends z.ZodType>(
    schema: S,
    use: (index: RepoIndexRpc) => Promise<RpcResult<unknown>>,
  ): Promise<Outcome<z.infer<S>>> => {
    if (rpc === null) return { ok: false, error: UNAVAILABLE };
    const result = await use(rpc);
    if (!result.ok)
      return { ok: false, error: { code: result.error.code, message: result.error.message } };
    return { ok: true, value: schema.parse(result.value) };
  };
  return {
    stalk: (repoId, viewer) => call(RepositoryStalk, (r) => r.repositoryStalk(repoId, viewer)),
    growth: (repoIds, viewer) =>
      repoIds.length === 0
        ? Promise.resolve({ ok: true, value: [] })
        : call(z.array(RepositoryGrowth), (r) => r.repositoryGrowth(repoIds, viewer)),
  };
}

function isIndexRpc(binding: object): binding is RepoIndexRpc {
  return ['repositoryStalk', 'repositoryGrowth'].every(
    (method) => typeof Reflect.get(binding, method) === 'function',
  );
}
