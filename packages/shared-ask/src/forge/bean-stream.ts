/**
 * Streaming diffs (`stream_diffs`): a bean's working change while its agent writes, as the
 * gateway's live feed announces it (`bean.streaming`, `bean.streaming.end`) and as its
 * `beanStream` RPC serves it. The two RPC methods are optional on the binding, so an older
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

/** A `stream` message of the live feed. */
export const BeanStreamMessage = z.discriminatedUnion('type', [BeanStreamSummary, BeanStreamEnd]);
export type BeanStreamMessage = z.infer<typeof BeanStreamMessage>;

const StreamFile = z.object({
  path: z.string(),
  status: Status,
  additions: z.number().int(),
  deletions: z.number().int(),
  binary: z.boolean(),
  patch: z.string().nullable(),
});

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

function toFileDiff(file: z.infer<typeof StreamFile>): FileDiff {
  const { path, status, additions, deletions } = file;
  if (file.patch === null || file.patch === '')
    return { path, status, additions, deletions, hunks: [] };
  const [parsed] = parsePatch(`--- a/${path}\n+++ b/${path}\n${file.patch}`);
  return { path, status, additions, deletions, hunks: (parsed?.hunks ?? []).map(toHunk) };
}
