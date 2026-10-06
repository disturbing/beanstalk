/**
 * Reaping a finished run's Artifacts repos: the run repo, plus any `race-<run>-*` repo an
 * earlier gateway made for it (forked beans, trunks). The namespace is listed, so repos the
 * RunDO never recorded are found too.
 */
import type { RunId } from '@beanstalk/shared-race/ids';

import type { ArtifactsPort } from '../adapters/artifacts';
import { isRunRepo } from './run-names';

/** Deletes in flight at once. */
const DELETE_CONCURRENCY = 4;

/** `list` only reports; `delete` deletes what it lists. */
export type ReapMode = 'list' | 'delete';

export type ReapReport = {
  readonly repos: readonly string[];
  readonly deleted: readonly string[];
  readonly failed: readonly { readonly repo: string; readonly error: string }[];
};

/**
 * How to reap: `mode`, and the namespace's repo names when the caller listed them already
 * (the run index's sweep lists once for every run); absent, the namespace is listed here.
 */
export type ReapOptions = {
  readonly mode: ReapMode;
  readonly listed?: readonly string[];
};

export async function reapRepos(
  artifacts: ArtifactsPort,
  run: RunId,
  options: ReapOptions,
): Promise<ReapReport> {
  const repos =
    options.listed === undefined
      ? await artifacts.listRepos((name) => isRunRepo(run, name))
      : options.listed.filter((name) => isRunRepo(run, name));
  if (options.mode === 'list') return { repos, deleted: [], failed: [] };
  const deleted: string[] = [];
  const failed: { repo: string; error: string }[] = [];
  for (let start = 0; start < repos.length; start += DELETE_CONCURRENCY) {
    const batch = repos.slice(start, start + DELETE_CONCURRENCY);
    // oxlint-disable-next-line no-await-in-loop -- batches bound the deletes in flight
    const outcomes = await Promise.allSettled(batch.map((repo) => artifacts.deleteRepo(repo)));
    outcomes.forEach((outcome, index) => {
      const repo = batch[index] ?? '?';
      if (outcome.status === 'fulfilled') {
        deleted.push(repo);
        return;
      }
      const reason: unknown = outcome.reason;
      failed.push({ repo, error: reason instanceof Error ? reason.message : String(reason) });
    });
  }
  return { repos, deleted, failed };
}

/** Where a run's repos stand, as its summary reports it. */
export type RepoStatus =
  | { readonly status: 'live' | 'kept' | 'reaping' }
  | {
      readonly status: 'reaped' | 'reap_failed';
      readonly deleted: readonly string[];
      readonly failed: ReapReport['failed'];
    };

export function repoStatus(input: {
  readonly done: boolean;
  readonly keepRepo: boolean;
  readonly reaped: ReapReport | null;
}): RepoStatus {
  const { reaped } = input;
  if (reaped !== null) {
    const status = reaped.failed.length === 0 ? 'reaped' : 'reap_failed';
    return { status, deleted: reaped.deleted, failed: reaped.failed };
  }
  if (!input.done) return { status: 'live' };
  return { status: input.keepRepo ? 'kept' : 'reaping' };
}
