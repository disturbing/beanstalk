/**
 * The composition root for data: which source answers for a run. Recorded runs come from
 * the bundled fixtures (optionally as of a race second); anything else is a live run behind
 * the GATEWAY binding.
 */
import type { RunId } from '@beanstalk/shared-race/ids';

import { isRecordedRun } from '../recorded/recorded-runs';
import { ForgeError } from '@beanstalk/shared-ask/forge/forge-errors';
import type { ForgeSource, RunListing } from '@beanstalk/shared-ask/forge/forge-source';
import { asGatewayBinding } from '@beanstalk/shared-ask/forge/gateway-rpc';
import { gatewaySource } from '@beanstalk/shared-ask/forge/gateway-source';
import { recordedSource } from './recorded-source';

/** A live listing must answer within this, or the runs page shows recorded runs only. */
const LIST_TIMEOUT_MS = 4000;

export type RunsListing = {
  readonly recorded: readonly RunListing[];
  readonly live: readonly RunListing[];
  /** Why live runs are missing, when they are. */
  readonly liveError: string | null;
};

export function forgeForRun(
  gateway: Fetcher,
  run: RunId,
  options: { readonly asOf?: number } = {},
): ForgeSource {
  if (isRecordedRun(run)) return recordedSource(options);
  const binding = asGatewayBinding(gateway);
  if (binding === undefined)
    throw new ForgeError('the GATEWAY binding has no RPC methods', 'unavailable');
  return gatewaySource(binding);
}

export async function listRuns(gateway: Fetcher): Promise<RunsListing> {
  const recorded = await recordedSource().listRuns();
  const binding = asGatewayBinding(gateway);
  if (binding === undefined) return { recorded, live: [], liveError: 'No gateway is bound.' };
  try {
    const live = await withTimeout(gatewaySource(binding).listRuns(), LIST_TIMEOUT_MS);
    return { recorded, live: live.filter((run) => !isRecordedRun(run.run)), liveError: null };
  } catch (error: unknown) {
    // The runs page still works without the gateway (local dev, an outage): it says why.
    const message = error instanceof Error ? error.message : String(error);
    return { recorded, live: [], liveError: `The gateway did not answer: ${message}` };
  }
}

function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
  return Promise.race([
    promise,
    new Promise<never>((_, reject) => {
      setTimeout(() => reject(new Error(`no answer within ${ms / 1000} s`)), ms);
    }),
  ]);
}
