/**
 * Org Settings → Secrets and variables: the gateway's `ActionsEntriesRpc` (on its `Actions`
 * entrypoint) scoped to a person and an org, every answer validated against the pages' model.
 * The gateway decides who may read (org members) and manage (owners and admins); nothing here
 * ever receives a secret value.
 */
import { z } from 'zod';

import type { ActionsEntriesRpc } from '@beanstalk/shared-race/actions-secrets';

import type { Outcome } from '../repositories/registry-client';
import type { PutOrgSecretInput, PutOrgVariableInput } from './actions-contract';
import { OrgSecret, OrgSettings, OrgVariable } from './actions-contract';
import { parsed, settle } from './gateway-actions';

export type OrgActionsClient = {
  settings(): Promise<Outcome<OrgSettings>>;
  putSecret(input: PutOrgSecretInput): Promise<Outcome<OrgSecret>>;
  deleteSecret(name: string): Promise<Outcome<{ readonly deleted: boolean }>>;
  putVariable(input: PutOrgVariableInput): Promise<Outcome<OrgVariable>>;
  deleteVariable(name: string): Promise<Outcome<{ readonly deleted: boolean }>>;
};

const Deleted = z.object({ deleted: z.boolean() });

export function orgActionsClient(
  rpc: ActionsEntriesRpc,
  scope: { readonly viewer: string; readonly orgHandle: string },
): OrgActionsClient {
  const { viewer, orgHandle } = scope;
  const validated = async <T>(
    schema: { safeParse(value: unknown): { success: true; data: T } | { success: false } },
    pending: Promise<Awaited<ReturnType<typeof settle<unknown>>>>,
  ): Promise<Outcome<T>> => {
    const result = await pending;
    return result.ok ? parsed(schema, result.value) : result;
  };
  return {
    settings: () => validated(OrgSettings, settle(rpc.orgActionsSettings(viewer, orgHandle))),
    putSecret: (input) => validated(OrgSecret, settle(rpc.putOrgSecret(viewer, orgHandle, input))),
    deleteSecret: (name) =>
      validated(Deleted, settle(rpc.deleteOrgSecret(viewer, orgHandle, name))),
    putVariable: (input) =>
      validated(OrgVariable, settle(rpc.putOrgVariable(viewer, orgHandle, input))),
    deleteVariable: (name) =>
      validated(Deleted, settle(rpc.deleteOrgVariable(viewer, orgHandle, name))),
  };
}
