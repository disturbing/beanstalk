import { env } from 'cloudflare:test';
import { describe, expect, it } from 'vitest';

import { createOrg, deleteOrg, updateOrg } from '../src/org-admin';
import { listOrgAudit } from '../src/org-audit';
import {
  answerOrgInvitation,
  cancelOrgInvitation,
  inviteToOrg,
  orgInvitationsFor,
  orgMembers,
  pendingOrgInvitations,
  removeOrgMember,
  setOrgMemberRole,
} from '../src/org-members';
import type { OrgRole } from '../src/orgs';
import {
  DEFAULT_BASE_PERMISSION,
  findOrgByHandle,
  mayCreateRepository,
  mayInOrg,
  orgRole,
  orgStanding,
  orgsOf,
  ownerByHandle,
  ownerOf,
} from '../src/orgs';
import { insertUser, isHandleTaken, isUniqueViolation } from '../src/users';
import { T0 } from './helpers';

type Person = { readonly id: string; readonly handle: string };

describe('migration 0006: base permission none', () => {
  it('moves orgs on the old default (read) to none and leaves the others', async () => {
    const insert = (id: string, base: string) =>
      env.IDENTITY_DB.prepare(
        `INSERT INTO orgs (id, handle, name, base_permission, created_by, created_at, updated_at)
         VALUES (?, ?, ?, ?, 'u_x', 0, 0)`,
      ).bind(id, id.replace('org_', 'mg-'), id, base);
    await env.IDENTITY_DB.batch([
      insert('org_mgread', 'read'),
      insert('org_mgwrite', 'write'),
      insert('org_mgnone', 'none'),
    ]);
    const migrations: unknown = Reflect.get(env, 'TEST_MIGRATIONS');
    const migration = (Array.isArray(migrations) ? migrations : []).find((entry: unknown) =>
      String(Reflect.get(Object(entry), 'name')).startsWith('0006_'),
    );
    const queries: unknown = Reflect.get(Object(migration), 'queries');
    if (!Array.isArray(queries) || queries.length === 0) throw new Error('no 0006 migration');
    await env.IDENTITY_DB.batch(queries.map((sql) => env.IDENTITY_DB.prepare(String(sql))));
    const { results } = await env.IDENTITY_DB.prepare(
      `SELECT id, base_permission, updated_at FROM orgs WHERE id LIKE 'org_mg%' ORDER BY id`,
    ).all<{ id: string; base_permission: string; updated_at: number }>();
    expect(results.map((row) => [row.id, row.base_permission])).toEqual([
      ['org_mgnone', 'none'],
      ['org_mgread', 'none'],
      ['org_mgwrite', 'write'],
    ]);
    expect(results.find((row) => row.id === 'org_mgread')?.updated_at).toBeGreaterThan(0);
  });
});

async function person(handle: string): Promise<Person> {
  const user = { id: `u_${handle.replaceAll('-', '')}`, handle, email: null };
  await insertUser(env, user, T0).run();
  return { id: user.id, handle };
}

function value<T>(result: { ok: true; value: T } | { ok: false; error: { message: string } }): T {
  if (!result.ok) throw new Error(result.error.message);
  return result.value;
}

async function orgWith(
  handle: string,
  members: Readonly<Record<string, OrgRole>>,
): Promise<{ orgId: string; owner: Person; people: Map<string, Person> }> {
  const owner = await person(`${handle}-own`);
  const org = value(await createOrg(env, owner, { handle, name: handle.toUpperCase() }, T0));
  const joined = await Promise.all(
    Object.entries(members).map(async ([name, role]) => {
      const who = await person(`${handle}-${name}`);
      const invite = { handle: who.handle, role };
      const invitation = value(await inviteToOrg(env, { actor: owner, orgId: org.id, invite }, T0));
      const answer = { user: who, invitationId: invitation.id, answer: 'accept' as const };
      value(await answerOrgInvitation(env, answer, T0));
      return [name, who] as const;
    }),
  );
  const people = new Map<string, Person>(joined);
  return { orgId: org.id, owner, people };
}

