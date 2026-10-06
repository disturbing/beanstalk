/**
 * Which engine steps the RunDO must persist. Most steps of a race are long-poll bookkeeping
 * (a 30-agent replay: 88% `poll` / `poll-expired`): they move a slot's `pollId` and the clock,
 * which a restart clears or recomputes anyway, and nothing else. Writing the whole state (up
 * to 1.5 MB) for each is the RunDO's main cost, so such steps stay in memory only.
 *
 * The check is structural and cheap: a step is quiet when it emitted no event, started no
 * job, answered no poll with anything but `wait`, and left the state's fingerprint (every
 * part a quiet input could touch: counters, phase, slots without their `pollId`, the timer
 * and job sets, the policy and CI state) as it was. A `progress` report also moves its
 * invocation's running cost estimate; that is kept in memory and folded into the next write,
 * or written on its own once it has waited `COST_FLUSH_MS`.
 */
import type { EngineInput } from '../engine/model';
import type { EngineState, StepOutput } from '../engine/state';

/** A cost estimate kept only in memory is written after at most this long. */
export const COST_FLUSH_MS = 30_000;

/** Inputs that may leave nothing to persist. Every other input's step is written. */
const QUIET_INPUTS: ReadonlySet<EngineInput['kind']> = new Set([
  'poll',
  'poll-expired',
  'progress',
]);

/** What a step needs written: the whole state, or nothing (`cost`: nothing yet, a cost moved). */
export type StepWrite = 'state' | 'cost' | 'none';

/**
 * The fingerprint of everything a quiet input could change besides `pollId`, the clock and
 * running cost estimates. Two states with the same fingerprint and seq persist the same.
 */
export function stepFingerprint(state: EngineState): string {
  return JSON.stringify([
    state.seq,
    state.counters,
    state.phase,
    state.aborted,
    state.paused,
    state.spent,
    state.slots.map(({ pollId: _pollId, ...slot }) => slot),
    Object.keys(state.timers),
    Object.keys(state.jobs),
    Object.keys(state.invocations),
    state.policy,
    state.ci,
  ]);
}

/**
 * Classifies a step. `before` is the fingerprint of the state the step started from; it is
 * computed only when the step looks quiet (the caller passes a thunk).
 */
export function classifyStep(
  input: EngineInput,
  output: StepOutput,
  before: () => string,
): { readonly write: StepWrite; readonly fingerprint: string | null } {
  if (!looksQuiet(input, output)) return { write: 'state', fingerprint: null };
  const after = stepFingerprint(output.state);
  if (after !== before()) return { write: 'state', fingerprint: after };
  return { write: input.kind === 'progress' ? 'cost' : 'none', fingerprint: after };
}

function looksQuiet(input: EngineInput, output: StepOutput): boolean {
  const { events, jobs, replies } = output.effects;
  return (
    QUIET_INPUTS.has(input.kind) &&
    events.length === 0 &&
    jobs.length === 0 &&
    replies.every(({ reply }) => 'wait' in reply)
  );
}

/** Written steps between two measurements of the state's size. */
export const SIZE_SAMPLE_STEPS = 50;
/** Sizes worth a warning: a Durable Object value holds at most 2 MB. */
export const SIZE_WARNINGS_BYTES: readonly number[] = [1_000_000, 1_500_000];

/** The state's size as JSON (close to what storage holds; measured only now and then). */
export function stateBytes(state: EngineState): number {
  return new TextEncoder().encode(JSON.stringify(state)).byteLength;
}

/** How many of the warning sizes a state of `bytes` has reached. */
export function sizeLevel(bytes: number): number {
  return SIZE_WARNINGS_BYTES.filter((threshold) => bytes >= threshold).length;
}

/** A step could not be stored (its state too large, or storage failed): nothing of it was. */
export class StepWriteError extends Error {
  override readonly name = 'StepWriteError';
}
