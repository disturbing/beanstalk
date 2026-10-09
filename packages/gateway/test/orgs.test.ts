import { env } from 'cloudflare:test';
import { exports } from 'cloudflare:workers';
import { beforeAll, describe, expect, it } from 'vitest';

import { createOrg, updateOrg } from '@beanstalk/shared-identity/org-admin';
import { listOrgAudit } from '@beanstalk/shared-identity/org-audit';
import {
  answerOrgInvitation,
  inviteToOrg,
  removeOrgMember,
  setOrgMemberRole,
} from '@beanstalk/shared-identity/org-members';
import type { OrgBasePermission, OrgRole } from '@beanstalk/shared-identity/orgs';
import { addSshKey } from '@beanstalk/shared-identity/ssh-keys';
import { PersonalTokenInput, createPersonalToken } from '@beanstalk/shared-identity/user-tokens';
import { insertUser } from '@beanstalk/shared-identity/users';
import type { RepoRole, ViewerRole } from '@beanstalk/shared-race/collaborators';
import type { RepositoryRecord } from '@beanstalk/shared-race/repos';
import type { RpcResult } from '@beanstalk/shared-race/rpc';

import { call } from './helpers';

/**
 * Organizations (docs/claude-opus/28-organizations.md). The matrix: org role × the org's base
 * permission × a collaborator role on top × visibility (public, private, internal) ×
 * transport, every answer from `mayUseEngine`. The expected repository role of each person is
 * written out per base permission (ROLE); an internal repository adds read for every member
 * (INTERNAL_READERS); the status each transport gives a role is the collaborators matrix's
 * rule. `list` is the org page's repository list: 200 when the repository is in it, 404 not.
 */
const gateway = exports.default;
const INTERNAL = 'http://gateway.internal';
const T0 = Date.parse('2026-10-08T12:00:00Z');

type Who =
  | 'owner'
  | 'admin'
  | 'member'
  | 'viewer'
  | 'member+write'
  | 'viewer+maintain'
  | 'outsider'
  | 'anonymous';
type Person = {
  readonly id: string;
  readonly handle: string;
  readonly token: string;
  readonly key: string;
};

const WHO: readonly Who[] = [
  'owner',
  'admin',
  'member',
  'viewer',
  'member+write',
  'viewer+maintain',
  'outsider',
  'anonymous',
];
type Someone = Exclude<Who, 'anonymous'>;
const SOMEONE: readonly Someone[] = WHO.filter((who): who is Someone => who !== 'anonymous');
const BASES: readonly OrgBasePermission[] = ['none', 'read', 'write'];

/** What each person is on every repository of an org with this base permission. */
const ROLE: Readonly<Record<OrgBasePermission, Readonly<Record<Who, ViewerRole | null>>>> = {
  none: {
    owner: 'owner',
    admin: 'owner',
    member: null,
    viewer: null,
    'member+write': 'write',
    'viewer+maintain': 'maintain',
    outsider: null,
    anonymous: null,
  },
  read: {
    owner: 'owner',
    admin: 'owner',
    member: 'read',
    viewer: 'read',
    'member+write': 'write',
    'viewer+maintain': 'maintain',
    outsider: null,
    anonymous: null,
  },
  write: {
    owner: 'owner',
    admin: 'owner',
    member: 'write',
    viewer: 'read',
    'member+write': 'write',
    'viewer+maintain': 'maintain',
    outsider: null,
    anonymous: null,
  },
};

/** Their org role (null: none), and a collaborator role added on every repository. */
const SETUP: Readonly<Record<Someone, [OrgRole | null, RepoRole | null]>> = {
  owner: ['owner', null],
  admin: ['admin', null],
  member: ['member', null],
  viewer: ['viewer', null],
  'member+write': ['member', 'write'],
  'viewer+maintain': ['viewer', 'maintain'],
  outsider: [null, null],
};

