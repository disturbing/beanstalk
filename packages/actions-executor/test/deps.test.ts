import { env } from 'cloudflare:test';
import { describe, expect, it } from 'vitest';

import { grantFor, parseSize, readDepsSettings, sameToken } from '../src/deps/grant';
import type { DepsGrant } from '../src/deps/grant';
import { chunkKey } from '../src/deps/index-do';
import { serveDeps } from '../src/deps/service';
import type { Manifest } from '../src/deps/wire';
import { spec } from './fake-ports';

const MIB = 1024 * 1024;

function grant(overrides: Partial<DepsGrant> = {}): DepsGrant {
  return {
    repoId: `r_${crypto.randomUUID()}`,
    readScopes: ['stalk'],
    saveScope: 'stalk',
    sourceRef: 'refs/heads/stalk',
    snapshotMaxBytes: 4 * 1024 * MIB,
    tmpfsMaxBytes: 6 * 1024 * MIB,
    ...overrides,
  };
}

async function sha256(bytes: Uint8Array): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', bytes);
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, '0')).join('');
}

function call(access: DepsGrant, path: string, init: RequestInit = {}): Promise<Response> {
  return serveDeps(new Request(`http://deps.internal${path}`, init), env, access);
}

function postJson(access: DepsGrant, path: string, body: unknown): Promise<Response> {
  return call(access, path, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
}

async function upload(access: DepsGrant, body: Uint8Array): Promise<string> {
  const sha = await sha256(body);
  const response = await call(access, `/v1/chunks/${sha}`, {
    method: 'PUT',
    headers: { 'content-length': String(body.byteLength) },
    body,
  });
  expect(response.status).toBe(200);
  return sha;
}

function manifest(input: {
  readonly family: string;
  readonly snapshot: string;
  readonly chunks: readonly { readonly sha256: string; readonly bytes: number }[];
}): Manifest {
  return {
    version: 1,
    snapshotKey: input.snapshot,
    familyKey: input.family,
    chunkCount: 4,
    installDir: '.',
    lockfile: 'package-lock.json',
    packageManager: 'npm',
    platform: 'linux-x64-glibc',
    nodeMajor: '24',
    flags: '',
    extractedBytes: 1000,
    files: 3,
    chunks: input.chunks.map((chunk, index) => ({
      ...chunk,
      extractedBytes: 100,
      label: `b0${index}`,
      packages: [],
    })),
  };
}

const FAMILY = 'f'.repeat(64);
const KEY_ONE = '1'.repeat(64);
const KEY_TWO = '2'.repeat(64);

describe('the dependency cache service', () => {
  it('misses, saves, then answers an exact hit and a partial one for the same family', async () => {
    const access = grant();
    const miss = await postJson(access, '/v1/lookup', { familyKey: FAMILY, snapshotKey: KEY_ONE });
    expect(await miss.json()).toMatchObject({ match: 'none', canSave: true, chunkCount: null });
    const body = new TextEncoder().encode('chunk one');
    const sha = await upload(access, body);
    const missing = await postJson(access, '/v1/missing', { chunks: [sha, 'a'.repeat(64)] });
    expect(await missing.json()).toEqual({ missing: ['a'.repeat(64)] });
    const saved = await postJson(
      access,
      '/v1/commit',
      manifest({
        family: FAMILY,
        snapshot: KEY_ONE,
        chunks: [{ sha256: sha, bytes: body.byteLength }],
      }),
    );
    expect(await saved.json()).toEqual({ saved: true, reason: null });
    const exact = await postJson(access, '/v1/lookup', { familyKey: FAMILY, snapshotKey: KEY_ONE });
    expect(await exact.json()).toMatchObject({ match: 'exact', chunkCount: 4 });
    const partial = await postJson(access, '/v1/lookup', {
      familyKey: FAMILY,
      snapshotKey: KEY_TWO,
    });
    const answer: { match: string; manifest: Manifest } = await partial.json();
    expect(answer.match).toBe('partial');
    expect(answer.manifest.snapshotKey).toBe(KEY_ONE);
    const chunk = await call(access, `/v1/chunks/${sha}`);
    expect(new TextDecoder().decode(await chunk.arrayBuffer())).toBe('chunk one');
  });

  it('refuses a chunk whose body does not hash to its name and keeps nothing', async () => {
    const access = grant();
    const wrong = 'b'.repeat(64);
    const response = await call(access, `/v1/chunks/${wrong}`, {
      method: 'PUT',
      headers: { 'content-length': '5' },
      body: new TextEncoder().encode('hello'),
    });
    expect(response.status).toBe(400);
    expect(await env.DEPS_CACHE.head(chunkKey(access.repoId, wrong))).toBeNull();
  });

  it('commits nothing whose chunks were not uploaded', async () => {
    const access = grant();
    const response = await postJson(
      access,
      '/v1/commit',
      manifest({
        family: FAMILY,
        snapshot: KEY_ONE,
        chunks: [{ sha256: 'c'.repeat(64), bytes: 10 }],
      }),
    );
    expect(await response.json()).toMatchObject({ saved: false });
  });

  it('refuses a snapshot over the cap and keeps the previous one', async () => {
    const access = grant({ snapshotMaxBytes: 4 });
    const sha = await upload(access, new TextEncoder().encode('too big'));
    const refused = await postJson(
      access,
      '/v1/commit',
      manifest({ family: FAMILY, snapshot: KEY_ONE, chunks: [{ sha256: sha, bytes: 7 }] }),
    );
    expect(await refused.json()).toMatchObject({ saved: false });
    const lookup = await postJson(access, '/v1/lookup', {
      familyKey: FAMILY,
      snapshotKey: KEY_ONE,
    });
    expect(await lookup.json()).toMatchObject({ match: 'none' });
  });

  it('lets a read-only run read but never write', async () => {
    const access = grant({ saveScope: null });
    const body = new TextEncoder().encode('x');
    const put = await call(access, `/v1/chunks/${await sha256(body)}`, {
      method: 'PUT',
      headers: { 'content-length': '1' },
      body,
    });
    expect(put.status).toBe(403);
    const commit = await postJson(access, '/v1/commit', {});
    expect(commit.status).toBe(403);
    const lookup = await postJson(access, '/v1/lookup', {
      familyKey: FAMILY,
      snapshotKey: KEY_ONE,
    });
    expect(await lookup.json()).toMatchObject({ match: 'none', canSave: false });
  });

  it('never shows one repository the snapshots of another', async () => {
    const owner = grant();
    const body = new TextEncoder().encode('private');
    const sha = await upload(owner, body);
    await postJson(
      owner,
      '/v1/commit',
      manifest({
        family: FAMILY,
        snapshot: KEY_ONE,
        chunks: [{ sha256: sha, bytes: body.byteLength }],
      }),
    );
    const other = grant();
    const lookup = await postJson(other, '/v1/lookup', { familyKey: FAMILY, snapshotKey: KEY_ONE });
    expect(await lookup.json()).toMatchObject({ match: 'none' });
    expect((await call(other, `/v1/chunks/${sha}`)).status).toBe(404);
  });

  it('uploads a chunk in parts and checks the whole', async () => {
    const access = grant();
    const body = new Uint8Array(6 * MIB).map((_, index) => index % 251);
    const sha = await sha256(body);
    const started = await postJson(access, `/v1/uploads/${sha}`, {});
    const { uploadId }: { uploadId: string } = await started.json();
    const parts = [];
    for (const [index, start] of [0, 5 * MIB].entries()) {
      const part = body.slice(start, Math.min(start + 5 * MIB, body.byteLength));
      // oxlint-disable-next-line no-await-in-loop -- parts in order
      const response = await call(
        access,
        `/v1/uploads/${sha}/${index + 1}?uploadId=${encodeURIComponent(uploadId)}`,
        {
          method: 'PUT',
          headers: { 'content-length': String(part.byteLength) },
          body: part,
        },
      );
      // oxlint-disable-next-line no-await-in-loop -- parts in order
      parts.push(await response.json());
    }
    const done = await postJson(access, `/v1/uploads/${sha}/complete`, { uploadId, parts });
    expect(await done.json()).toEqual({ stored: 'new' });
  });
});

describe('the grant', () => {
  const settings = readDepsSettings(env);

  it('lets only default-branch pushes save', () => {
    expect(
      grantFor(spec({ depsCache: { scope: 'stalk', canSave: true } }), settings)?.saveScope,
    ).toBe('stalk');
    expect(
      grantFor(spec({ depsCache: { scope: 'stalk', canSave: false } }), settings)?.saveScope,
    ).toBeNull();
    expect(grantFor(spec(), settings)?.saveScope).toBeNull();
  });

  it('takes the snapshot cap from a variable, never above the repository total', () => {
    const smaller = grantFor(spec({ vars: { GITSTALK_DEPS_SNAPSHOT_MAX: '2GiB' } }), settings);
    expect(smaller?.snapshotMaxBytes).toBe(2 * 1024 ** 3);
    const huge = grantFor(spec({ vars: { GITSTALK_DEPS_SNAPSHOT_MAX: '1TB' } }), settings);
    expect(huge?.snapshotMaxBytes).toBe(settings.repoMaxBytes);
    expect(grantFor(spec({ vars: { GITSTALK_DEPS_CACHE: 'off' } }), settings)).toBeNull();
  });

  it('still reads the variables from before the rename (BEANSTALK_*), the current name winning', () => {
    const legacy = grantFor(spec({ vars: { BEANSTALK_DEPS_SNAPSHOT_MAX: '2GiB' } }), settings);
    expect(legacy?.snapshotMaxBytes).toBe(2 * 1024 ** 3);
    expect(grantFor(spec({ vars: { BEANSTALK_DEPS_CACHE: 'off' } }), settings)).toBeNull();
    const both = { BEANSTALK_DEPS_CACHE: 'off', GITSTALK_DEPS_CACHE: 'on' };
    expect(grantFor(spec({ vars: both }), settings)).not.toBeNull();
  });

  it('reads sizes people write', () => {
    expect(parseSize('4GiB')).toBe(4 * 1024 ** 3);
    expect(parseSize('500 MB')).toBe(500_000_000);
    expect(parseSize('lots')).toBeNull();
  });

  it('compares bearers whole', () => {
    expect(sameToken('abc', 'abc')).toBe(true);
    expect(sameToken('abc', 'abd')).toBe(false);
    expect(sameToken('ab', 'abc')).toBe(false);
  });
});
