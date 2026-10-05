/**
 * Performs the engine's jobs against the platform: squashes, reverts, suites and ref
 * updates through the runner container; file reads and diffs through the Artifacts
 * binding. Beans are branches of the run repo, so every job works on that one repo. Every
 * runner call gets Artifacts tokens minted for it (write only for the committer
 * instance); none is ever logged.
 */
import type { RunId } from '@beanstalk/shared-race/ids';

import type {
  ArtifactsPort,
  CommitRange,
  MintedToken,
  RepoRemote,
  TokenScope,
} from '../adapters/artifacts';
import type { CheckInstance, JobOutcome, JobResult, JobSpec } from '../engine/model';
import { assertNever } from '../engine/errors';
import { UpstreamError } from '../errors';
import { changedRanges, diffText } from '../git/diff-text';
import type { Logger } from '../log';
import type { RunnerPort, RunnerRemote } from '../runner/runner-client';
import { ciInstance, committerInstance, sandboxInstance } from './run-names';

/** Re-mint a cached token when it has less than this left. */
const TOKEN_REFRESH_MARGIN_MS = 2 * 60 * 1000;
/** File reads in flight at once (a DO allows six outgoing connections per request). */
const READ_CONCURRENCY = 4;
/** What a diff shows when the binding cannot read one of the commits. */
const DIFF_UNAVAILABLE = '(diff unavailable)';

/** The run's repo, as the RunDO stores it: the sprout, the stalk and every bean branch. */
export type RunRepos = { readonly repo: RepoRemote };

/** Mints Artifacts tokens and reuses them until shortly before they expire. */
export type TokenSource = { token(repo: string, scope: TokenScope): Promise<string> };

export function cachingTokenSource(
  artifacts: ArtifactsPort,
  options: { ttlSeconds: number; now: () => number },
): TokenSource {
  const cache = new Map<string, MintedToken>();
  return {
    async token(repo, scope) {
      const key = `${scope}:${repo}`;
      const cached = cache.get(key);
      if (cached !== undefined && cached.expiresAtMs - options.now() > TOKEN_REFRESH_MARGIN_MS)
        return cached.token;
      const minted = await artifacts.mintToken(repo, scope, options.ttlSeconds);
      cache.set(key, minted);
      return minted.token;
    },
  };
}

export type JobContext = {
  readonly run: RunId;
  readonly artifacts: ArtifactsPort;
  readonly runner: RunnerPort;
  readonly tokens: TokenSource;
  readonly log: Logger;
  readonly repos: () => RunRepos;
};

/** Runs one job; failures come back as outcomes, never as exceptions. */
export async function executeJob(spec: JobSpec, context: JobContext): Promise<JobOutcome> {
  try {
    return { ok: true, result: await perform(spec, context) };
  } catch (error: unknown) {
    const retryable = error instanceof UpstreamError && error.retryable;
    const message = error instanceof Error ? error.message : String(error);
    context.log.warn('job failed', { job: spec.kind, retryable, error });
    return { ok: false, error: message, retryable };
  }
}

async function perform(spec: JobSpec, context: JobContext): Promise<JobResult> {
  switch (spec.kind) {
    case 'squash':
      return squash(spec, context);
    case 'revert':
      return revert(spec, context);
    case 'check':
      return check(spec, context);
    case 'diff':
      return diff(spec, context);
    case 'line-ranges':
      return lineRanges(spec, context);
    case 'update-ref':
      return updateRef(spec, context);
    case 'read-files':
      return readFiles(spec, context);
    default:
      return assertNever(spec);
  }
}

/** The run repo with a token of `scope` minted for this job. */
async function runRepo(context: JobContext, scope: TokenScope): Promise<RunnerRemote> {
  const repo = context.repos().repo;
  return { repo: repo.remote, token: await context.tokens.token(repo.name, scope) };
}

async function squash(
  spec: Extract<JobSpec, { kind: 'squash' }>,
  context: JobContext,
): Promise<JobResult> {
  const [trunk, change] = await Promise.all([runRepo(context, 'write'), runRepo(context, 'read')]);
  const outcome = await context.runner.squash(committerInstance(context.run), {
    trunk,
    onto: spec.onto,
    change: { ...change, ref: spec.changeRef, base: spec.changeBase },
    message: spec.message,
    unionPaths: spec.unionPaths,
    structural: spec.structural,
  });
  if (outcome.mergeBase !== spec.changeBase) {
    context.log.warn('runner merge base differs from the engine', {
      task: spec.changeKey,
      engine: spec.changeBase,
      runner: outcome.mergeBase,
    });
  }
  return outcome.result === 'clean'
    ? {
        kind: 'squash',
        outcome: 'clean',
        sha: outcome.sha,
        files: outcome.files,
        changeFiles: outcome.changeFiles,
        resolved: outcome.resolved,
      }
    : { kind: 'squash', outcome: 'conflict', files: outcome.files, hunks: outcome.hunks };
}

