/**
 * The GATEWAY service binding as a typed RPC client, and Zod schemas for what it answers.
 * Wrangler types the binding as a plain `Fetcher` (typing it from the gateway's source would
 * type-check that Worker's code against this one's env), so the client is narrowed here and
 * every answer is validated before the caller trusts it. Shared by the web app and the MCP
 * server, so nothing here names a Workers runtime type.
 */
import { z } from 'zod';

import type { GatewayRpc, RpcResult } from '@beanstalk/shared-race/rpc';

import { ForgeError } from './forge-errors';

const RPC_METHODS = [
  'listRuns',
  'runView',
  'runEvents',
  'decide',
  'viewToken',
  'repoTree',
  'repoFile',
  'repoDiff',
  'repoLog',
  'repoGrep',
  'beansByPath',
  'beanDetail',
  'decisions',
  'testsFor',
  'verifyViewToken',
] as const satisfies readonly (keyof GatewayRpc)[];

/**
 * The binding, once it answers to the gateway's RPC methods. `Binding` is the runtime's
 * binding type (`Fetcher` on Workers), kept so a caller can still use its `fetch`.
 */
export type GatewayBinding<Binding extends object> = Binding & GatewayRpc;

/** Narrows the binding: an RPC stub exposes every method of the remote entrypoint. */
export function asGatewayBinding<Binding extends object>(
  binding: Binding,
): GatewayBinding<Binding> | undefined {
  return isGatewayBinding(binding) ? binding : undefined;
}

function isGatewayBinding<Binding extends object>(
  binding: Binding,
): binding is GatewayBinding<Binding> {
  return RPC_METHODS.every((method) => typeof Reflect.get(binding, method) === 'function');
}

/** Unwraps an RPC result, validating the value; expected failures become ForgeErrors. */
export function unwrap<S extends z.ZodType>(result: RpcResult<unknown>, schema: S): z.infer<S> {
  if (!result.ok) {
    const code = result.error.status === 404 ? 'not_found' : 'unavailable';
    throw new ForgeError(`${result.error.code}: ${result.error.message}`, code);
  }
  const parsed = schema.safeParse(result.value);
  if (!parsed.success) {
    throw new ForgeError(
      `unexpected gateway answer: ${z.prettifyError(parsed.error)}`,
      'bad_response',
    );
  }
  return parsed.data;
}

const TaskCounts = z.record(z.string(), z.number());

export const RunListItem = z.object({
  run: z.string(),
  policy: z.string(),
  phase: z.enum(['created', 'running', 'finishing', 'done']),
  created_at: z.string(),
  agents: z.number().int(),
  tasks: TaskCounts,
  spent_usd: z.number(),
});

/** The part of `runView` the app reads: v2.2's settings, when the run is v2. */
export const RunViewSettings = z.object({
  policy_state: z
    .object({ settings: z.object({ release_on_check: z.boolean() }).optional() })
    .nullable(),
});

export const RunEventsPage = z.object({
  events: z.array(z.string()),
  next_after: z.number().int(),
  done: z.boolean(),
});

export const ViewToken = z.object({ token: z.string(), live_path: z.string().startsWith('/') });

const TreeEntry = z.object({
  path: z.string(),
  type: z.enum(['tree', 'blob', 'symlink', 'gitlink', 'exec']),
});

export const RepoTreeLevel = z.object({
  commit: z.string(),
  entries: z.array(TreeEntry),
  truncated: z.boolean(),
});

export const RepoFileAnswer = z.object({
  commit: z.string(),
  path: z.string(),
  content: z.string().nullable(),
});

export const RepoDiffAnswer = z.object({
  from: z.object({ commit: z.string() }),
  to: z.object({ commit: z.string() }),
  files: z.array(
    z.object({
      path: z.string(),
      status: z.enum(['added', 'deleted', 'modified']),
      additions: z.number().int(),
      deletions: z.number().int(),
    }),
  ),
  patch: z.string(),
  truncated: z.boolean(),
});

export const RepoLogAnswer = z.object({
  commits: z.array(
    z.object({ sha: z.string(), parents: z.array(z.string()), message: z.string() }),
  ),
});

export const RepoGrepAnswer = z.object({
  matches: z.array(z.object({ path: z.string(), line: z.number().int(), text: z.string() })),
});

export const BeanSummaries = z.array(
  z.object({
    bean: z.string(),
    title: z.string(),
    intent: z.string().optional(),
    files: z.array(z.string()),
  }),
);

export const BeanDetailAnswer = z.object({
  bean: z.string(),
  title: z.string(),
  intent: z.string(),
  files: z.array(z.string()),
  head_sha: z.string().nullable(),
  base_sha: z.string().nullable(),
  landed_sha: z.string().nullable(),
  acceptance: z.array(z.object({ path: z.string() })),
});

export const DecisionAnswers = z.array(
  z.object({
    card: z.string(),
    by: z.string().nullable(),
    outcome: z.string().nullable(),
    files: z.array(z.string()),
  }),
);

export const TestCoverages = z.array(
  z.object({ test: z.string(), task: z.string(), covers: z.array(z.string()) }),
);

export const Accepted = z.object({ accepted: z.literal(true) });
