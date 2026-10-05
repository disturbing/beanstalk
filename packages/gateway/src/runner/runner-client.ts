/**
 * The runner's §3 HTTP API (packages/runner, `wire/`), spoken through a container stub.
 * Request bodies carry Artifacts tokens: they are never logged, and error messages are the
 * runner's own (it redacts tokens from git output).
 */
import { z } from 'zod';

import { Sha } from '@beanstalk/shared-race/ids';

import type { CheckResult, ConflictHunk, Resolution } from '../engine/model';
import { UpstreamError } from '../errors';

/** Longest runner call: a suite has a 300 s timeout in the runner; fetches come on top. */
const RUNNER_TIMEOUT_MS = 10 * 60 * 1000;
/** Characters of a failed runner response kept in the error message. */
const ERROR_EXCERPT_CHARS = 500;

/** A git remote and the Artifacts token minted for this one job. */
export type RunnerRemote = { readonly repo: string; readonly token: string };

/** The runner's `repo` is the run repo (the sprout and the stalk); its contract calls it the trunk. */
export type SquashCall = {
  readonly trunk: RunnerRemote;
  readonly onto: Sha;
  readonly change: RunnerRemote & { readonly ref: string; readonly base: Sha };
  readonly message: string;
  readonly unionPaths: readonly string[];
  /** The runner's `structural_merge`: false keeps git's line merge alone (the queue). */
  readonly structural: boolean;
};

export type SquashOutcome =
  | {
      readonly result: 'clean';
      readonly sha: Sha;
      readonly files: readonly string[];
      readonly mergeBase: Sha;
      /** The change's own write set (`base..head`), present because the call names the base. */
      readonly changeFiles: readonly string[] | null;
      /** The merge tier that produced it (Mergiraf's when git's line merge conflicted). */
      readonly resolved: Resolution;
    }
  | {
      readonly result: 'conflict';
      readonly files: readonly string[];
      readonly mergeBase: Sha;
      /** Both sides of each conflict block, for the author's prompt. */
      readonly hunks: readonly ConflictHunk[];
    };

export type RevertCall = {
  readonly trunk: RunnerRemote;
  readonly onto: Sha;
  readonly commit: Sha;
  readonly message: string;
  readonly unionPaths: readonly string[];
};

export type RevertOutcome =
  | { readonly result: 'clean'; readonly sha: Sha; readonly files: readonly string[] }
  | { readonly result: 'conflict'; readonly files: readonly string[] };

export type CheckCall = {
  readonly trunk: RunnerRemote;
  readonly sha: Sha;
  readonly extraFiles: Readonly<Record<string, string>> | null;
  /** Run only these test files (`node --test <files>`); null runs the whole suite. */
  readonly only?: readonly string[] | null;
  /** Also report the passing test files' read sets. */
  readonly allReadSets?: boolean;
};

export type UpdateRefCall = {
  readonly trunk: RunnerRemote;
  readonly ref: string;
  readonly newSha: Sha;
  readonly oldSha: Sha;
};

export type RunnerPort = {
  squash(instance: string, call: SquashCall): Promise<SquashOutcome>;
  revert(instance: string, call: RevertCall): Promise<RevertOutcome>;
  check(instance: string, call: CheckCall): Promise<CheckResult>;
  updateRef(instance: string, call: UpdateRefCall): Promise<{ ok: boolean; actual: Sha | null }>;
};

/** Something with a `fetch`: a container stub, or a fake in tests. */
export type RunnerStub = { fetch(request: Request): Promise<Response> };

const SquashResponse = z.discriminatedUnion('result', [
  z.object({
    result: z.literal('clean'),
    sha: Sha,
    files: z.array(z.string()),
    merge_base: Sha,
    change_files: z.array(z.string()).optional(),
    resolved: z.enum(['textual', 'structural']).optional(),
  }),
  z.object({
    result: z.literal('conflict'),
    files: z.array(z.string()),
    merge_base: Sha,
    hunks: z.array(z.object({ path: z.string(), onto: z.string(), change: z.string() })).optional(),
  }),
]);

const RevertResponse = z.discriminatedUnion('result', [
  z.object({ result: z.literal('clean'), sha: Sha, files: z.array(z.string()) }),
  z.object({ result: z.literal('conflict'), files: z.array(z.string()) }),
]);

const CheckResponse = z.object({
  green: z.boolean(),
  tests: z.number().int().min(0),
  failures: z.number().int().min(0),
  failing_tests: z.array(
    z.object({ file: z.string(), name: z.string(), message: z.string().optional() }),
  ),
  failing_files: z.array(z.string()).nullable(),
  passing_files: z.array(z.string()).optional(),
  read_set: z.array(z.string()).optional(),
  read_sets: z.record(z.string(), z.array(z.string())).optional(),
  passing_read_sets: z.record(z.string(), z.array(z.string())).optional(),
  read_depths: z.record(z.string(), z.record(z.string(), z.number().int().min(0))).optional(),
  stack_files: z.array(z.string()).optional(),
  output_excerpt: z.string().optional(),
  suite_seconds: z.number().min(0),
  timed_out: z.boolean().optional(),
});