async function revert(
  spec: Extract<JobSpec, { kind: 'revert' }>,
  context: JobContext,
): Promise<JobResult> {
  const outcome = await context.runner.revert(committerInstance(context.run), {
    trunk: await runRepo(context, 'write'),
    onto: spec.onto,
    commit: spec.commit,
    message: spec.message,
    unionPaths: spec.unionPaths,
  });
  return outcome.result === 'clean'
    ? { kind: 'revert', outcome: 'clean', sha: outcome.sha, files: outcome.files }
    : { kind: 'revert', outcome: 'conflict', files: outcome.files };
}

/** Suites never run on the committer and never get a write token. */
async function check(
  spec: Extract<JobSpec, { kind: 'check' }>,
  context: JobContext,
): Promise<JobResult> {
  const result = await context.runner.check(checkInstance(context.run, spec.instance), {
    trunk: await runRepo(context, 'read'),
    sha: spec.sha,
    extraFiles: spec.extraFiles,
    only: spec.only ?? null,
    allReadSets: spec.allReadSets === true,
  });
  return { kind: 'check', check: result };
}

function checkInstance(run: RunId, instance: CheckInstance): string {
  switch (instance.kind) {
    case 'ci':
      return ciInstance(run, instance.slot);
    case 'sandbox':
      return sandboxInstance(run, instance.slot);
    default:
      return assertNever(instance);
  }
}

async function diff(
  spec: Extract<JobSpec, { kind: 'diff' }>,
  context: JobContext,
): Promise<JobResult> {
  const changes = await context.artifacts.changedFiles(context.repos().repo.name, {
    from: spec.parent,
    to: spec.sha,
  });
  return {
    kind: 'diff',
    text: changes === null ? DIFF_UNAVAILABLE : diffText(changes, spec.limit),
  };
}

/** The `-U0` line ranges of two changes against one base, in the files they share (`hunk`). */
async function lineRanges(
  spec: Extract<JobSpec, { kind: 'line-ranges' }>,
  context: JobContext,
): Promise<JobResult> {
  const [mine, theirs] = await Promise.all([
    rangesOf(context, { from: spec.base, to: spec.mine, paths: spec.files }),
    rangesOf(context, { from: spec.base, to: spec.theirs, paths: spec.files }),
  ]);
  return { kind: 'line-ranges', mine, theirs };
}

async function rangesOf(
  context: JobContext,
  range: CommitRange & { paths: readonly string[] },
): Promise<Record<string, [number, number][]>> {
  const changes = await context.artifacts.changedFiles(context.repos().repo.name, range);
  if (changes === null) {
    throw new UpstreamError(`cannot read ${range.from}..${range.to} of the run repo`, true);
  }
  const files = new Set(range.paths);
  return Object.fromEntries(
    changes
      .filter((change) => files.has(change.path))
      .map((change) => [change.path, changedRanges(change.before, change.after)]),
  );
}

async function updateRef(
  spec: Extract<JobSpec, { kind: 'update-ref' }>,
  context: JobContext,
): Promise<JobResult> {
  const outcome = await context.runner.updateRef(committerInstance(context.run), {
    trunk: await runRepo(context, 'write'),
    ref: spec.ref,
    newSha: spec.newSha,
    oldSha: spec.oldSha,
  });
  return { kind: 'update-ref', ok: outcome.ok, actual: outcome.actual };
}

async function readFiles(
  spec: Extract<JobSpec, { kind: 'read-files' }>,
  context: JobContext,
): Promise<JobResult> {
  const repo = context.repos().repo;
  const contents: (string | null)[] = [];
  for (let start = 0; start < spec.reads.length; start += READ_CONCURRENCY) {
    const batch = spec.reads.slice(start, start + READ_CONCURRENCY);
    const reads = batch.map(({ ref, path }) => context.artifacts.readFile(repo.name, ref, path));
    // oxlint-disable-next-line no-await-in-loop -- batches bound the connections in flight
    contents.push(...(await Promise.all(reads)));
  }
  return { kind: 'read-files', contents };
}
