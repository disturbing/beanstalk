/**
 * The single-writer turn (the harness's committer lock): landings, the locked pre-land
 * fallback and reverts move the sprout one at a time, first come first served.
 */
import type { TurnHolder, V2State, V2Step } from './v2-state';

/** Takes the turn now if it is free, else queues for it; the owner continues on `granted`. */
export function requestTurn(step: V2Step, holder: TurnHolder): void {
  const turn = step.state.turn;
  if (turn.holder !== null || turn.queue.length > 0) {
    turn.queue.push(holder);
    return;
  }
  turn.holder = holder;
  step.flow.granted(holder);
}

/** Gives the turn up; the next in line gets it at once. */
export function releaseTurn(step: V2Step): void {
  const turn = step.state.turn;
  turn.holder = null;
  const next = turn.queue.shift();
  if (next === undefined) return;
  turn.holder = next;
  step.flow.granted(next);
}

export function isTurnIdle(state: V2State): boolean {
  return state.turn.holder === null && state.turn.queue.length === 0;
}
