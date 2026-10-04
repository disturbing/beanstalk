import { z } from 'zod';

import type { AgentKind } from './run-config';
import { Sha } from './ids';
import type { InvocationId, SlotId } from './ids';

/**
 * What an invocation is for, as the harness names it. `test-author` (v2.2) is a separate,
 * fresh session that amends a decision loser's acceptance tests; `reconcile` (v2.4) is one
 * that amends two clashing tasks' acceptance tests on the arriving bean's branch. The driver
 * runs both like any other prompt, keeps only their changes to the `acceptance` files, and
 * never restores them.
 */
export type InvocationKind = 'initial' | 'rework' | 'fixer' | 'test-author' | 'reconcile';

/**
 * A merge the driver performs in the worktree before running the agent: `git fetch` the
 * run repo's `ref` (`refs/heads/sprout`, or `refs/heads/stalk` for the queue) from
 * `repo_url`, then `git merge --no-commit --no-ff <sha>`, leaving conflict markers.
 * Idempotent: skip it when `sha` is already an ancestor of HEAD or is MERGE_HEAD.
 */
export type WorkspaceMerge = {
  readonly sha: Sha;
  readonly ref: string;
  /** Conflicted paths the gateway expects (from the runner's merge of the same commits). */
  readonly conflicts: readonly string[];
};

/** One acceptance test version: a path and the exact content the task's author wrote. */
export type TestFile = { readonly path: string; readonly content: string };

/** The git side of an invocation: where the agent works and where the driver pushes. */
export type Workspace = {
  /** The bean's name (`beans/t001`), a branch of the run repo; a label, never a credential. */
  readonly bean: string;
  /**
   * Gateway git URL that holds the bean: the run repo. Fetch from it, and push `branch` to
   * it with the slot token (the gateway accepts only that branch, never a deletion).
   */
  readonly bean_url: string;
  /** Gateway git URL of the run repo (the sprout, the stalk and every bean). */
  readonly repo_url: string;
  /** The bean's branch, which the driver pushes (`beans/t001`). */
  readonly branch: string;
  /** The task's base commit: the initial checkout point and the diff base for `files`. */
  readonly base_sha: Sha;
  /** The branch head the gateway last recorded, or null before the first push. */
  readonly head_sha: Sha | null;
  readonly merge: WorkspaceMerge | null;
  /**
   * The task's own acceptance tests: write before the initial run (whenever `head_sha` is
   * null), restore before every commit. For `test-author` and `reconcile`, the tests to amend
   * (for `reconcile`, both tasks'): written at the start when `head_sha` is null, never
   * restored, and the only files whose changes are committed.
   */
  readonly acceptance: Readonly<Record<string, string>>;
  /**
   * `protect_tests=landed`: landed tasks' acceptance tests, in task order (two tasks may
   * carry the same path). Restore one only when that exact content is in the worktree's
   * lineage (HEAD or MERGE_HEAD) and the working copy differs.
   */
  readonly protect: readonly TestFile[];
  /** `.git/info/attributes` patterns with `merge=union` for every merge in this worktree. */
  readonly union_paths: readonly string[];
  /** Message for the commit the driver makes after the agent (the harness's commit_task). */
  readonly commit_message: string;
};

/** Hints for the replay agent only (reference patches live with the driver's arena copy). */
export type ReplayHints = {
  /** Resolve "on the new head": reset the tree to this commit before re-applying patches. */
  readonly reset_to: Sha | null;
  /** Run the suite after re-applying patches and report `unresolved` when it breaks. */
  readonly check: 'suite' | 'acceptance' | null;
  /** Tasks whose `solutions/<id>.fix.patch` the replay agent applies. */
  readonly fixes: readonly string[];
};

/** One agent invocation, as `POST /v1/runs/:run/agents/:slot/next` returns it. */
export type Instruction = {
  readonly inv: InvocationId;
  readonly kind: InvocationKind;
  readonly task: string;
  readonly slot: SlotId;
  readonly attempt: number;
  readonly prompt: string;
  /** Session to resume (`claude --resume`), or null for a fresh session. */
  readonly resume: string | null;
  readonly adapter: AgentKind;
  readonly model: string | null;
  readonly max_turns: number;
  readonly timeout_seconds: number;
  /** Per-invocation spend cap (`--max-budget-usd`): min(max_invocation_usd, budget left). */
  readonly budget_cap_usd: number;
  readonly workspace: Workspace;
  readonly replay: ReplayHints;
};