const UpdateRefResponse = z.object({ ok: z.boolean(), actual: Sha.nullable().optional() });

/** The runner API over container stubs picked by instance name. */
export function runnerPort(stubFor: (instance: string) => RunnerStub): RunnerPort {
  const post = async <T>(
    instance: string,
    path: string,
    body: unknown,
    schema: z.ZodType<T>,
  ): Promise<T> => {
    const response = await send(stubFor(instance), path, body);
    const parsed = schema.safeParse(await response.json());
    if (!parsed.success)
      throw new UpstreamError(`runner ${path} answered an unexpected body`, false);
    return parsed.data;
  };
  return {
    async squash(instance, call) {
      const response = await post(instance, '/v1/squash', squashBody(call), SquashResponse);
      return response.result === 'clean'
        ? {
            result: 'clean',
            sha: response.sha,
            files: response.files,
            mergeBase: response.merge_base,
            changeFiles: response.change_files ?? null,
            resolved: response.resolved ?? 'textual',
          }
        : {
            result: 'conflict',
            files: response.files,
            mergeBase: response.merge_base,
            hunks: (response.hunks ?? []).map(({ path, onto, change }) => ({
              path,
              sprout: onto,
              bean: change,
            })),
          };
    },
    async revert(instance, call) {
      const body = {
        repo: call.trunk.repo,
        token: call.trunk.token,
        onto: call.onto,
        commit: call.commit,
        message: call.message,
        union_paths: call.unionPaths,
      };
      const response = await post(instance, '/v1/revert', body, RevertResponse);
      return response.result === 'clean'
        ? { result: 'clean', sha: response.sha, files: response.files }
        : { result: 'conflict', files: response.files };
    },
    async check(instance, call) {
      const body = {
        repo: call.trunk.repo,
        token: call.trunk.token,
        sha: call.sha,
        extra_files: call.extraFiles ?? {},
        latency_seconds: 0,
        ...(call.only === undefined || call.only === null
          ? {}
          : { cmd: ['node', '--test', ...call.only] }),
        ...(call.allReadSets === true ? { all_read_sets: true } : {}),
      };
      return toCheckResult(await post(instance, '/v1/check', body, CheckResponse));
    },
    async updateRef(instance, call) {
      const body = {
        repo: call.trunk.repo,
        token: call.trunk.token,
        ref: call.ref,
        new: call.newSha,
        old: call.oldSha,
      };
      const response = await post(instance, '/v1/update-ref', body, UpdateRefResponse);
      return { ok: response.ok, actual: response.actual ?? null };
    },
  };
}

function squashBody(call: SquashCall): Record<string, unknown> {
  return {
    repo: call.trunk.repo,
    token: call.trunk.token,
    onto: call.onto,
    change: {
      repo: call.change.repo,
      token: call.change.token,
      ref: call.change.ref,
      base: call.change.base,
    },
    message: call.message,
    union_paths: call.unionPaths,
    structural_merge: call.structural,
  };
}

async function send(stub: RunnerStub, path: string, body: unknown): Promise<Response> {
  const request = new Request(`http://runner${path}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(RUNNER_TIMEOUT_MS),
  });
  const response = await callRunner(stub, request, path);
  if (response.ok) return response;
  const excerpt = (await response.text()).slice(0, ERROR_EXCERPT_CHARS);
  const isRetryable = response.status === 429 || response.status >= 500;
  throw new UpstreamError(`runner ${path} answered ${response.status}: ${excerpt}`, isRetryable);
}

async function callRunner(stub: RunnerStub, request: Request, path: string): Promise<Response> {
  try {
    return await stub.fetch(request);
  } catch (error: unknown) {
    throw new UpstreamError(`runner ${path} unreachable`, true, { cause: error });
  }
}

function toCheckResult(response: z.infer<typeof CheckResponse>): CheckResult {
  return {
    green: response.green,
    tests: response.tests,
    failures: response.failures,
    failingTests: response.failing_tests.map((test) =>
      test.message === undefined
        ? { file: test.file, name: test.name }
        : { file: test.file, name: test.name, message: test.message },
    ),
    failingFiles: response.failing_files,
    passingFiles: response.passing_files ?? null,
    readSet: response.read_set ?? [],
    readSets: response.read_sets ?? {},
    ...(response.passing_read_sets === undefined
      ? {}
      : { passingReadSets: response.passing_read_sets }),
    readDepths: response.read_depths ?? {},
    stackFiles: response.stack_files ?? [],
    output: response.output_excerpt ?? '',
    suiteSeconds: response.suite_seconds,
    timedOut: response.timed_out ?? false,
  };
}