/** Public keys only (generated with ssh-keygen; the private halves were discarded). */
const KEYS = [
  'ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAAIHpQoeaV+aDXNOdEaBCLLBXItneC5sRxcY3cSsnXFiun',
  'ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAAIJ+QFjaDcQRVVnEpD2NWDhmfvkoCTPRvAgEatr3xNDiQ',
  'ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAAIINmUcZ2Fj9dtiiKFWlHoOF60iVzmbkliTF1bf4qJSND',
  'ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAAIGd9LJJpl8AB++VcDg8hm14jx1I828au3Li8F18/V432',
  'ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAAINqjlav7MJBN/WN6w879TNkjCGcEWDKlqexHM0UIL5xl',
  'ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAAIE0tMZaDfVO38BokUqB9hKZA/NWeOxf02Cz/GcSZUId2',
  'ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAAINSqzLao5za/R3aKP3bFNyPwrX3mmVhKPnwVDHP9NufP',
] as const;

type Visibility = 'private' | 'public' | 'internal';
const VISIBILITIES: readonly Visibility[] = ['private', 'public', 'internal'];
/** Who reads an internal repository whatever the base permission: every member of the org. */
const INTERNAL_READERS: ReadonlySet<Who> = new Set([
  'owner',
  'admin',
  'member',
  'viewer',
  'member+write',
  'viewer+maintain',
]);
const TRANSPORTS = ['https', 'ssh', 'mcp', 'web', 'list'] as const;
type Transport = (typeof TRANSPORTS)[number];
type Action = 'read' | 'write' | 'administer';
type Status = 200 | 401 | 403 | 404;

const CARRIES: Readonly<Record<Transport, readonly Action[]>> = {
  https: ['read', 'write'],
  ssh: ['read', 'write'],
  mcp: ['read', 'write'],
  web: ['read', 'administer'],
  list: ['read'],
};
const LEAST: Readonly<Record<Action, ViewerRole>> = {
  read: 'read',
  write: 'write',
  administer: 'owner',
};
const RANK: Readonly<Record<ViewerRole, number>> = { read: 1, write: 2, maintain: 3, owner: 4 };

const people = new Map<Who, Person>();
const repos = new Map<string, RepositoryRecord>();

beforeAll(async () => {
  const signed = await Promise.all(
    SOMEONE.map(async (who, index) => {
      const handle = `om-${who.replace('+', '-')}`;
      return [who, await signUp(handle, KEYS[index] ?? null)] as const;
    }),
  );
  for (const [who, signedUp] of signed) people.set(who, signedUp);
  await Promise.all(BASES.map((base) => orgWithRepos(base)));
});

const cases = BASES.flatMap((base) =>
  VISIBILITIES.flatMap((visibility) =>
    TRANSPORTS.flatMap((transport) =>
      CARRIES[transport].flatMap((action) =>
        WHO.flatMap((who) => {
          const expected = expectedFor({ base, visibility, transport, action, who });
          return expected === null ? [] : [{ base, visibility, transport, action, who, expected }];
        }),
      ),
    ),
  ),
);

describe('org access matrix: org role × base permission × collaborator × visibility × transport', () => {
  it('covers every combination a transport carries', () => {
    expect(cases).toHaveLength(603);
  });

  it.each(cases)(
    'base $base, $visibility, $transport $action as $who → $expected',
    async ({ base, visibility, transport, action, who, expected }) => {
      const record = repos.get(`${base}-${visibility}`);
      if (record === undefined) throw new Error('no repository');
      expect(await attempt({ transport, action, who, record })).toBe(expected);
    },
  );
});

