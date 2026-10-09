import { describe, expect, it } from 'vitest';

import type { DeletionPorts, HandlePorts, PicturePorts } from './account-flows';
import {
  changeHandleFlow,
  deleteAccountFlow,
  removePictureFlow,
  replacePictureFlow,
} from './account-flows';

const actor = { id: 'u_1', handle: 'coop', ip: null, now: 1_000 };

function handlePorts(options: { readonly gatewayFails?: boolean } = {}) {
  const calls: string[] = [];
  const ports: HandlePorts = {
    changeHandle: ({ handle }) => {
      calls.push(`change ${handle}`);
      return Promise.resolve(
        handle === 'taken'
          ? { ok: false, reason: 'taken', message: '@taken is taken.' }
          : { ok: true, from: 'coop', to: handle },
      );
    },
    revertHandleChange: ({ from, to, changedAt }) => {
      calls.push(`revert ${to} -> ${from} (${String(changedAt)})`);
      return Promise.resolve();
    },
    previousChangeAt: () => Promise.resolve(42),
    renameOwner: (_userId, handle) => {
      calls.push(`gateway ${handle}`);
      return Promise.resolve(
        options.gatewayFails === true
          ? { ok: false, error: { message: 'registry down' } }
          : { ok: true, value: { repositories: 2 } },
      );
    },
  };
  return { ports, calls };
}

describe('changeHandleFlow', () => {
  it('changes accounts, then moves the repositories', async () => {
    const { ports, calls } = handlePorts();
    const result = await changeHandleFlow(actor, 'cooper', ports);
    expect(result).toMatchObject({ handle: 'cooper', error: null });
    expect(result.saved).toContain('@coop keep working');
    expect(calls).toEqual(['change cooper', 'gateway cooper']);
  });

  it('shows the refusal and never asks the registry', async () => {
    const { ports, calls } = handlePorts();
    expect(await changeHandleFlow(actor, 'taken', ports)).toMatchObject({
      error: '@taken is taken.',
      handle: null,
    });
    expect(calls).toEqual(['change taken']);
  });

  it('undoes the change, cooldown included, when the repositories cannot move', async () => {
    const { ports, calls } = handlePorts({ gatewayFails: true });
    const result = await changeHandleFlow(actor, 'cooper', ports);
    expect(result.error).toContain('nothing changed');
    expect(calls).toEqual(['change cooper', 'gateway cooper', 'revert cooper -> coop (42)']);
  });
});

function picturePorts(previous: string | null) {
  const calls: string[] = [];
  const ports: PicturePorts = {
    upload: (kind, ownerId, file) => {
      calls.push(`upload ${kind} ${ownerId} ${file.size}`);
      return Promise.resolve(
        file.size > 10
          ? { ok: false, error: { code: 'too_large', message: 'Images can be up to 2 MB.' } }
          : {
              ok: true,
              image: {
                key: 'users/u_1/avatar/new',
                url: '/media/x',
                width: 1,
                height: 1,
                normalized: true,
              },
            },
      );
    },
    save: (key) => {
      calls.push(`save ${String(key)}`);
      return Promise.resolve({ previous });
    },
    prune: (_kind, _owner, keep) => {
      calls.push(`prune keep ${String(keep)}`);
      return Promise.resolve(1);
    },
  };
  return { ports, calls };
}

describe('pictures', () => {
  const target = { kind: 'user', ownerId: 'u_1' } as const;

  it('uploads, saves the key, then deletes the old picture', async () => {
    const { ports, calls } = picturePorts('users/u_1/avatar/old');
    expect(await replacePictureFlow(target, new Blob(['png']), ports)).toMatchObject({
      saved: 'Picture updated.',
      key: 'users/u_1/avatar/new',
    });
    expect(calls).toEqual([
      'upload user u_1 3',
      'save users/u_1/avatar/new',
      'prune keep users/u_1/avatar/new',
    ]);
  });

  it('keeps the old picture when the upload is refused, and wants a file', async () => {
    const { ports, calls } = picturePorts('users/u_1/avatar/old');
    expect(await replacePictureFlow(target, new Blob(['x'.repeat(20)]), ports)).toMatchObject({
      error: 'Images can be up to 2 MB.',
    });
    expect(await replacePictureFlow(target, null, ports)).toMatchObject({
      error: 'Choose an image file.',
    });
    expect(await replacePictureFlow(target, 'not a file', ports)).toMatchObject({
      error: 'Choose an image file.',
    });
    expect(calls).toEqual(['upload user u_1 20']);
  });

  it('removes the picture and its objects', async () => {
    const { ports, calls } = picturePorts('users/u_1/avatar/old');
    expect(await removePictureFlow(target, ports)).toMatchObject({ saved: 'Picture removed.' });
    expect(calls).toEqual(['save null', 'prune keep null']);
  });
});

function deletionPorts(
  options: { readonly orgs?: AccountFactsOrgs; readonly gatewayFails?: boolean } = {},
) {
  const calls: string[] = [];
  const ports: DeletionPorts = {
    facts: () =>
      Promise.resolve({
        handle: 'coop',
        organizations: options.orgs ?? [],
        repositories: ['shop'],
      }),
    closeAccount: () => {
      calls.push('close');
      return Promise.resolve(
        options.gatewayFails === true
          ? { ok: false, error: { message: 'registry down' } }
          : { ok: true, value: { deletedRepositories: ['r1', 'r2'] } },
      );
    },
    disconnectAgents: () => {
      calls.push('agents');
      return Promise.resolve();
    },
    deleteMedia: (kind, ownerId) => {
      calls.push(`media ${kind} ${ownerId}`);
      return Promise.resolve(0);
    },
    deleteUser: () => {
      calls.push('user');
      return Promise.resolve(true);
    },
  };
  return { ports, calls };
}
type AccountFactsOrgs = readonly { readonly handle: string; readonly otherOwners: number }[];

describe('deleteAccountFlow', () => {
  it('wants the handle typed', async () => {
    const { ports, calls } = deletionPorts();
    expect(await deleteAccountFlow(actor, 'cop', ports)).toMatchObject({
      kind: 'refused',
      state: { error: 'Type coop to confirm.' },
    });
    expect(calls).toEqual([]);
  });

  it('refuses the sole owner of an organisation, naming it', async () => {
    const { ports, calls } = deletionPorts({
      orgs: [
        { handle: 'acme', otherOwners: 0 },
        { handle: 'beta', otherOwners: 3 },
      ],
    });
    const outcome = await deleteAccountFlow(actor, '@coop', ports);
    expect(outcome).toMatchObject({ kind: 'refused' });
    expect(outcome.kind === 'refused' && outcome.state.error).toBe(
      'You are the only owner of @acme. Add another owner or delete it first.',
    );
    expect(calls).toEqual([]);
  });

  it('deletes repositories, agents, pictures, then the person', async () => {
    const { ports, calls } = deletionPorts();
    expect(await deleteAccountFlow(actor, 'coop', ports)).toEqual({ kind: 'deleted' });
    expect(calls).toEqual([
      'close',
      'agents',
      'media user u_1',
      'media repo r1',
      'media repo r2',
      'user',
    ]);
  });

  it('stops before touching the account when the registry fails', async () => {
    const { ports, calls } = deletionPorts({ gatewayFails: true });
    const outcome = await deleteAccountFlow(actor, 'coop', ports);
    expect(outcome.kind === 'refused' && outcome.state.error).toContain('Nothing else changed');
    expect(calls).toEqual(['close']);
  });
});
