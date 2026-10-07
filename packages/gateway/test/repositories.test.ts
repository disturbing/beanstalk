import { env } from 'cloudflare:test';
import { exports } from 'cloudflare:workers';
import { describe, expect, it } from 'vitest';

import type { RepositoryRecord } from '@beanstalk/shared-race/repos';
import type { RpcResult } from '@beanstalk/shared-race/rpc';

import { call } from './helpers';

/** The web app's service binding: the gateway's default entrypoint, over RPC. */
const gateway = exports.default;

let users = 0;

/** A fresh owner per test, so names never collide across tests. */
function owner() {
  users += 1;
  return { id: `u_test_${users}_${crypto.randomUUID().slice(0, 8)}`, handle: `dev${users}` };
}

function value<T>(result: RpcResult<T>): T {
  if (!result.ok) throw new Error(`${result.error.code}: ${result.error.message}`);
  return result.value;
}

async function artifactsRefs(name: string): Promise<{ stalk: string; sprout: string }> {
  using repo = await env.ARTIFACTS.get(name);
  const [[stalk], [sprout]] = await Promise.all([
    repo.log({ ref: 'stalk', limit: 1 }),
    repo.log({ ref: 'sprout', limit: 1 }),
  ]);
  return { stalk: stalk?.hash ?? '', sprout: sprout?.hash ?? '' };
}

describe('creating a repository', () => {
  it('provisions the Artifacts repo, seeds the stalk and the sprout, and opens the engine', async () => {
    const coop = owner();
    const created = value(
      await gateway.createRepository(coop, {
        name: 'notes',
        description: 'Coop’s notes',
        visibility: 'private',
        start: { kind: 'template', template: 'typescript-starter' },
      }),
    );
    expect(created).toMatchObject({
      owner: coop,
      name: 'notes',
      visibility: 'private',
      origin: { kind: 'template', template: 'typescript-starter' },
      artifacts_repo: `repo-${created.id}`,
      default_branch: 'stalk',
    });
    // The engine's id is derived from <owner>/<repo> (docs/claude-opus/18).
    expect(created.engine_id).toMatch(/^r[0-9a-f]{19}$/);
    const refs = await artifactsRefs(created.artifacts_repo);
    expect(refs.stalk).toMatch(/^[0-9a-f]{40}$/);
    expect(refs.sprout).toBe(refs.stalk);
  });

  it('refuses a second repository with the same name for one owner, ignoring case', async () => {
    const coop = owner();
    const input = { name: 'shop', visibility: 'public', start: { kind: 'empty' } } as const;
    value(await gateway.createRepository(coop, input));
    const again = await gateway.createRepository(coop, { ...input, name: 'Shop' });
    expect(again).toMatchObject({ ok: false, error: { code: 'name_taken', status: 409 } });
    // Another owner may use the name.
    value(await gateway.createRepository(owner(), input));
  });

  it('rejects names the URL cannot carry', async () => {
    const results = await Promise.all(
      ['', 'a/b', '..', 'x.git', 'has space'].map((name) =>
        gateway.createRepository(owner(), { name, visibility: 'public', start: { kind: 'empty' } }),
      ),
    );
    for (const result of results)
      expect(result).toMatchObject({ ok: false, error: { code: 'invalid_request' } });
  });

  it('imports a public git URL and points the stalk at its default branch', async () => {
    const coop = owner();
    const created = value(
      await gateway.createRepository(coop, {
        name: 'imported',
        visibility: 'public',
        start: { kind: 'import', url: 'https://git.example.test/acme/tool.git' },
      }),
    );
    const files = value(await gateway.repositoryFiles(created.id, null));
    expect(files.files).toEqual(['README.md', 'src/index.ts']);
    expect(files.readme).toBe('# imported\n');
    const refs = await artifactsRefs(created.artifacts_repo);
    expect(refs.stalk).toBe(files.sha);
  });

  it('frees the name when provisioning fails', async () => {
    const coop = owner();
    const input = {
      name: 'private-import',
      visibility: 'public',
      start: { kind: 'import', url: 'https://elsewhere.test/secret.git' },
    } as const;
    const failed = await gateway.createRepository(coop, input);
    expect(failed).toMatchObject({ ok: false, error: { code: 'import_refused', status: 422 } });
    expect(value(await gateway.listRepositories(coop.id, coop.id))).toEqual([]);
    value(await gateway.createRepository(coop, { ...input, start: { kind: 'empty' } }));
  });
});

