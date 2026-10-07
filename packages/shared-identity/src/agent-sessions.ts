/**
 * The MCP Worker's RPC contract for the web app: the consent screen (`/connect`) and the
 * connected-agents list in Settings. The MCP Worker implements it (packages/mcp/src/index.ts);
 * the web app narrows its MCP service binding to it (wrangler types it as a plain Fetcher)
 * and validates every answer.
 */
import { z } from 'zod';

import { Scope } from './scopes';

/** The person deciding, as the web app's session knows them. */
export type ConsentUser = { readonly id: string; readonly handle: string };

/** What the consent page shows. Every string except the scopes came from the client. */
export const ConsentView = z.object({
  clientId: z.string(),
  clientName: z.string(),
  /** Set for a Client ID Metadata Document client: a domain the client controls. */
  clientDomain: z.string().nullable(),
  redirectHost: z.string(),
  redirectIsLoopback: z.boolean(),
  requestedScopes: z.array(Scope),
  grantableScopes: z.array(Scope),
});
export type ConsentView = z.infer<typeof ConsentView>;

export const AgentSession = z.object({
  grantId: z.string(),
  clientId: z.string(),
  clientName: z.string(),
  scopes: z.array(Scope),
  createdAt: z.number(),
  expiresAt: z.number().nullable(),
});
export type AgentSession = z.infer<typeof AgentSession>;

export const ConsentRedirect = z.object({ redirectTo: z.url() }).nullable();
export type ConsentRedirect = z.infer<typeof ConsentRedirect>;

export type AgentSessionsRpc = {
  consentRequest(id: string, user: ConsentUser): Promise<ConsentView | null>;
  approveConsent(
    id: string,
    user: ConsentUser,
    scopes: readonly string[],
    ip: string | null,
  ): Promise<ConsentRedirect>;
  denyConsent(id: string, user: ConsentUser, ip: string | null): Promise<ConsentRedirect>;
  agentSessions(userId: string): Promise<readonly AgentSession[]>;
  revokeAgentSession(userId: string, grantId: string, ip: string | null): Promise<boolean>;
};

const METHODS = [
  'consentRequest',
  'approveConsent',
  'denyConsent',
  'agentSessions',
  'revokeAgentSession',
] as const;

/** Whether a binding answers the contract (an RPC stub exposes every remote method). */
export function isAgentSessionsRpc(binding: unknown): binding is AgentSessionsRpc {
  if ((typeof binding !== 'object' && typeof binding !== 'function') || binding === null)
    return false;
  return METHODS.every((method) => typeof Reflect.get(binding, method) === 'function');
}
