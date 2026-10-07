/**
 * Deploy tokens through the GATEWAY binding (`DeployTokensRpc`), every answer validated. A
 * binding without the methods (an older gateway) reads as "unavailable".
 */
import { z } from 'zod';

import type {
  CreateDeployTokenInput,
  DeployTokenActor,
  DeployTokensRpc,
} from '@beanstalk/shared-race/deploy-tokens';
import { DeployTokenSummary, IssuedDeployToken } from '@beanstalk/shared-race/deploy-tokens';
import type { RpcResult } from '@beanstalk/shared-race/rpc';

import type { Outcome } from './registry-client';

export type DeployTokensClient = {
  create(
    actor: DeployTokenActor,
    repoId: string,
    input: CreateDeployTokenInput,
  ): Promise<Outcome<IssuedDeployToken>>;
  list(actor: DeployTokenActor, repoId: string): Promise<Outcome<readonly DeployTokenSummary[]>>;
  revoke(
    actor: DeployTokenActor,
    repoId: string,
    tokenId: string,
  ): Promise<Outcome<{ readonly revoked: boolean }>>;
};

const METHODS = [
  'createDeployToken',
  'listDeployTokens',
  'revokeDeployToken',
] as const satisfies readonly (keyof DeployTokensRpc)[];

export function deployTokensClient(binding: object): DeployTokensClient {
  const rpc = isDeployTokensRpc(binding) ? binding : null;
  const call = async <S extends z.ZodType>(
    schema: S,
    use: (tokens: DeployTokensRpc) => Promise<RpcResult<unknown>>,
  ): Promise<Outcome<z.infer<S>>> => {
    if (rpc === null)
      return {
        ok: false,
        error: {
          code: 'unavailable',
          message: 'Deploy tokens are not available on this deployment.',
        },
      };
    const result = await use(rpc);
    if (!result.ok)
      return { ok: false, error: { code: result.error.code, message: result.error.message } };
    return { ok: true, value: schema.parse(result.value) };
  };
  return {
    create: (actor, repoId, input) =>
      call(IssuedDeployToken, (r) => r.createDeployToken(actor, repoId, input)),
    list: (actor, repoId) =>
      call(z.array(DeployTokenSummary), (r) => r.listDeployTokens(actor, repoId)),
    revoke: (actor, repoId, tokenId) =>
      call(z.object({ revoked: z.boolean() }), (r) => r.revokeDeployToken(actor, repoId, tokenId)),
  };
}

function isDeployTokensRpc(binding: object): binding is DeployTokensRpc {
  return METHODS.every((method) => typeof Reflect.get(binding, method) === 'function');
}
