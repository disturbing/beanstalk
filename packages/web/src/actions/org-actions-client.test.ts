import { describe, expect, it } from 'vitest';

import type { ActionsEntriesRpc } from '@gitstalk/shared-race/actions-secrets';
import type { ActionsRpc } from '@gitstalk/shared-race/actions';
import type { RpcResult } from '@gitstalk/shared-race/rpc';

import { asGatewayEntries, gatewayActionsClient } from './gateway-actions';
import { orgActionsClient } from './org-actions-client';

const ORG_SETTINGS = {
  org: { id: 'o1', handle: 'acme' },
  canManage: true,
  secrets: [
    {
      name: 'DEPLOY',
      access: { kind: 'selected', repoIds: ['r1'] },
      prelandAllowed: false,
      updatedAt: '2026-10-09T00:00:00Z',
      updatedBy: 'ada',
    },
  ],
  variables: [
    {
      name: 'REGION',
      value: 'eu',
      access: { kind: 'all' },
      updatedAt: '2026-10-09T00:00:00Z',
      updatedBy: 'ada',
    },
  ],
  repositories: [{ id: 'r1', name: 'app', visibility: 'private' }],
  audit: [],
};

const REPO_ENTRIES = {
  canManage: false,
  orgHandle: 'acme',
  secrets: [
    {
      name: 'DEPLOY',
      prelandAllowed: false,
      updatedAt: 'x',
      updatedBy: 'ada',
      source: { kind: 'organization', orgHandle: 'acme' },
      overridden: false,
    },
  ],
  variables: [],
};

function entriesRpc(overrides: Partial<Record<keyof ActionsEntriesRpc, unknown>> = {}) {
  const ok = (value: unknown): Promise<RpcResult<never>> =>
    Promise.resolve({ ok: true, value: value as never });
  const rpc: Record<string, unknown> = {
    repoActionsEntries: () => ok(REPO_ENTRIES),
    putVariable: () => ok({ name: 'A', value: 'b', updatedAt: 'x', updatedBy: 'y' }),
    deleteVariable: () => ok({ deleted: true }),
    orgActionsSettings: () => ok(ORG_SETTINGS),
    putOrgSecret: () => ok(ORG_SETTINGS.secrets[0]),
    deleteOrgSecret: () => ok({ deleted: true }),
    putOrgVariable: () => ok(ORG_SETTINGS.variables[0]),
    deleteOrgVariable: () => ok({ deleted: true }),
    ...overrides,
  };
  return asGatewayEntries(rpc);
}

describe('org secrets and variables in the web', () => {
  it('recognises a gateway with the entries methods, and not one without', () => {
    expect(entriesRpc()).not.toBeNull();
    expect(asGatewayEntries({ listSecrets: () => null })).toBeNull();
  });

  it('reads org settings as names and policies, validated', async () => {
    const rpc = entriesRpc();
    if (rpc === null) throw new Error('no rpc');
    const settings = await orgActionsClient(rpc, { viewer: 'u1', orgHandle: 'acme' }).settings();
    expect(settings).toMatchObject({
      ok: true,
      value: { canManage: true, secrets: [{ name: 'DEPLOY' }], variables: [{ value: 'eu' }] },
    });
  });

  it('says so when the gateway answers in a shape the page does not know', async () => {
    const rpc = entriesRpc({
      orgActionsSettings: () => Promise.resolve({ ok: true, value: { org: 'nope' } }),
    });
    if (rpc === null) throw new Error('no rpc');
    const settings = await orgActionsClient(rpc, { viewer: 'u1', orgHandle: 'acme' }).settings();
    expect(settings).toMatchObject({ ok: false, error: { code: 'upstream_failed' } });
  });

  it('passes the gateway’s refusal through (a member saving a secret)', async () => {
    const rpc = entriesRpc({
      putOrgSecret: () =>
        Promise.resolve({
          ok: false,
          error: { code: 'forbidden', status: 403, message: 'org owners and admins manage' },
        }),
    });
    if (rpc === null) throw new Error('no rpc');
    const saved = await orgActionsClient(rpc, { viewer: 'u1', orgHandle: 'acme' }).putSecret({
      name: 'X',
      value: 'v',
      access: { kind: 'all' },
      prelandAllowed: false,
    });
    expect(saved).toMatchObject({ ok: false, error: { code: 'forbidden' } });
  });

  it('shows a repository its inherited org secrets with their source, or says an older gateway has none', async () => {
    const actions = {} as unknown as ActionsRpc;
    const scope = { actor: { id: 'u1', handle: 'coop' }, repoId: 'r1', openSocket: null };
    const withEntries = gatewayActionsClient(actions, { ...scope, entries: entriesRpc() });
    expect(await withEntries.entries()).toMatchObject({
      ok: true,
      value: {
        orgHandle: 'acme',
        secrets: [{ name: 'DEPLOY', source: { kind: 'organization', orgHandle: 'acme' } }],
      },
    });
    const older = gatewayActionsClient(actions, { ...scope, entries: null });
    expect(await older.entries()).toMatchObject({ ok: false, error: { code: 'not_configured' } });
  });
});