function expectedFor(input: {
  base: OrgBasePermission;
  visibility: Visibility;
  transport: Transport;
  action: Action;
  who: Who;
}): Status | null {
  const baseRole = ROLE[input.base][input.who];
  const role =
    input.visibility === 'internal' && INTERNAL_READERS.has(input.who)
      ? (baseRole ?? 'read')
      : baseRole;
  const status = statusFor(role, input.visibility, input.action);
  if (input.transport === 'list') return status;
  if (input.who !== 'anonymous') {
    // Tokens, keys and agent sessions never administer.
    const isAgent = input.transport !== 'web';
    return isAgent && input.action === 'administer' && status === 200 ? 403 : status;
  }
  if (input.transport === 'ssh' || input.transport === 'mcp') return null;
  if (input.transport === 'https') return status === 200 ? 200 : 401;
  return input.action === 'administer' ? null : status;
}

function statusFor(role: ViewerRole | null, visibility: Visibility, action: Action): Status {
  if (role === null) {
    if (visibility !== 'public') return 404;
    return action === 'read' ? 200 : 403;
  }
  return RANK[role] >= RANK[LEAST[action]] ? 200 : 403;
}

async function attempt(input: {
  transport: Transport;
  action: Action;
  who: Who;
  record: RepositoryRecord;
}): Promise<number> {
  const { record } = input;
  const who = input.who === 'anonymous' ? null : person(input.who);
  const service = input.action === 'write' ? 'git-receive-pack' : 'git-upload-pack';
  const path = `/git/${record.owner.handle}/${record.name}.git/info/refs?service=${service}`;
  switch (input.transport) {
    case 'https':
      return (await call('GET', path, who === null ? {} : { token: who.token })).status;
    case 'ssh':
      return (await gateway.sshGit(who?.key ?? '', new Request(`${INTERNAL}${path}`))).status;
    case 'mcp': {
      if (who === null) throw new Error('MCP has no anonymous caller');
      const agent = { user: who, scopes: ['read', 'write'], label: 'Claude Code' };
      return statusOf(
        await gateway.agentRepositoryAccess(agent, record.owner.handle, record.name, input.action),
      );
    }
    case 'web':
      if (input.action === 'read')
        return statusOf(
          await gateway.getRepository(record.owner.handle, record.name, who?.id ?? null),
        );
      if (who === null) throw new Error('signed in only');
      return statusOf(
        await gateway.updateRepository(who.id, record.id, { description: `by ${who.handle}` }),
      );
    case 'list': {
      const listed = value(await gateway.listRepositories(record.owner.id, who?.id ?? null));
      return listed.some((entry) => entry.id === record.id) ? 200 : 404;
    }
    default:
      return input.transport;
  }
}