async function two(): Promise<{
  coop: ReturnType<typeof owner>;
  open: RepositoryRecord;
  secret: RepositoryRecord;
}> {
  const coop = owner();
  const open = value(
    await gateway.createRepository(coop, {
      name: 'open',
      visibility: 'public',
      start: { kind: 'empty' },
    }),
  );
  const secret = value(
    await gateway.createRepository(coop, {
      name: 'secret',
      visibility: 'private',
      start: { kind: 'empty' },
    }),
  );
  return { coop, open, secret };
}

describe('reading repositories', () => {
  it('lists private repositories to their owner only', async () => {
    const { coop } = await two();
    const mine = value(await gateway.listRepositories(coop.id, coop.id));
    expect(mine.map((repo) => repo.name).toSorted()).toEqual(['open', 'secret']);
    const theirs = value(await gateway.listRepositories(coop.id, 'someone-else'));
    expect(theirs.map((repo) => repo.name)).toEqual(['open']);
  });

  it('finds a repository by handle and name, case-insensitively, hiding private ones', async () => {
    const { coop, secret } = await two();
    expect(value(await gateway.getRepository(coop.handle, 'SECRET', coop.id)).id).toBe(secret.id);
    expect(await gateway.getRepository(coop.handle, 'secret', null)).toMatchObject({
      ok: false,
      error: { code: 'not_found' },
    });
    expect(await gateway.repositoryFiles(secret.id, null)).toMatchObject({ ok: false });
  });
});

describe('changing and deleting a repository', () => {
  it('renames, re-describes and changes visibility, recording each in the activity', async () => {
    const coop = owner();
    const repo = value(
      await gateway.createRepository(coop, {
        name: 'draft',
        visibility: 'private',
        start: { kind: 'empty' },
      }),
    );
    const updated = value(
      await gateway.updateRepository(coop.id, repo.id, {
        name: 'final',
        description: 'Now with a purpose',
        visibility: 'public',
      }),
    );
    expect(updated).toMatchObject({
      name: 'final',
      visibility: 'public',
      artifacts_repo: repo.artifacts_repo,
    });
    expect(value(await gateway.getRepository(coop.handle, 'final', null)).id).toBe(repo.id);
    const activity = value(await gateway.repositoryActivity(coop.id, 10));
    // Newest first; one update's changes are recorded in the order renamed, described, visibility.
    expect(activity.map((line) => line.kind)).toEqual([
      'visibility',
      'described',
      'renamed',
      'created',
    ]);
    expect(activity[2]).toMatchObject({ repo_name: 'final', text: 'Renamed from draft.' });
  });

  it('refuses a rename onto a taken name and any change by someone else', async () => {
    const coop = owner();
    const start = { kind: 'empty' } as const;
    value(await gateway.createRepository(coop, { name: 'a', visibility: 'public', start }));
    const b = value(
      await gateway.createRepository(coop, { name: 'b', visibility: 'public', start }),
    );
    expect(await gateway.updateRepository(coop.id, b.id, { name: 'A' })).toMatchObject({
      ok: false,
      error: { code: 'name_taken' },
    });
    expect(await gateway.updateRepository('intruder', b.id, { description: 'x' })).toMatchObject({
      ok: false,
      error: { code: 'forbidden', status: 403 },
    });
    expect(await gateway.deleteRepository('intruder', b.id)).toMatchObject({ ok: false });
  });

  it('deletes the record and the Artifacts repo', async () => {
    const coop = owner();
    const repo = value(
      await gateway.createRepository(coop, {
        name: 'gone',
        visibility: 'public',
        start: { kind: 'empty' },
      }),
    );
    value(await gateway.deleteRepository(coop.id, repo.id));
    expect(await gateway.getRepository(coop.handle, 'gone', coop.id)).toMatchObject({ ok: false });
    const listed = await env.ARTIFACTS.list();
    expect(listed.repos.map((entry) => entry.name)).not.toContain(repo.artifacts_repo);
    expect(value(await gateway.repositoryActivity(coop.id, 10))).toEqual([]);
  });
});

describe('git through the registry', () => {
  it('serves a repository at its current name, and its old name no longer', async () => {
    const coop = owner();
    const repo = value(
      await gateway.createRepository(coop, {
        name: 'before',
        visibility: 'private',
        start: { kind: 'template', template: 'typescript-starter' },
      }),
    );
    const token = value(await gateway.gitToken(repo.engine_id, coop)).token;
    const refs = (name: string) =>
      call('GET', `/git/${coop.handle}/${name}.git/info/refs?service=git-upload-pack`, { token });
    expect((await refs('before')).status).toBe(200);
    value(await gateway.updateRepository(coop.id, repo.id, { name: 'after' }));
    expect((await refs('after')).status).toBe(200);
    expect((await refs('before')).status).toBe(404);
  });
});