describe('the handle namespace', () => {
  it('refuses an org handle a person holds, and a person handle an org holds, in any case', async () => {
    const ada = await person('ns-ada');
    const taken = await createOrg(env, ada, { handle: 'NS-Ada', name: 'Clash' }, T0);
    expect(taken).toMatchObject({ ok: false, error: { code: 'handle_taken' } });

    value(await createOrg(env, ada, { handle: 'ns-acme', name: 'Acme' }, T0));
    expect(await isHandleTaken(env, 'ns-acme')).toBe(true);
    const clash = await insertUser(env, { id: 'u_nsclash', handle: 'NS-ACME', email: null }, T0)
      .run()
      .catch((error: unknown) => error);
    expect(isUniqueViolation(clash)).toBe(true);
    expect(await ownerByHandle(env, '@NS-Acme')).toMatchObject({ kind: 'org', handle: 'ns-acme' });
    expect(await ownerByHandle(env, 'ns-ada')).toMatchObject({ kind: 'user', id: ada.id });
  });

  it('refuses reserved and malformed handles', async () => {
    const bob = await person('ns-bob');
    expect(await createOrg(env, bob, { handle: 'settings', name: 'x' }, T0)).toMatchObject({
      ok: false,
      error: { code: 'invalid' },
    });
    expect(await createOrg(env, bob, { handle: '-bad-', name: 'x' }, T0)).toMatchObject({
      ok: false,
      error: { code: 'invalid' },
    });
  });
});

describe('roles', () => {
  it('makes the creator the owner and reports standing with the base permission (none)', async () => {
    const { orgId, owner, people } = await orgWith('rl-org', { ann: 'member', vic: 'viewer' });
    expect(await orgRole(env, orgId, owner.id)).toBe('owner');
    // A new org starts on none (owner's decision 2026-10-09): members reach invited repositories.
    expect(DEFAULT_BASE_PERMISSION).toBe('none');
    expect(await orgStanding(env, orgId, people.get('ann')?.id ?? '')).toEqual({
      role: 'member',
      basePermission: 'none',
    });
    expect(await orgRole(env, orgId, 'u_nobody')).toBeNull();
    expect((await orgsOf(env, owner.id)).map((m) => [m.org.handle, m.role])).toEqual([
      ['rl-org', 'owner'],
    ]);
  });

  it('answers capability questions from one table', () => {
    expect(mayInOrg('owner', 'delete')).toBe(true);
    expect(mayInOrg('admin', 'delete')).toBe(false);
    expect(mayInOrg('admin', 'secrets')).toBe(true);
    expect(mayInOrg('admin', 'owners')).toBe(false);
    expect(mayInOrg('member', 'settings')).toBe(false);
    expect(mayInOrg(null, 'see-members')).toBe(false);
    expect(mayCreateRepository('member', 'members')).toBe(true);
    expect(mayCreateRepository('member', 'admins')).toBe(false);
    expect(mayCreateRepository('viewer', 'members')).toBe(false);
    expect(mayCreateRepository('admin', 'admins')).toBe(true);
  });

  it('reads an owner from a repository record', () => {
    expect(ownerOf({ owner: { id: 'u_1', handle: 'a' } })).toEqual({
      kind: 'user',
      id: 'u_1',
      handle: 'a',
    });
    expect(ownerOf({ owner: { id: 'org_1', handle: 'b' }, owner_kind: 'org' }).kind).toBe('org');
  });
});