describe('repositories in an org', () => {
  it('lets members create when the org allows it, never viewers, and 404s outsiders', async () => {
    const { org, people: crew } = await orgOf('cr-org', { mem: 'member', vie: 'viewer' });
    const member = crew.get('mem');
    const viewer = crew.get('vie');
    if (member === undefined || viewer === undefined) throw new Error('setup');
    const made = value(await create(member, { owner: org.handle, name: 'made-by-member' }));
    expect(made).toMatchObject({ owner: { id: org.id, handle: 'cr-org' }, owner_kind: 'org' });
    expect(statusOf(await create(viewer, { owner: org.handle, name: 'nope' }))).toBe(403);
    const outsider = await signUp('cr-outsider', null);
    expect(statusOf(await create(outsider, { owner: org.handle, name: 'nope' }))).toBe(404);
    value(await updateOrg(env, crew.get('own') ?? member, org.id, { repoCreation: 'admins' }, T0));
    expect(statusOf(await create(member, { owner: org.handle, name: 'nope2' }))).toBe(403);
    expect((await listOrgAudit(env, org.id)).map((event) => event.action)).toContain(
      'repository.create',
    );
  });

  it('applies a base permission change and a removal on the next request', async () => {
    const { org, people: crew } = await orgOf('bp-org', { mem: 'member' });
    const owner = crew.get('own');
    const member = crew.get('mem');
    if (owner === undefined || member === undefined) throw new Error('setup');
    const record = value(
      await create(owner, { owner: org.handle, name: 'bp-repo', visibility: 'private' }),
    );
    // A new org is on base none: an uninvited member does not learn the repository exists.
    expect((await bpGit(member.token, 'git-upload-pack')).status).toBe(404);
    value(await updateOrg(env, owner, org.id, { basePermission: 'read' }, T0));
    expect((await bpGit(member.token, 'git-receive-pack')).status).toBe(403);
    value(await updateOrg(env, owner, org.id, { basePermission: 'write' }, T0));
    expect((await bpGit(member.token, 'git-receive-pack')).status).toBe(200);
    value(
      await setOrgMemberRole(
        env,
        { actor: owner, orgId: org.id, userId: member.id, role: 'viewer' },
        T0,
      ),
    );
    expect((await bpGit(member.token, 'git-receive-pack')).status).toBe(403);
    value(await removeOrgMember(env, { actor: owner, orgId: org.id, userId: member.id }, T0));
    expect((await bpGit(member.token, 'git-upload-pack')).status).toBe(404);
    expect(statusOf(await gateway.getRepository('bp-org', 'bp-repo', member.id))).toBe(404);
    // The org's list shows a non-member its public repositories only.
    expect(value(await gateway.listRepositories(org.id, member.id))).toEqual([]);
    expect(value(await gateway.listRepositories(org.id, owner.id)).map((r) => r.id)).toEqual([
      record.id,
    ]);
  });

  it('puts org repositories a member reads in their activity', async () => {
    const { org, people: crew } = await orgOf('ac-org', { mem: 'member' });
    const owner = crew.get('own');
    const member = crew.get('mem');
    if (owner === undefined || member === undefined) throw new Error('setup');
    value(await create(owner, { owner: org.handle, name: 'ac-repo' }));
    const names = async () =>
      value(await gateway.repositoryActivity(member.id, 20)).map(
        (line) => `${line.owner_handle}/${line.repo_name}`,
      );
    expect(await names()).toEqual([]);
    value(await updateOrg(env, owner, org.id, { basePermission: 'read' }, T0));
    expect(await names()).toContain('ac-org/ac-repo');
    value(await updateOrg(env, owner, org.id, { basePermission: 'none' }, T0));
    expect(await names()).toEqual([]);
    // An internal repository is every member's to read, so it is in their activity.
    value(await create(owner, { owner: org.handle, name: 'ac-inside', visibility: 'internal' }));
    expect(await names()).toEqual(['ac-org/ac-inside']);
  });
});

describe('internal repositories', () => {
  it('exist only in orgs: refused for a person on create and on a visibility change', async () => {
    const solo = await signUp('in-solo', null);
    expect(await create(solo, { name: 'mine', visibility: 'internal' })).toMatchObject({
      ok: false,
      error: { code: 'invalid_request', status: 400 },
    });
    const mine = value(await create(solo, { name: 'mine' }));
    expect(
      await gateway.updateRepository(solo.id, mine.id, { visibility: 'internal' }),
    ).toMatchObject({ ok: false, error: { code: 'invalid_request' } });
  });

  it('let every member read, list and clone, and nobody else; writing needs a role', async () => {
    const { org, people: crew } = await orgOf('in-org', { mem: 'member', vie: 'viewer' });
    const owner = crew.get('own');
    const member = crew.get('mem');
    const viewer = crew.get('vie');
    if (owner === undefined || member === undefined || viewer === undefined)
      throw new Error('setup');
    const outsider = await signUp('in-outsider', null);
    const made = value(await create(owner, { owner: org.handle, name: 'in-repo' }));
    const git = (who: Person, service: string) =>
      call('GET', `/git/in-org/in-repo.git/info/refs?service=${service}`, { token: who.token });
    expect((await git(viewer, 'git-upload-pack')).status).toBe(404);
    value(await gateway.updateRepository(owner.id, made.id, { visibility: 'internal' }));
    expect((await git(viewer, 'git-upload-pack')).status).toBe(200);
    expect((await git(member, 'git-upload-pack')).status).toBe(200);
    expect((await git(member, 'git-receive-pack')).status).toBe(403);
    expect((await git(outsider, 'git-upload-pack')).status).toBe(404);
    expect(value(await gateway.getRepository('in-org', 'in-repo', viewer.id)).viewer_role).toBe(
      'read',
    );
    expect(value(await gateway.listRepositories(org.id, viewer.id)).map((r) => r.id)).toEqual([
      made.id,
    ]);
    expect(value(await gateway.listRepositories(org.id, outsider.id))).toEqual([]);
    expect(value(await gateway.listRepositories(org.id, null))).toEqual([]);
    const audit = value(await gateway.repositoryPeople(made.id, owner.id)).audit.map(
      (event) => event.detail,
    );
    expect(audit).toContain('private → internal');
  });
});

