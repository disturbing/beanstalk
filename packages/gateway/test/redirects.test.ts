import { env } from 'cloudflare:test';
import { exports } from 'cloudflare:workers';
import { describe, expect, it } from 'vitest';

import { createOrg } from '@gitstalk/shared-identity/org-admin';
import { changeHandle } from '@gitstalk/shared-identity/profiles';
import { addSshKey } from '@gitstalk/shared-identity/ssh-keys';
import { PersonalTokenInput, createPersonalToken } from '@gitstalk/shared-identity/user-tokens';
import { insertUser } from '@gitstalk/shared-identity/users';
import type { RepoVisibility, RepositoryRecord } from '@gitstalk/shared-race/repos';
import type { RpcResult } from '@gitstalk/shared-race/rpc';

import { GIT_UA, gitResponse, push, pushBody } from './git-push-helpers';
import { call, sha } from './helpers';

/**
 * Old addresses (docs/claude-opus/28-organizations.md §6.3): a rename or a transfer leaves a
 * redirect, so `/<old-owner>/<old-name>` keeps working on every transport (the gateway serves
 * it in place: git over HTTPS clones and pushes, SSH, MCP, the registry RPC the web pages
 * redirect from). Chains land on the current name; a new repository at an old address takes
 * it over; an old handle composes with an old name.
 */
const gateway = exports.default;
const INTERNAL = 'http://gateway.internal';
const T0 = Date.parse('2026-10-09T12:00:00Z');

type Person = {
  readonly id: string;
  readonly handle: string;
  readonly token: string;
  readonly key: string;
};

/** Public key only (generated with ssh-keygen; the private half was discarded). */
const KEY = 'ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAAIMkz62L72vSCz9ISUgTkieAQ0N/NpZCMKaeBn+Nx2Wns';

describe('a renamed repository', () => {
  it('keeps answering at its old name: registry, clone, fetch and push', async () => {
    const ann = await signUp('rd-ann', null);
    const repo = value(await create(ann, { name: 'first' }));
    value(await gateway.updateRepository(ann.id, repo.id, { name: 'second' }));

    // The web asks the registry by address; it answers with the record at its new name.
    const found = value(await gateway.getRepository(ann.handle, 'first', ann.id));
    expect(found).toMatchObject({ id: repo.id, name: 'second' });

    expect((await refs(ann, 'first', 'git-upload-pack')).status).toBe(200);
    const fetched = await call('POST', `/git/${ann.handle}/first.git/git-upload-pack`, {
      body: '0000',
      headers: {
        ...GIT_UA,
        authorization: `Basic ${btoa(`x:${ann.token}`)}`,
        'content-type': 'application/x-git-upload-pack-request',
      },
    });
    expect(fetched.status).toBe(200);

    // git does not follow a redirect on POST: the push is served in place, and says so.
    expect((await refs(ann, 'first', 'git-receive-pack')).status).toBe(200);
    const pushed = await gitResponse(
      await push(
        `/git/${ann.handle}/first.git`,
        ann.token,
        pushBody({ ref: 'refs/heads/bean/old-remote', newSha: await sha('rd-old-remote') }),
      ),
    );
    expect(pushed.report).toContain('ok refs/heads/bean/old-remote');
    expect(pushed.remote).toContain(`this repository moved to ${ann.handle}/second`);
  });

  it('follows a chain to the current name and gives the address to a new repository', async () => {
    const bea = await signUp('rd-bea', null);
    const repo = value(await create(bea, { name: 'alpha' }));
    value(await gateway.updateRepository(bea.id, repo.id, { name: 'beta' }));
    value(await gateway.updateRepository(bea.id, repo.id, { name: 'gamma' }));
    for (const old of ['alpha', 'beta', 'gamma'])
      // oxlint-disable-next-line no-await-in-loop -- three addresses, one after the other
      expect(value(await gateway.getRepository(bea.handle, old, bea.id))).toMatchObject({
        id: repo.id,
        name: 'gamma',
      });

    // A new repository at an old address takes it over (as GitHub does).
    const fresh = value(await create(bea, { name: 'alpha' }));
    expect(value(await gateway.getRepository(bea.handle, 'alpha', bea.id)).id).toBe(fresh.id);
    expect(value(await gateway.getRepository(bea.handle, 'beta', bea.id)).id).toBe(repo.id);

    // Renaming back to an old name drops that redirect; the name it left redirects instead.
    value(await gateway.updateRepository(bea.id, repo.id, { name: 'beta' }));
    expect(value(await gateway.getRepository(bea.handle, 'gamma', bea.id)).name).toBe('beta');

    // Deleting the repository forgets its old addresses.
    value(await gateway.deleteRepository(bea.id, repo.id));
    expect(statusOf(await gateway.getRepository(bea.handle, 'gamma', bea.id))).toBe(404);
  });

  it("lets an owner reuse a deleted repository's name (its engine is the new one's own)", async () => {
    const hal = await signUp('rd-hal', null);
    const first = value(await create(hal, { name: 'again' }));
    value(await gateway.deleteRepository(hal.id, first.id));
    const second = value(await create(hal, { name: 'again' }));
    expect(second.engine_id).not.toBe(first.engine_id);
    expect((await refs(hal, 'again', 'git-upload-pack')).status).toBe(200);
  });

  it('never tells an outsider a private repository exists at its old name', async () => {
    const cid = await signUp('rd-cid', null);
    const eve = await signUp('rd-eve', null);
    const repo = value(await create(cid, { name: 'hush' }));
    value(await gateway.updateRepository(cid.id, repo.id, { name: 'quiet' }));
    expect(statusOf(await gateway.getRepository(cid.handle, 'hush', eve.id))).toBe(404);
    expect((await refs(eve, 'hush', 'git-upload-pack', cid.handle)).status).toBe(404);
  });
});