describe('invitations', () => {
  it('invites by handle; only the invitee answers; decline and cancel leave no member', async () => {
    const { orgId, owner } = await orgWith('iv-org', {});
    const dana = await person('iv-dana');
    const eve = await person('iv-eve');
    const first = value(
      await inviteToOrg(
        env,
        { actor: owner, orgId, invite: { handle: '@IV-Dana', role: 'member' } },
        T0,
      ),
    );
    expect(first).toMatchObject({ orgHandle: 'iv-org', inviteeHandle: 'iv-dana', role: 'member' });
    expect((await orgInvitationsFor(env, dana.id, T0)).map((i) => i.id)).toEqual([first.id]);
    expect(
      await answerOrgInvitation(env, { user: eve, invitationId: first.id, answer: 'accept' }, T0),
    ).toMatchObject({ ok: false, error: { code: 'not_found' } });
    value(
      await answerOrgInvitation(env, { user: dana, invitationId: first.id, answer: 'decline' }, T0),
    );
    expect(await orgRole(env, orgId, dana.id)).toBeNull();

    const second = value(
      await inviteToOrg(
        env,
        { actor: owner, orgId, invite: { handle: 'iv-dana', role: 'admin' } },
        T0,
      ),
    );
    expect((await pendingOrgInvitations(env, orgId, T0)).length).toBe(1);
    value(await cancelOrgInvitation(env, { actor: owner, orgId, invitationId: second.id }, T0));
    expect(await orgInvitationsFor(env, dana.id, T0)).toEqual([]);
    expect(
      await inviteToOrg(
        env,
        { actor: owner, orgId, invite: { handle: 'iv-nobody', role: 'member' } },
        T0,
      ),
    ).toMatchObject({ ok: false, error: { code: 'unknown_handle' } });
    expect(
      await inviteToOrg(
        env,
        { actor: owner, orgId, invite: { handle: owner.handle, role: 'member' } },
        T0,
      ),
    ).toMatchObject({ ok: false, error: { code: 'already_member' } });
  });

  it('expires invitations after two weeks', async () => {
    const { orgId, owner } = await orgWith('ix-org', {});
    const fay = await person('ix-fay');
    const invitation = value(
      await inviteToOrg(
        env,
        { actor: owner, orgId, invite: { handle: fay.handle, role: 'member' } },
        T0,
      ),
    );
    const later = T0 + 15 * 24 * 3600 * 1000;
    expect(await orgInvitationsFor(env, fay.id, later)).toEqual([]);
    expect(
      await answerOrgInvitation(
        env,
        { user: fay, invitationId: invitation.id, answer: 'accept' },
        later,
      ),
    ).toMatchObject({ ok: false });
  });

  it('lets admins invite members but not owners; members invite nobody', async () => {
    const { orgId, people } = await orgWith('ia-org', { adm: 'admin', mem: 'member' });
    const admin = people.get('adm') ?? { id: '', handle: '' };
    const member = people.get('mem') ?? { id: '', handle: '' };
    const gil = await person('ia-gil');
    expect(
      (
        await inviteToOrg(
          env,
          { actor: admin, orgId, invite: { handle: gil.handle, role: 'member' } },
          T0,
        )
      ).ok,
    ).toBe(true);
    expect(
      await inviteToOrg(
        env,
        { actor: admin, orgId, invite: { handle: gil.handle, role: 'owner' } },
        T0,
      ),
    ).toMatchObject({ ok: false, error: { code: 'forbidden' } });
    expect(
      await inviteToOrg(
        env,
        { actor: member, orgId, invite: { handle: gil.handle, role: 'viewer' } },
        T0,
      ),
    ).toMatchObject({ ok: false, error: { code: 'forbidden' } });
    const outsider = await person('ia-out');
    expect(
      await inviteToOrg(
        env,
        { actor: outsider, orgId, invite: { handle: gil.handle, role: 'viewer' } },
        T0,
      ),
    ).toMatchObject({ ok: false, error: { code: 'not_found' } });
  });
});