describe('transfers', () => {
  it('moves a repository to an org its owner administers and back; git follows the new name', async () => {
    const { org, people: crew } = await orgOf('tr-org', { adm: 'admin', mem: 'member' });
    const admin = crew.get('adm');
    const member = crew.get('mem');
    if (admin === undefined || member === undefined) throw new Error('setup');
    value(await updateOrg(env, crew.get('own') ?? admin, org.id, { basePermission: 'read' }, T0));
    const mine = value(await create(admin, { name: 'tr-repo', visibility: 'private' }));
    const moved = value(await gateway.transferRepository(admin.id, mine.id, 'tr-org'));
    expect(moved).toMatchObject({ owner: { id: org.id, handle: 'tr-org' }, owner_kind: 'org' });
    const at = (owner: string) =>
      call('GET', `/git/${owner}/tr-repo.git/info/refs?service=git-upload-pack`, {
        token: member.token,
      });
    expect((await at('tr-org')).status).toBe(200);
    // A member may not move it out; the admin moves it back to themself.
    expect(statusOf(await gateway.transferRepository(member.id, mine.id, member.handle))).toBe(403);
    value(await gateway.transferRepository(admin.id, mine.id, admin.handle));
    // tr-org/tr-repo now redirects to the admin's private repository: the member reads neither.
    expect((await at('tr-org')).status).toBe(404);
    expect((await at(admin.handle)).status).toBe(404);
    const audit = value(await gateway.repositoryPeople(mine.id, admin.id)).audit.map(
      (e) => e.detail,
    );
    expect(audit.slice(0, 2)).toEqual([`tr-org → ${admin.handle}`, `${admin.handle} → tr-org`]);
    const orgLog = (await listOrgAudit(env, org.id)).map((event) => event.action);
    expect(orgLog.slice(0, 2)).toEqual(['repository.transfer_out', 'repository.transfer_in']);
  });

  it('refuses orgs the actor does not administer, other people, and taken names', async () => {
    const { org, people: crew } = await orgOf('tx-org', { mem: 'member' });
    const owner = crew.get('own');
    const member = crew.get('mem');
    if (owner === undefined || member === undefined) throw new Error('setup');
    const theirs = value(await create(member, { name: 'tx-repo' }));
    expect(statusOf(await gateway.transferRepository(member.id, theirs.id, 'tx-org'))).toBe(403);
    expect(statusOf(await gateway.transferRepository(member.id, theirs.id, owner.handle))).toBe(
      403,
    );
    expect(statusOf(await gateway.transferRepository(member.id, theirs.id, 'tx-nobody'))).toBe(404);
    value(await create(owner, { owner: org.handle, name: 'tx-repo' }));
    const mine = value(await create(owner, { name: 'tx-repo' }));
    expect(await gateway.transferRepository(owner.id, mine.id, 'tx-org')).toMatchObject({
      ok: false,
      error: { code: 'name_taken', status: 409 },
    });
  });
});

