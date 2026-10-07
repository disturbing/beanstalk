/**
 * Deploy tokens (`bsd_…`): git credentials for one repository, read or read and write, made by
 * its owner for CI and other machines (`docs/claude-opus/19-accounts-and-auth.md`, "Connecting
 * git"). The gateway stores and checks them (its FORGE database, beside the registry); the web
 * app makes and lists them over this RPC.
 */
import { z } from 'zod';

import type { RpcResult } from './rpc';

/** Expiry choices; there is no "never". */
export const DEPLOY_TOKEN_DAYS = [7, 30, 90, 365] as const;

export const DeployTokenAccess = z.enum(['read', 'write']);
export type DeployTokenAccess = z.infer<typeof DeployTokenAccess>;

export const CreateDeployTokenInput = z.strictObject({
  name: z.string().trim().min(1, 'Name the token (what uses it).').max(60),
  access: DeployTokenAccess,
  days: z.coerce
    .number()
    .int()
    .refine((days) => DEPLOY_TOKEN_DAYS.some((allowed) => allowed === days), 'Pick an expiry.'),
});
export type CreateDeployTokenInput = z.infer<typeof CreateDeployTokenInput>;

export const DeployTokenSummary = z.object({
  id: z.string(),
  name: z.string(),
  access: DeployTokenAccess,
  hint: z.string(),
  createdByHandle: z.string(),
  createdAt: z.number(),
  expiresAt: z.number(),
  lastUsedAt: z.number().nullable(),
  /** Coarse: the country and the client of the last use ("US · git/2.53.0"). */
  lastUsedFrom: z.string().nullable(),
  revokedAt: z.number().nullable(),
});
export type DeployTokenSummary = z.infer<typeof DeployTokenSummary>;

export const IssuedDeployToken = z.object({ token: z.string(), summary: DeployTokenSummary });
export type IssuedDeployToken = z.infer<typeof IssuedDeployToken>;

/** The person acting: only a repository's owner manages its deploy tokens. */
export type DeployTokenActor = { readonly id: string; readonly handle: string };

export type DeployTokensRpc = {
  createDeployToken(
    actor: DeployTokenActor,
    repoId: string,
    input: CreateDeployTokenInput,
  ): Promise<RpcResult<IssuedDeployToken>>;
  /** Live tokens, newest first (expired and revoked ones stay listed for a week). */
  listDeployTokens(
    actor: DeployTokenActor,
    repoId: string,
  ): Promise<RpcResult<readonly DeployTokenSummary[]>>;
  revokeDeployToken(
    actor: DeployTokenActor,
    repoId: string,
    tokenId: string,
  ): Promise<RpcResult<{ readonly revoked: boolean }>>;
};