/** A refreshed slot token; replace the one in use. */
export type TokenRefresh = { readonly token: string; readonly expires_at: string };

/** Response of the long poll: an invocation, nothing yet, or the end of the run. */
export type NextResponse =
  | { readonly invocation: Instruction; readonly token?: TokenRefresh }
  | { readonly wait: true; readonly token?: TokenRefresh }
  | { readonly done: true; readonly aborted: string | null };

const Json: z.ZodType = z.unknown();

/**
 * Body of `POST /v1/runs/:run/invocations/:inv/result`, posted after the driver has
 * committed and pushed. It is the harness's `InvocationResult.to_event()` (so the
 * `invocation.end` event matches the local log) plus the git outcome. Unknown keys are
 * dropped rather than rejected so the Python dataclass can grow without breaking runs.
 */
export const InvocationResult = z
  .object({
    ok: z.boolean(),
    infra_error: z.string().max(20_000).nullable().default(null),
    timed_out: z.boolean().default(false),
    exit_code: z.number().int().nullable().default(null),
    subtype: z.string().max(100).nullable().default(null),
    is_error: z.boolean().default(false),
    cost_usd: z.number().min(0).max(10_000).default(0),
    cost_source: z.string().max(40).default('none'),
    num_turns: z.number().int().min(0).nullable().default(null),
    duration_ms: z.number().min(0).nullable().default(null),
    duration_api_ms: z.number().min(0).nullable().default(null),
    wall_ms: z.number().min(0).default(0),
    startup_ms: z.number().min(0).nullable().default(null),
    session_id: z.string().max(200).nullable().default(null),
    usage: z.record(z.string(), z.number()).default({}),
    model_usage: z.record(z.string(), Json).default({}),
    permission_denials: z.array(Json).default([]),
    tool_uses: z.record(z.string(), z.number()).default({}),
    result_text: z.string().default(''),
    structured_output: Json.default(null),
    transcript: z.string().max(1000).nullable().default(null),
    notes: z.array(z.string()).default([]),
    rate_limit: z.record(z.string(), Json).nullable().default(null),
    rate_limited: z.boolean().default(false),
    init: z.record(z.string(), Json).default({}),
    /** §4 short names; used only when `num_turns` / `wall_ms` are absent. */
    turns: z.number().int().min(0).optional(),
    wall_seconds: z.number().min(0).optional(),
    pushed_ref: z.string().max(300).nullable().default(null),
    head_sha: Sha.nullable().default(null),
    new_commit: z.boolean().default(false),
    /** `git diff --name-only <workspace.base_sha> <head_sha>`. */
    files: z.array(z.string().max(512)).max(10_000).default([]),
    /** Acceptance test paths the driver restored before committing. */
    tamper: z.array(z.string().max(512)).max(1000).default([]),
    /** Files still holding conflict markers; the driver did not commit when non-empty. */
    markers_left: z.array(z.string().max(512)).max(1000).default([]),
    /** Paths the driver's own merge left conflicted (diagnostics only). */
    merge_conflicts: z.array(z.string().max(512)).max(1000).nullable().default(null),
  })
  .transform((result) => ({
    ...result,
    num_turns: result.num_turns ?? result.turns ?? null,
    wall_ms: result.wall_ms > 0 ? result.wall_ms : Math.round((result.wall_seconds ?? 0) * 1000),
  }));
export type InvocationResult = z.output<typeof InvocationResult>;
export type InvocationResultInput = z.input<typeof InvocationResult>;

/** Body of `POST /v1/runs/:run/invocations/:inv/progress`: the running cost estimate. */
export const InvocationProgress = z.strictObject({
  cost_usd: z.number().min(0).max(10_000),
});
export type InvocationProgress = z.infer<typeof InvocationProgress>;

/**
 * Body of `POST /v1/runs/:run/decisions/:card` (admin): which spec wins the card, and
 * optionally the decision line the test author and the loser read (else one is written).
 */
export const DecisionBody = z.strictObject({
  winner: z.string().min(1).max(64),
  text: z.string().min(1).max(2000).optional(),
});
export type DecisionBody = z.infer<typeof DecisionBody>;

/** Response to a progress report: keep going, or kill the agent (the run aborted). */
export type ProgressResponse =
  | { readonly abort: false }
  | { readonly abort: true; readonly reason: string };
