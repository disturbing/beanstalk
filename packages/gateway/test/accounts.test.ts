import { env } from 'cloudflare:test';
import { exports } from 'cloudflare:workers';
import { describe, expect, it } from 'vitest';

import { insertUser } from '@gitstalk/shared-identity/users';
import type { RepositoryRecord } from '@gitstalk/shared-race/repos';

import { value } from './agent-helpers';

/**
 * `AccountsRpc` (docs/claude-opus/29-settings.md) and the repository profile fields, through
 * the gateway's default entrypoint as the web app's binding calls it.
 */
const gateway = exports.default;

let people = 0;

async function person(): Promise<{ id: string; handle: string }> {
  people += 1;
  const user = {
    id: `u_acct_${people}_${crypto.randomUUID().slice(0, 6)}`,
    handle: `acct${people}-${crypto.randomUUID().slice(0, 4)}`,
  };
  await insertUser(env, { ...user, email: null }, Date.now()).run();
  return user;
}

async function repository(
  owner: { id: string; handle: string },
  name: string,
): Promise<RepositoryRecord> {
  return value(
    await gateway.createRepository(owner, {
      name,
      visibility: 'private',
      start: { kind: 'empty' },
    }),
  );
}

describe('renameOwner', () => {
  it('moves the owner’s repositories and their memberships to the new handle', async () => {
    const coop = await person();
    const dana = await person();
    const shop = await repository(coop, 'shop');
    const danas = await repository(dana, 'notes');
    const pending = await person();
    value(
      await gateway.inviteCollaborator(coop, shop.id, { handle: pending.handle, role: 'read' }),
    );
    const invitation = value(
      await gateway.inviteCollaborator(dana, danas.id, { handle: coop.handle, role: 'read' }),
    );
    value(await gateway.answerInvitation(coop, invitation.id, 'accept'));

    expect(value(await gateway.renameOwner(coop.id, 'coop-renamed'))).toEqual({ repositories: 1 });
    const moved = value(await gateway.getRepository('coop-renamed', 'shop', coop.id));
    expect(moved).toMatchObject({ id: shop.id, owner: { id: coop.id, handle: 'coop-renamed' } });
    expect(await gateway.getRepository(coop.handle, 'shop', coop.id)).toMatchObject({ ok: false });
    const people = value(await gateway.repositoryPeople(danas.id, dana.id));
    expect(people.collaborators.map((entry) => entry.handle)).toContain('coop-renamed');
    // Someone else's repository with the same name is untouched.
    expect(value(await gateway.getRepository(dana.handle, 'notes', dana.id)).id).toBe(danas.id);
  });

  it('refuses a handle the URL cannot carry', async () => {
    const coop = await person();
    expect(await gateway.renameOwner(coop.id, 'has space')).toMatchObject({
      ok: false,
      error: { code: 'invalid_request' },
    });
  });
});

describe('closeAccount', () => {
  it('deletes the person’s repositories, active and archived, and their memberships elsewhere', async () => {
    const coop = await person();
    const dana = await person();
    const shop = await repository(coop, 'shop');
    const old = await repository(coop, 'old');
    value(await gateway.archiveRepository(coop.id, old.id, 'archived'));
    const danas = await repository(dana, 'notes');
    const invitation = value(
      await gateway.inviteCollaborator(dana, danas.id, { handle: coop.handle, role: 'write' }),
    );
    value(await gateway.answerInvitation(coop, invitation.id, 'accept'));

    const closed = value(await gateway.closeAccount(coop.id));
    expect([...closed.deletedRepositories].toSorted()).toEqual([shop.id, old.id].toSorted());
    expect(value(await gateway.listRepositories(coop.id, coop.id))).toEqual([]);
    expect(value(await gateway.listRepositories(coop.id, coop.id, 'archived'))).toEqual([]);
    const listed = await env.REPOS.list();
    const names = listed.repos.map((entry) => entry.name);
    expect(names).not.toContain(shop.artifacts_repo);
    expect(names).not.toContain(old.artifacts_repo);
    // Dana's repository stays; coop is no longer on it.
    const people = value(await gateway.repositoryPeople(danas.id, dana.id));
    expect(people.collaborators.map((entry) => entry.user_id)).not.toContain(coop.id);
    expect(value(await gateway.sharedRepositories(coop.id))).toEqual([]);
  });
});

describe('repository profile', () => {
  it('saves a website, topics and the repository’s own social image', async () => {
    const coop = await person();
    const shop = await repository(coop, 'shop');
    const key = `repos/${shop.id}/social/${'a'.repeat(32)}`;
    const updated = value(
      await gateway.updateRepository(coop.id, shop.id, {
        website: 'https://shop.example',
        topics: ['TypeScript', 'workers', 'typescript'],
        social_image_key: key,
      }),
    );
    expect(updated).toMatchObject({
      website: 'https://shop.example',
      topics: ['typescript', 'workers'],
      social_image_key: key,
    });
    const read = value(await gateway.getRepository(coop.handle, 'shop', coop.id));
    expect(read).toMatchObject({ topics: ['typescript', 'workers'], social_image_key: key });
    const cleared = value(
      await gateway.updateRepository(coop.id, shop.id, { social_image_key: null, website: '' }),
    );
    expect(cleared).toMatchObject({
      social_image_key: null,
      website: '',
      topics: ['typescript', 'workers'],
    });
  });

  it('refuses another repository’s image, bad topics and non-web websites', async () => {
    const coop = await person();
    const shop = await repository(coop, 'shop');
    const other = await repository(coop, 'other');
    const refusals = await Promise.all([
      gateway.updateRepository(coop.id, shop.id, {
        social_image_key: `repos/${other.id}/social/${'b'.repeat(32)}`,
      }),
      gateway.updateRepository(coop.id, shop.id, { topics: ['has space'] }),
      gateway.updateRepository(coop.id, shop.id, {
        topics: Array.from({ length: 21 }, (_, index) => `t${index}`),
      }),
      gateway.updateRepository(coop.id, shop.id, { website: 'javascript:alert(1)' }),
    ]);
    for (const refusal of refusals)
      expect(refusal).toMatchObject({ ok: false, error: { code: 'invalid_request' } });
  });
});