describe('changing roles, removing and leaving', () => {
  it('keeps the last owner: no leaving, no demotion, until another owner exists', async () => {
    const { orgId, owner, people } = await orgWith('lo-org', { adm: 'admin' });
    const admin = people.get('adm') ?? { id: '', handle: '' };
    expect(await removeOrgMember(env, { actor: owner, orgId, userId: owner.id }, T0)).toMatchObject(
      {
        ok: false,
        error: { code: 'last_owner' },
      },
    );
    expect(
      await setOrgMemberRole(env, { actor: owner, orgId, userId: owner.id, role: 'admin' }, T0),
    ).toMatchObject({ ok: false, error: { code: 'last_owner' } });
    // An admin may not touch the owner role.
    expect(
      await setOrgMemberRole(env, { actor: admin, orgId, userId: admin.id, role: 'owner' }, T0),
    ).toMatchObject({ ok: false, error: { code: 'forbidden' } });
    expect(await removeOrgMember(env, { actor: admin, orgId, userId: owner.id }, T0)).toMatchObject(
      {
        ok: false,
        error: { code: 'forbidden' },
      },
    );
    value(
      await setOrgMemberRole(env, { actor: owner, orgId, userId: admin.id, role: 'owner' }, T0),
    );
    value(await removeOrgMember(env, { actor: owner, orgId, userId: owner.id }, T0));
    expect(await orgRole(env, orgId, owner.id)).toBeNull();
    expect((await orgMembers(env, orgId)).map((m) => [m.handle, m.role])).toEqual([
      ['lo-org-adm', 'owner'],
    ]);
    const actions = (await listOrgAudit(env, orgId)).map((event) => event.action);
    expect(actions.slice(0, 2)).toEqual(['member.leave', 'member.role']);
  });

  it('lets admins remove members and members leave', async () => {
    const { orgId, people } = await orgWith('rm-org', { adm: 'admin', a: 'member', b: 'viewer' });
    const admin = people.get('adm') ?? { id: '', handle: '' };
    const a = people.get('a') ?? { id: '', handle: '' };
    const b = people.get('b') ?? { id: '', handle: '' };
    value(await removeOrgMember(env, { actor: admin, orgId, userId: a.id }, T0));
    value(await removeOrgMember(env, { actor: b, orgId, userId: b.id }, T0));
    expect(await removeOrgMember(env, { actor: a, orgId, userId: admin.id }, T0)).toMatchObject({
      ok: false,
      error: { code: 'not_found' },
    });
    expect((await orgMembers(env, orgId)).map((m) => m.role)).toEqual(['owner', 'admin']);
  });
});

describe('settings and deletion', () => {
  it('lets owners and admins change settings, members not, and audits the change', async () => {
    const { orgId, owner, people } = await orgWith('st-org', { adm: 'admin', mem: 'member' });
    const admin = people.get('adm') ?? { id: '', handle: '' };
    const member = people.get('mem') ?? { id: '', handle: '' };
    const icon = `orgs/${orgId}/icon/${'c'.repeat(32)}`;
    const changed = value(
      await updateOrg(env, admin, orgId, { basePermission: 'write', iconKey: icon }, T0),
    );
    expect(changed).toMatchObject({ basePermission: 'write', iconKey: icon });
    // Only this org's uploads: not another org's key, not an arbitrary path.
    expect(
      await updateOrg(env, admin, orgId, { iconKey: `orgs/org_other/icon/${'d'.repeat(32)}` }, T0),
    ).toMatchObject({ ok: false, error: { code: 'invalid' } });
    expect(await updateOrg(env, admin, orgId, { iconKey: 'icons/st.png' }, T0)).toMatchObject({
      ok: false,
      error: { code: 'invalid' },
    });
    expect(await updateOrg(env, member, orgId, { name: 'x' }, T0)).toMatchObject({
      ok: false,
      error: { code: 'forbidden' },
    });
    expect((await listOrgAudit(env, orgId))[0]).toMatchObject({
      action: 'org.settings',
      actorHandle: 'st-org-adm',
      detail: 'icon, base permission none → write',
    });
    expect(await deleteOrg(env, admin, orgId, T0)).toMatchObject({ ok: false });
    value(await deleteOrg(env, owner, orgId, T0));
    expect(await findOrgByHandle(env, 'st-org')).toBeNull();
    expect(await isHandleTaken(env, 'st-org')).toBe(false);
  });
});