describe('a transferred repository', () => {
  it('answers at the old owner over HTTPS, SSH and MCP, and pushes there', async () => {
    const dot = await signUp('rd-dot', KEY);
    const org = value(await createOrg(env, dot, { handle: 'rd-org', name: 'RD' }, T0));
    const repo = value(await create(dot, { name: 'moving' }));
    value(await gateway.transferRepository(dot.id, repo.id, org.handle));

    expect(value(await gateway.getRepository(dot.handle, 'moving', dot.id))).toMatchObject({
      id: repo.id,
      owner: { handle: 'rd-org' },
    });
    expect((await refs(dot, 'moving', 'git-upload-pack')).status).toBe(200);
    const ssh = await gateway.sshGit(
      dot.key,
      new Request(`${INTERNAL}/git/${dot.handle}/moving.git/info/refs?service=git-receive-pack`),
    );
    expect(ssh.status).toBe(200);
    const agent = { user: dot, scopes: ['read', 'write'], label: 'Claude Code' };
    expect(
      value(await gateway.agentRepositoryAccess(agent, dot.handle, 'moving', 'write')),
    ).toMatchObject({ id: repo.id, owner: { handle: 'rd-org' } });

    const pushed = await gitResponse(
      await push(
        `/git/${dot.handle}/moving.git`,
        dot.token,
        pushBody({ ref: 'refs/heads/bean/after-move', newSha: await sha('rd-after-move') }),
      ),
    );
    expect(pushed.report).toContain('ok refs/heads/bean/after-move');
    expect(pushed.remote).toContain('moved to rd-org/moving');

    // Back to the person: both earlier addresses still land.
    value(await gateway.transferRepository(dot.id, repo.id, dot.handle));
    expect(value(await gateway.getRepository('rd-org', 'moving', dot.id)).owner.handle).toBe(
      dot.handle,
    );
    expect(value(await gateway.getRepository(dot.handle, 'moving', dot.id)).id).toBe(repo.id);
  });

  it('makes an internal repository private when it moves to a person', async () => {
    const fay = await signUp('rd-fay', null);
    const org = value(await createOrg(env, fay, { handle: 'rd-int', name: 'Int' }, T0));
    const repo = value(
      await create(fay, { owner: org.handle, name: 'inside', visibility: 'internal' }),
    );
    expect(repo.visibility).toBe('internal');
    const moved = value(await gateway.transferRepository(fay.id, repo.id, fay.handle));
    expect(moved.visibility).toBe('private');
    expect(value(await gateway.getRepository(fay.handle, 'inside', fay.id)).visibility).toBe(
      'private',
    );
    const lines = value(await gateway.repositoryActivity(fay.id, 5)).map((line) => line.text);
    expect(lines).toContain('Made private: only organizations have internal repositories.');
  });
});

describe('an old handle and an old name together', () => {
  it('resolve to the repository after a rename and a handle change', async () => {
    const gil = await signUp('rd-gil', null);
    const repo = value(await create(gil, { name: 'orig' }));
    value(await gateway.updateRepository(gil.id, repo.id, { name: 'renamed' }));
    const changed = await changeHandle(env, {
      userId: gil.id,
      ip: null,
      now: T0,
      handle: 'rd-gil-new',
    });
    expect(changed.ok).toBe(true);
    value(await gateway.renameOwner(gil.id, 'rd-gil-new'));

    for (const [owner, name] of [
      ['rd-gil', 'orig'],
      ['rd-gil', 'renamed'],
      ['rd-gil-new', 'orig'],
      ['rd-gil-new', 'renamed'],
    ] as const)
      // oxlint-disable-next-line no-await-in-loop -- four addresses, one after the other
      expect(value(await gateway.getRepository(owner, name, gil.id))).toMatchObject({
        id: repo.id,
        owner: { handle: 'rd-gil-new' },
        name: 'renamed',
      });
    expect((await refs(gil, 'orig', 'git-receive-pack', 'rd-gil')).status).toBe(200);
  });
});

// Helpers ----------------------------------------------------------------------------------

function refs(who: Person, name: string, service: string, owner = who.handle): Promise<Response> {
  return call('GET', `/git/${owner}/${name}.git/info/refs?service=${service}`, {
    token: who.token,
  });
}

function create(
  actor: Person,
  input: { owner?: string; name: string; visibility?: RepoVisibility },
): Promise<RpcResult<RepositoryRecord>> {
  return gateway.createRepository(actor, {
    ...input,
    visibility: input.visibility ?? 'private',
    start: { kind: 'empty' },
  });
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
