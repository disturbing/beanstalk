/**
 * Streaming diffs (`stream_diffs`): a bean's working change while its agent writes, as the
 * run's stream socket sends it (`bean.streaming`, `bean.streaming.end` to every viewer;
 * `bean.snapshot` and `bean.patch` to the viewers of that bean, docs/claude-17-streaming-diffs.md)
 * and as the `beanStream` RPC serves it. The two RPC methods are optional on the binding, so an older
 * gateway without them still counts as a gateway (`asGatewayBinding` checks the rest).
 */
import { parsePatch } from 'diff';
import { z } from 'zod';

import type { RpcResult } from '@beanstalk/shared-race/rpc';

import type { FileDiff } from '../repo/repo-types';
import { toHunk } from '../repo/file-diff';
import { unwrap } from './gateway-rpc';

const Status = z.enum(['added', 'modified', 'deleted']);

export const BeanStreamSummary = z.object({
  type: z.literal('bean.streaming'),
  task: z.string(),
  inv: z.string(),
  agent: z.string(),
  seq: z.number().int(),
  t: z.number(),
  files: z.array(
    z.object({
      path: z.string(),
      status: Status,
      additions: z.number().int(),
      deletions: z.number().int(),
    }),
  ),
  additions: z.number().int(),
  deletions: z.number().int(),
  truncated: z.boolean(),
  redacted: z.number().int().default(0),
});
export type BeanStreamSummary = z.infer<typeof BeanStreamSummary>;

export const BeanStreamEnd = z.object({
  type: z.literal('bean.streaming.end'),
  task: z.string(),
  inv: z.string(),
  t: z.number(),
});
export type BeanStreamEnd = z.infer<typeof BeanStreamEnd>;

/** A summary or an end: what every viewer gets. */
export const BeanStreamMessage = z.discriminatedUnion('type', [BeanStreamSummary, BeanStreamEnd]);
export type BeanStreamMessage = z.infer<typeof BeanStreamMessage>;

export const StreamFile = z.object({
  path: z.string(),
  status: Status,
  additions: z.number().int(),
  deletions: z.number().int(),
  binary: z.boolean(),
  patch: z.string().nullable(),
});
export type StreamFile = z.infer<typeof StreamFile>;

/** A subscribed bean's whole snapshot, sent when the viewer subscribes to it. */
export const BeanStreamSnapshot = z.object({
  type: z.literal('bean.snapshot'),
  task: z.string(),
  inv: z.string(),
  seq: z.number().int(),
  files: z.array(StreamFile),
});
export type BeanStreamSnapshot = z.infer<typeof BeanStreamSnapshot>;

/** What one accepted post changed in a subscribed bean; `base_seq: 0` replaces the snapshot. */
export const BeanStreamPatch = z.object({
  type: z.literal('bean.patch'),
  task: z.string(),
  inv: z.string(),
  seq: z.number().int(),
  base_seq: z.number().int(),
  files: z.array(StreamFile),
  removed: z.array(z.string()),
});
export type BeanStreamPatch = z.infer<typeof BeanStreamPatch>;

/** Any message of the run's stream socket. */
export const BeanStreamSocketMessage = z.discriminatedUnion('type', [
  BeanStreamSummary,
  BeanStreamEnd,
  BeanStreamSnapshot,
  BeanStreamPatch,
]);
export type BeanStreamSocketMessage = z.infer<typeof BeanStreamSocketMessage>;

export const BeanStreamAnswer = z
  .object({ summary: BeanStreamSummary, files: z.array(StreamFile) })
  .nullable();

/** A bean's streamed change, ready to draw. */
export type BeanStreamView = {
  readonly summary: BeanStreamSummary;
  readonly files: readonly FileDiff[];
};

type StreamRpc = {
  beanStreams(run: string): Promise<RpcResult<unknown>>;
  beanStream(run: string, bean: string): Promise<RpcResult<unknown>>;
};

/** The binding's stream methods, or undefined for a gateway that predates them. */
export function streamRpcOf(binding: object): StreamRpc | undefined {
  const beanStreams: unknown = Reflect.get(binding, 'beanStreams');
  const beanStream: unknown = Reflect.get(binding, 'beanStream');
  if (typeof beanStreams !== 'function' || typeof beanStream !== 'function') return undefined;
  return {
    beanStreams: async (run) => Reflect.apply(beanStreams, binding, [run]),
    beanStream: async (run, bean) => Reflect.apply(beanStream, binding, [run, bean]),
  };
}

/** Every bean streaming now (none from an older gateway). */
export async function currentStreams(
  binding: object,
  run: string,
): Promise<readonly BeanStreamSummary[]> {
  const rpc = streamRpcOf(binding);
  if (rpc === undefined) return [];
  return unwrap(await rpc.beanStreams(run), z.array(BeanStreamSummary));
}

/** A bean's latest snapshot as file diffs; null while nothing streams. */
export async function beanStreamView(
  binding: object,
  run: string,
  bean: string,
): Promise<BeanStreamView | null> {
  const rpc = streamRpcOf(binding);
  if (rpc === undefined) return null;
  const answer = unwrap(await rpc.beanStream(run, bean), BeanStreamAnswer);
  if (answer === null) return null;
  return { summary: answer.summary, files: answer.files.map(toFileDiff) };
}

/** One streamed file as a file diff: its hunk text parsed into numbered lines. */
export function toFileDiff(file: StreamFile): FileDiff {
  const { path, status, additions, deletions } = file;
  if (file.patch === null || file.patch === '')
    return { path, status, additions, deletions, hunks: [] };
  const [parsed] = parsePatch(`--- a/${path}\n+++ b/${path}\n${file.patch}`);
  return { path, status, additions, deletions, hunks: (parsed?.hunks ?? []).map(toHunk) };
}
