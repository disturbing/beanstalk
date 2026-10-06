/**
 * `stream_diffs`: which invocations an engine step started and ended, as the run's
 * `RunStreamDO` needs them (docs/claude-17-streaming-diffs.md). Read from the step's
 * `invocation.start` and `invocation.end` events, so a step the RunDO keeps in memory only
 * reports the same as a stored one. Pure: the RunDO sends the batches.
 */
import type { EmittedEvent } from '../engine/model';
import { STREAMING_KINDS } from './stream-rules';
import type { StreamClose, StreamOpen } from './stream-store';

/** How long past the agent timeout an invocation may stay open before the alarm sweep closes it. */
export const STREAM_SWEEP_MARGIN_S = 300;

export type StreamChanges = {
  readonly opens: readonly StreamOpen[];
  readonly closes: readonly StreamClose[];
};

/** The open invocations of the step's state, by id: where the slot comes from. */
export type OpenSlots = Readonly<Record<string, { readonly slot: string }>>;

/**
 * The step's starts and ends of streaming invocations (`events`, `invocations` of the step's
 * output). The slot comes from the open invocation (the event's `agent` names it too).
 */
export function streamChanges(
  events: readonly EmittedEvent[],
  invocations: OpenSlots,
  ttlMs: number,
): StreamChanges {
  const opens: StreamOpen[] = [];
  const closes: StreamClose[] = [];
  for (const event of events) {
    const fields = invocationFields(event);
    if (fields === null || !STREAMING_KINDS.has(fields.kind)) continue;
    if (event.type === 'invocation.end') {
      closes.push({ inv: fields.inv, task: fields.task, t: event.t });
      continue;
    }
    const slot = invocations[fields.inv]?.slot ?? fields.agent;
    if (event.type === 'invocation.start' && slot !== null)
      opens.push({
        inv: fields.inv,
        task: fields.task,
        slot,
        kind: fields.kind,
        t: event.t,
        ttlMs,
      });
  }
  return { opens, closes };
}

type InvocationFields = {
  readonly inv: string;
  readonly kind: string;
  readonly task: string;
  readonly agent: string | null;
};

function invocationFields(event: EmittedEvent): InvocationFields | null {
  if (event.type !== 'invocation.start' && event.type !== 'invocation.end') return null;
  const inv = textField(event, 'inv');
  const kind = textField(event, 'kind');
  const task = textField(event, 'task');
  if (inv === null || kind === null || task === null) return null;
  return { inv, kind, task, agent: textField(event, 'agent') };
}

function textField(event: EmittedEvent, key: string): string | null {
  const value: unknown = Reflect.get(event, key);
  return typeof value === 'string' ? value : null;
}
