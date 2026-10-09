import { createExecutionContext, env, runDurableObjectAlarm } from 'cloudflare:test';
import { describe, expect, it } from 'vitest';

import type { ActionsExecutor } from '../src/contract';
import { purgePrefix } from '../src/deps/forget';
import ActionsExecutorWorker from '../src/index';
import { chunkKey } from '../src/deps/index-do';
import type { DepsGrant } from '../src/deps/grant';
import { serveDeps } from '../src/deps/service';
import type { Manifest } from '../src/deps/wire';

const FAMILY = 'f'.repeat(64);
const KEY = '1'.repeat(64);

/** The fake gateway (vitest.config.ts) answers that ids starting with `gone_` do not exist. */
function grant(prefix: 'r' | 'gone' = 'r'): DepsGrant {
  return {
    repoId: `${prefix}_${crypto.randomUUID()}`,
    readScopes: ['stalk'],
    saveScope: 'stalk',
    sourceRef: 'refs/heads/stalk',
    snapshotMaxBytes: 1024 * 1024,
    tmpfsMaxBytes: 1024 * 1024,
  };
}

function postJson(access: DepsGrant, path: string, body: unknown): Promise<Response> {
  return serveDeps(
    new Request(`http://deps.internal${path}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
    }),
    env,
    access,
  );
}

async function sha256(text: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, '0')).join('');
}

/** One committed snapshot with one chunk, as a job's save leaves it. */
async function saveSnapshot(access: DepsGrant): Promise<string> {
  const body = `chunk of ${access.repoId}`;
  const sha = await sha256(body);
  await env.DEPS_CACHE.put(chunkKey(access.repoId, sha), body);
  const manifest: Manifest = {
    version: 1,
    snapshotKey: KEY,
    familyKey: FAMILY,
    chunkCount: 4,
    installDir: '.',
    lockfile: 'package-lock.json',
    packageManager: 'npm',
    platform: 'linux-x64-glibc',
    nodeMajor: '24',
    flags: '',
    extractedBytes: 100,
    files: 1,
    chunks: [{ sha256: sha, bytes: body.length, extractedBytes: 100, label: 'b00', packages: [] }],
  };
  const saved = await postJson(access, '/v1/commit', manifest);
  expect(await saved.json()).toEqual({ saved: true, reason: null });
  return sha;
}

async function keysUnder(repoId: string): Promise<string[]> {
  const listed = await env.DEPS_CACHE.list({ prefix: `deps/${repoId}/` });
  return listed.objects.map((object) => object.key);
}

/** The Worker's entrypoint, as the gateway's ACTIONS_EXECUTOR binding reaches it. */
function executor(): Pick<ActionsExecutor, 'forgetRepository'> {
  return new ActionsExecutorWorker(createExecutionContext(), env);
}

describe('forgetting a deleted repository', () => {
  it('deletes its snapshots and chunks in R2 and its index, and nothing of another repository', async () => {
    const deleted = grant();
    const kept = grant();
    await saveSnapshot(deleted);
    await saveSnapshot(kept);
    expect(await keysUnder(deleted.repoId)).toHaveLength(2);

    const outcome = await executor().forgetRepository(deleted.repoId);

    expect(outcome).toEqual({ ok: true, value: { purged: true, objectsDeleted: 2 } });
    expect(await keysUnder(deleted.repoId)).toEqual([]);
    expect(await keysUnder(kept.repoId)).toHaveLength(2);
    const index = env.DEPS_INDEX.getByName(deleted.repoId);
    expect(await index.summary()).toEqual({ snapshots: 0, totalBytes: 0, forgotten: true });
    expect(await env.DEPS_INDEX.getByName(kept.repoId).summary()).toMatchObject({
      snapshots: 1,
      forgotten: false,
    });
  });

  it('is idempotent', async () => {
    const access = grant();
    await saveSnapshot(access);
    await executor().forgetRepository(access.repoId);
    const again = await executor().forgetRepository(access.repoId);
    expect(again).toEqual({ ok: true, value: { purged: true, objectsDeleted: 0 } });
  });

  it('refuses an id that could name another prefix', async () => {
    const outcome = await executor().forgetRepository('../r_other');
    expect(outcome).toMatchObject({ ok: false, error: { code: 'invalid_request' } });
  });

  it('answers no snapshot and refuses a commit for a job still running after the delete', async () => {
    const access = grant();
    await saveSnapshot(access);
    await executor().forgetRepository(access.repoId);
    const lookup = await postJson(access, '/v1/lookup', { familyKey: FAMILY, snapshotKey: KEY });
    expect(await lookup.json()).toMatchObject({ match: 'none', manifest: null });
    const index = env.DEPS_INDEX.getByName(access.repoId);
    expect(await index.summary()).toMatchObject({ snapshots: 0, forgotten: true });
  });

  it('sweeps uploads that land after the delete a day later, then stops', async () => {
    const access = grant();
    await saveSnapshot(access);
    await executor().forgetRepository(access.repoId);
    await env.DEPS_CACHE.put(chunkKey(access.repoId, 'a'.repeat(64)), 'late upload');
    const index = env.DEPS_INDEX.getByName(access.repoId);

    expect(await runDurableObjectAlarm(index)).toBe(true);
    expect(await keysUnder(access.repoId)).toEqual([]);
    // It found something, so it looks once more; that sweep finds nothing and sets no alarm.
    expect(await runDurableObjectAlarm(index)).toBe(true);
    expect(await runDurableObjectAlarm(index)).toBe(false);
  });
});

describe('the daily sweep', () => {
  it('finds the cache of a repository the gateway no longer knows and forgets it', async () => {
    const orphan = grant('gone');
    await saveSnapshot(orphan);
    const index = env.DEPS_INDEX.getByName(orphan.repoId);

    expect(await runDurableObjectAlarm(index)).toBe(true);

    expect(await keysUnder(orphan.repoId)).toEqual([]);
    expect(await index.summary()).toMatchObject({ snapshots: 0, forgotten: true });
  });

  it('keeps a repository that exists', async () => {
    const access = grant();
    await saveSnapshot(access);
    const index = env.DEPS_INDEX.getByName(access.repoId);
    expect(await runDurableObjectAlarm(index)).toBe(true);
    expect(await keysUnder(access.repoId)).toHaveLength(2);
    expect(await index.summary()).toMatchObject({ snapshots: 1, forgotten: false });
  });

  it('is scheduled by a lookup alone, so chunks of a save that never committed are swept', async () => {
    const orphan = grant('gone');
    const lookup = await postJson(orphan, '/v1/lookup', { familyKey: FAMILY, snapshotKey: KEY });
    expect(await lookup.json()).toMatchObject({ match: 'none' });
    await env.DEPS_CACHE.put(chunkKey(orphan.repoId, 'b'.repeat(64)), 'uncommitted');

    expect(await runDurableObjectAlarm(env.DEPS_INDEX.getByName(orphan.repoId))).toBe(true);

    expect(await keysUnder(orphan.repoId)).toEqual([]);
  });

  it('keeps sweeping while a young unreferenced chunk is left', async () => {
    const access = grant();
    const lookup = await postJson(access, '/v1/lookup', { familyKey: FAMILY, snapshotKey: KEY });
    expect(await lookup.json()).toMatchObject({ match: 'none' });
    await env.DEPS_CACHE.put(chunkKey(access.repoId, 'c'.repeat(64)), 'in progress');
    const index = env.DEPS_INDEX.getByName(access.repoId);

    expect(await runDurableObjectAlarm(index)).toBe(true);

    expect(await keysUnder(access.repoId)).toEqual([chunkKey(access.repoId, 'c'.repeat(64))]);
    // The young chunk kept the alarm: the sweep runs again a day later.
    expect(await runDurableObjectAlarm(index)).toBe(true);
  });
});

describe('purgePrefix', () => {
  it('deletes more than one listing page and stops at the prefix', async () => {
    const prefix = `deps/r_${crypto.randomUUID()}/`;
    await Promise.all(
      Array.from({ length: 1205 }, async (_, index) =>
        env.DEPS_CACHE.put(`${prefix}chunks/${String(index).padStart(5, '0')}`, 'x'),
      ),
    );
    await env.DEPS_CACHE.put(`${prefix.slice(0, -1)}x/neighbour`, 'kept');

    expect(await purgePrefix(env.DEPS_CACHE, prefix)).toBe(1205);
    expect((await env.DEPS_CACHE.list({ prefix })).objects).toEqual([]);
    expect(await env.DEPS_CACHE.head(`${prefix.slice(0, -1)}x/neighbour`)).not.toBeNull();
  });
});
