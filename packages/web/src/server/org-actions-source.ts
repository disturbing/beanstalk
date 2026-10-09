/**
 * The org half of Actions settings: the gateway's `ActionsEntriesRpc` on the `ACTIONS` binding
 * when `ACTIONS_SOURCE` is `gateway` and the gateway has the methods; otherwise null (the
 * fixtures have no orgs). Server-only.
 */
import { env } from 'cloudflare:workers';

import { asGatewayEntries } from '../actions/gateway-actions';
import type { OrgActionsClient } from '../actions/org-actions-client';
import { orgActionsClient } from '../actions/org-actions-client';

export function orgActionsFor(scope: {
  readonly viewer: string;
  readonly orgHandle: string;
}): OrgActionsClient | null {
  if (env.ACTIONS_SOURCE !== 'gateway') return null;
  const rpc = asGatewayEntries(env.ACTIONS);
  return rpc === null ? null : orgActionsClient(rpc, scope);
}
