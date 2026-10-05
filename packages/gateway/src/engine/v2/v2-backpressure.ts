/**
 * v2.3's backpressure on the sprout (`docs/claude-opus/11` and the v2.2 race post-mortem):
 *
 * - The sprout window (`window: aimd`): at most W commits sit above the last validated sprout
 *   commit, so a burst of green beans cannot outrun validation, and every bisection stays
 *   within W. A green bean beyond the window waits, oldest first (`window.wait`). W starts at
 *   `window_start`, grows by `window_growth` per green validation (to `window_max`) and halves
 *   on a red sprout (to `window_min`), once per red episode: a red whose failures an open
 *   ticket already covers does not halve it again.
 * - The re-check meter (`recheck: sampled`): re-check every overlap until 5 re-checks in a
 *   row are green, then skip all but 1 in 4. A red re-check or a red sprout starts it
 *   re-checking again. It measures the re-checks it skips, not first checks on a calm base.
 */
import type { TaskId } from '@beanstalk/shared-race/ids';

import { emit } from '../context';
import { unvalidatedCount } from './v2-sprout';
import type { LandingStep, V2State, V2Step } from './v2-state';
import { activeTickets } from './v2-tickets';

const SKIP_AFTER_GREEN_RECHECKS = 5;
const SAMPLE_ONE_IN = 4;

/** Steps of a bean that already holds (or waits for) a place on the sprout. */
const INBOUND: ReadonlySet<LandingStep['kind']> = new Set([
  'queued-land',
  'queued-locked',
  'resquash',
  'hunks',
  'publish',
  'locked-squash',
]);

export function isWindowOn(step: V2Step): boolean {
  return step.ctx.env.config.window === 'aimd';
}

/** Beans on their way onto the sprout: queued for the turn, or landing in it. */
function inboundCount(state: V2State): number {
  return Object.values(state.landings).filter(
    (flow) => INBOUND.has(flow.step.kind) || (flow.step.kind === 'check' && flow.step.isInTurn),
  ).length;
}

/** Landings the window still admits: its size less the commits above the stalk and the beans on their way in. */
export function windowRoom(state: V2State): number {
  return state.window.size - unvalidatedCount(state) - inboundCount(state);
}

/**
 * Whether one more bean may head for the sprout (`isCounted`: the bean is already counted as
 * on its way). When nothing can make room, one bean at a time goes through.
 */
export function windowAdmits(state: V2State, isCounted: boolean): boolean {
  const own = isCounted ? 1 : 0;
  if (windowRoom(state) + own > 0) return true;
  return isWindowStuck(state) && inboundCount(state) === own;
}

/**
 * Nothing can make room: no validation runs or waits for its re-run, and nothing repairs
 * the sprout. A bean is then let through, so a stuck sprout never stalls the race.
 */
export function isWindowStuck(state: V2State): boolean {
  return (
    state.validating.length === 0 &&
    Object.keys(state.confirming).length === 0 &&
    !isSproutRepairing(state)
  );
}

/** A validation runs or waits for its re-run, or a red one is being bisected or reverted. */
export function isSproutRepairing(state: V2State): boolean {
  return (
    state.validating.length > 0 ||
    Object.keys(state.confirming).length > 0 ||
    Object.keys(state.bisects).length > 0 ||
    Object.keys(state.reverts).length > 0 ||
    activeTickets(state).length > 0
  );
}

/** A green bean found the window full: it waits, oldest first. */
export function logWindowWait(step: V2Step, task: TaskId): void {
  const { state } = step;
  state.window.waiting.push(task);
  state.stats.window_waits += 1;
  emit(step.ctx, 'window.wait', {
    task,
    window: state.window.size,
    unvalidated: unvalidatedCount(state),
  });
}

/** A validation of `idx` was green: the window grows by `window_growth` (to `window_max`). */
export function onSproutGreen(step: V2Step, idx: number): void {
  const { window_growth: growth, window_max: max } = step.ctx.env.config;
  resize(step, { size: Math.min(max, step.state.window.size + growth), idx });
}

/** The sprout is red at `idx` (a red validation, or an early ticket): halve the window, re-check again. */
export function onSproutRed(step: V2Step, idx: number): void {
  const meter = step.state.recheckMeter;
  meter.mode = 'checking';
  meter.greenStreak = 0;
  const floor = step.ctx.env.config.window_min;
  resize(step, { size: Math.max(floor, Math.floor(step.state.window.size / 2)), idx });
}

function resize(step: V2Step, next: { size: number; idx: number }): void {
  const window = step.state.window;
  const previous = window.size;
  if (!isWindowOn(step) || next.size === previous) return;
  window.size = next.size;
  emit(step.ctx, 'window.resize', {
    window: next.size,
    previous,
    reason: next.size > previous ? 'green' : 'red',
    trunk_idx: next.idx,
  });
}

/** `recheck: sampled` on an overlap: re-check while checking; skipping, re-check 1 in 4. */
export function sampledRecheck(state: V2State): 'recheck' | 'skip' {
  const meter = state.recheckMeter;
  if (meter.mode === 'checking') return 'recheck';
  meter.skips += 1;
  if (meter.skips % SAMPLE_ONE_IN !== 0) return 'skip';
  state.stats.recheck_samples += 1;
  return 'recheck';
}

/** A re-check's outcome: 5 greens in a row start skipping, a red starts re-checking again. */
export function recordRecheck(state: V2State, isGreen: boolean): void {
  const meter = state.recheckMeter;
  if (!isGreen) {
    meter.mode = 'checking';
    meter.greenStreak = 0;
    return;
  }
  meter.greenStreak += 1;
  if (meter.greenStreak >= SKIP_AFTER_GREEN_RECHECKS) meter.mode = 'skipping';
}
