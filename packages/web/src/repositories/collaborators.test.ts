import { describe, expect, it } from 'vitest';

import type { RepositoryAction } from '@gitstalk/shared-race/collaborators';
import type { RpcResult } from '@gitstalk/shared-race/rpc';

import { collaboratorsClient } from './collaborators-client';
import { engineVerdict, mayViewEngine } from './engine-guard';

/**
 * The web's side of collaborators: answers from the gateway are validated, and the run routes
 * ask the gateway before showing an engine (a race stays open; a repository follows
 * `mayUseEngine`). The rule itself is tested in the gateway's matrix.
 */
const RECORD = {
  id: 'r1',
  owner: { id: 'u_coop', handle: 'coop' },
  name: 'greeter',
  description: '',
  visibility: 'private',
  origin: { kind: 'empty' },
  artifacts_repo: 'repo-r1',
  engine_id: 'r1engine0001',
  default_branch: 'stalk',
  created_at: '2026-10-07T00:00:00.000Z',
  updated_at: '2026-10-07T00:00:00.000Z',
} as const;

/** A gateway that knows one private repository: coop owns it, dana reads it. */
function fakeGateway(): object {
  const roles: Readonly<Record<string, string>> = { u_coop: 'owner', u_dana: 'read' };
  const engineAccess = async (
    engineId: string,
    viewer: string | null,
    action: RepositoryAction,
  ): Promise<RpcResult<unknown>> => {
    if (engineId !== RECORD.engine_id) return { ok: true, value: { repository: null } };
    const role = viewer === null ? undefined : roles[viewer];
    if (role === undefined)
      return { ok: false, error: { code: 'not_found', status: 404, message: 'not found' } };
    if (action !== 'read' && role !== 'owner')
      return { ok: false, error: { code: 'forbidden', status: 403, message: 'needs maintain' } };
    return { ok: true, value: { repository: { ...RECORD, viewer_role: role } } };
  };
  const unused = async (): Promise<RpcResult<unknown>> => ({ ok: true, value: [] });
  return {
    engineAccess,
    repositoryPeople: unused,
    inviteCollaborator: unused,
    cancelInvitation: unused,
    setCollaboratorRole: unused,
    removeCollaborator: unused,
    myInvitations: unused,
    answerInvitation: unused,
    sharedRepositories: async () => ({ ok: true, value: [{ ...RECORD, viewer_role: 'boss' }] }),
  };
}

describe('engine guard', () => {
  it('keeps races open to everyone', async () => {
    expect(await mayViewEngine(fakeGateway(), 'racerun00001', null)).toBe(true);
    expect(
      await engineVerdict(fakeGateway(), { run: 'racerun00001', viewer: null, action: 'decide' }),
    ).toEqual({
      kind: 'race',
    });
  });

  it("shows a repository's engine only to people who may read it", async () => {
    expect(await mayViewEngine(fakeGateway(), RECORD.engine_id, 'u_dana')).toBe(true);
    expect(await mayViewEngine(fakeGateway(), RECORD.engine_id, 'u_erin')).toBe(false);
    expect(await mayViewEngine(fakeGateway(), RECORD.engine_id, null)).toBe(false);
  });

  it('tells a reader apart from a decider', async () => {
    const asDana = await engineVerdict(fakeGateway(), {
      run: RECORD.engine_id,
      viewer: 'u_dana',
      action: 'decide',
    });
    expect(asDana).toMatchObject({ kind: 'refused', code: 'forbidden' });
    const asCoop = await engineVerdict(fakeGateway(), {
      run: RECORD.engine_id,
      viewer: 'u_coop',
      action: 'decide',
    });
    expect(asCoop).toMatchObject({ kind: 'repository', repository: { viewer_role: 'owner' } });
  });

  it('treats an older gateway without the methods as races only', async () => {
    expect(await mayViewEngine({}, RECORD.engine_id, null)).toBe(true);
    expect(await collaboratorsClient({}).invitations('u_coop')).toMatchObject({
      ok: false,
      error: { code: 'unavailable' },
    });
  });

  it('refuses answers that do not match the shape', async () => {
    await expect(collaboratorsClient(fakeGateway()).shared('u_coop')).rejects.toThrow();
  });
});
