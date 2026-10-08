/**
 * The fixture control plane for tests: an in-memory overlay and a clock the test moves.
 */
import type { ActionsClient } from '../actions-client';
import { actionsClient } from '../actions-client';
import type { ActionsActor } from '../actions-contract';
import { fakeControlPlane } from '../fake/fake-control-plane';
import type { FakeOverlay } from '../fake/fake-overlay';

export type TestActions = {
  readonly client: (actor?: ActionsActor) => ActionsClient;
  readonly overlay: () => FakeOverlay;
  readonly setNow: (ms: number) => void;
  readonly advance: (ms: number) => void;
};

export const REPO_ID = 'repo-1';
export const COOP: ActionsActor = { id: 'u1', handle: 'coop' };

export function testActions(startMs: number): TestActions {
  const state: { overlay: FakeOverlay; now: number } = { overlay: {}, now: startMs };
  const rpc = fakeControlPlane({
    store: {
      read: () => state.overlay,
      write: (next) => {
        state.overlay = next;
      },
    },
    nowMs: () => state.now,
  });
  return {
    client: (actor = COOP) => actionsClient(rpc, { actor, repoId: REPO_ID, mode: 'fixtures' }),
    overlay: () => state.overlay,
    setNow: (ms) => {
      state.now = ms;
    },
    advance: (ms) => {
      state.now += ms;
    },
  };
}