// Helpers ----------------------------------------------------------------------------------

async function orgWithRepos(base: OrgBasePermission): Promise<void> {
  const owner = person('owner');
  const handle = `om-org-${base}`;
  const org = value(await createOrg(env, owner, { handle, name: `Base ${base}` }, T0));
  value(await updateOrg(env, owner, org.id, { basePermission: base }, T0));
  const joiners = SOMEONE.filter((who) => who !== 'owner');
  await Promise.all(
    joiners.map(async (who) => {
      const role = SETUP[who][0];
      if (role !== null) await join(org.id, owner, person(who), role);
    }),
  );
  await Promise.all(
    VISIBILITIES.map(async (visibility) => {
      const record = value(
        await create(owner, { owner: handle, name: `m-${visibility}`, visibility }),
      );
      repos.set(`${base}-${visibility}`, record);
      await Promise.all(
        joiners.map(async (who) => {
          const collaborator = SETUP[who][1];
          if (collaborator === null) return;
          const invited = value(
            await gateway.inviteCollaborator(owner, record.id, {
              handle: person(who).handle,
              role: collaborator,
            }),
          );
          value(await gateway.answerInvitation(person(who), invited.id, 'accept'));
        }),
      );
    }),
  );
}

async function orgOf(
  handle: string,
  members: Readonly<Record<string, OrgRole>>,
): Promise<{ org: { id: string; handle: string }; people: Map<string, Person> }> {
  const owner = await signUp(`${handle}-own`, null);
  const org = value(await createOrg(env, owner, { handle, name: handle }, T0));
  const joined = await Promise.all(
    Object.entries(members).map(async ([name, role]) => {
      const who = await signUp(`${handle}-${name}`, null);
      await join(org.id, owner, who, role);
      return [name, who] as const;
    }),
  );
  return { org, people: new Map<string, Person>([['own', owner], ...joined]) };
}

async function join(orgId: string, owner: Person, who: Person, role: OrgRole): Promise<void> {
  const invite = { handle: who.handle, role };
  const invitation = value(await inviteToOrg(env, { actor: owner, orgId, invite }, T0));
  value(
    await answerOrgInvitation(
      env,
      { user: who, invitationId: invitation.id, answer: 'accept' },
      T0,
    ),
  );
}

function create(
  actor: Person,
  input: { owner?: string; name: string; visibility?: Visibility },
): Promise<RpcResult<RepositoryRecord>> {
  return gateway.createRepository(actor, {
    ...input,
    visibility: input.visibility ?? 'private',
    start: { kind: 'empty' },
  });
}

function bpGit(token: string, service: string): Promise<Response> {
  return call('GET', `/git/bp-org/bp-repo.git/info/refs?service=${service}`, { token });
}

function person(who: Who): Person {
  const found = people.get(who);
  if (found === undefined) throw new Error(`no ${who}`);
  return found;
}

async function signUp(handle: string, key: string | null): Promise<Person> {
  const id = `u_${handle.replace(/-/g, '_')}`;
  await insertUser(env, { id, handle, email: null }, Date.now()).run();
  const pat = await createPersonalToken(env, {
    userId: id,
    request: PersonalTokenInput.parse({ name: 'laptop', scopes: ['read', 'write'], days: 7 }),
  });
  if (key !== null) {
    const added = await addSshKey(env, { userId: id, publicKey: key, name: 'laptop', ip: null });
    if (!added.ok) throw new Error(`key refused for ${handle}`);
  }
  return { id, handle, token: pat.token, key: key ?? '' };
}

function statusOf(result: RpcResult<unknown>): number {
  return result.ok ? 200 : result.error.status;
}

function value<T>(
  result: RpcResult<T> | { ok: true; value: T } | { ok: false; error: { message: string } },
): T {
  if (!result.ok) throw new Error(result.error.message);
  return result.value;
}
