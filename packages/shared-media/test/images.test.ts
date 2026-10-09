import { env } from 'cloudflare:test';
import { beforeEach, describe, expect, it } from 'vitest';

import { fallbackAvatar, fallbackAvatarSvg, initialsOf } from '../src/fallback-avatar';
import type { ImageResizer, ResizeTarget } from '../src/images';
import {
  MAX_IMAGE_BYTES,
  imageUrl,
  isImageKeyOf,
  mediaStore,
  parseImageKey,
  serveImage,
} from '../src/images';
import { ascii, gif, includesText, jpeg, png, webpExtended } from './fixtures';

/** Records each size asked for and answers with bytes naming it. */
function recordingResizer(): ImageResizer & { readonly calls: ResizeTarget[] } {
  const calls: ResizeTarget[] = [];
  return {
    calls,
    resize(_bytes, target) {
      calls.push(target);
      return Promise.resolve(Uint8Array.from(ascii(`webp ${target.width}x${target.height}`)));
    },
  };
}

const refusingResizer: ImageResizer = {
  resize: () => Promise.reject(new Error('ERROR 9422: transformations quota')),
};

const plain = () => mediaStore(env, { resizer: null });

async function allKeys(): Promise<string[]> {
  const listed = await env.MEDIA.list();
  return listed.objects.map((object) => object.key).toSorted();
}

beforeEach(async () => {
  const keys = await allKeys();
  if (keys.length > 0) await env.MEDIA.delete(keys);
});

describe('uploadImage: validation', () => {
  it('refuses an empty file and one over 2 MB before reading it', async () => {
    const empty = await plain().uploadImage('user', 'u_1', new Blob([]));
    expect(empty).toMatchObject({ ok: false, error: { code: 'empty' } });
    const huge = new Blob([png(100, 100), new Uint8Array(MAX_IMAGE_BYTES)]);
    const large = await plain().uploadImage('user', 'u_1', huge);
    expect(large).toMatchObject({ ok: false, error: { code: 'too_large' } });
    expect(await allKeys()).toEqual([]);
  });

  it('accepts exactly 2 MB', async () => {
    const header = png(100, 100);
    const padded = new Blob([header, new Uint8Array(MAX_IMAGE_BYTES - header.length)]);
    expect(await plain().uploadImage('user', 'u_1', padded)).toMatchObject({ ok: true });
  });

  it('refuses SVG and non-images whatever the browser said they were', async () => {
    const svg = new Blob(['<svg xmlns="http://www.w3.org/2000/svg"/>'], { type: 'image/png' });
    expect(await plain().uploadImage('user', 'u_1', svg)).toMatchObject({
      ok: false,
      error: { code: 'svg' },
    });
    const html = new Blob(['<html><script>alert(1)</script>'], { type: 'image/jpeg' });
    expect(await plain().uploadImage('user', 'u_1', html)).toMatchObject({
      ok: false,
      error: { code: 'unsupported_type' },
    });
  });

  it('refuses images under 16 or over 4096 pixels a side', async () => {
    expect(await plain().uploadImage('user', 'u_1', new Blob([png(15, 200)]))).toMatchObject({
      ok: false,
      error: { code: 'too_small' },
    });
    expect(await plain().uploadImage('user', 'u_1', new Blob([gif(4097, 10)]))).toMatchObject({
      ok: false,
      error: { code: 'too_small' },
    });
    expect(
      await plain().uploadImage('repo', 'r1', new Blob([webpExtended(5000, 2000)])),
    ).toMatchObject({ ok: false, error: { code: 'too_big' } });
  });

  it('refuses an owner id that could escape its folder', async () => {
    expect(await plain().uploadImage('user', '../orgs/x', new Blob([png(64, 64)]))).toMatchObject({
      ok: false,
      error: { code: 'bad_owner' },
    });
  });
});

describe('uploadImage: key layout and sizes', () => {
  it('stores each kind under its own folder, named by a content hash', async () => {
    const store = plain();
    const user = await store.uploadImage('user', 'u_abc', new Blob([png(64, 64)]));
    const org = await store.uploadImage('org', 'o_acme', new Blob([png(64, 64)]));
    const repo = await store.uploadImage('repo', 'k3x9', new Blob([png(1280, 640)]));
    if (!user.ok || !org.ok || !repo.ok) throw new Error('uploads failed');
    expect(user.image.key).toMatch(/^users\/u_abc\/avatar\/[0-9a-f]{32}$/);
    expect(org.image.key).toMatch(/^orgs\/o_acme\/icon\/[0-9a-f]{32}$/);
    expect(repo.image.key).toMatch(/^repos\/k3x9\/social\/[0-9a-f]{32}$/);
    // Same bytes, same hash: the user's and org's avatars share it, in different folders.
    expect(user.image.key.split('/')[3]).toBe(org.image.key.split('/')[3]);
    expect(user.image.url).toBe(`/media/${user.image.key}`);
  });

  it('without Images keeps the stripped original once', async () => {
    const photo = jpeg(800, 800, { orientation: 6, gps: 'GPS 51.5N' });
    const result = await plain().uploadImage('user', 'u_1', new Blob([photo]));
    if (!result.ok) throw new Error(result.error.message);
    expect(result.image.normalized).toBe(false);
    expect(await allKeys()).toEqual([result.image.key]);
    const stored = await env.MEDIA.get(result.image.key);
    const bytes = new Uint8Array(
      await (stored?.arrayBuffer() ?? Promise.resolve(new ArrayBuffer(0))),
    );
    expect(stored?.httpMetadata?.contentType).toBe('image/jpeg');
    expect(includesText(bytes, 'GPS 51.5N')).toBe(false);
  });

  it('with Images stores WebP at every preset: square avatars, 2:1 social images', async () => {
    const resizer = recordingResizer();
    const store = mediaStore(env, { resizer });
    const avatar = await store.uploadImage('user', 'u_1', new Blob([png(900, 600)]));
    const social = await store.uploadImage('repo', 'r1', new Blob([png(1600, 900)]));
    if (!avatar.ok || !social.ok) throw new Error('uploads failed');
    expect(resizer.calls).toEqual([
      { width: 460, height: 460 },
      { width: 128, height: 128 },
      { width: 64, height: 64 },
      { width: 1280, height: 640 },
      { width: 640, height: 320 },
    ]);
    expect(await allKeys()).toEqual(
      [
        avatar.image.key,
        `${avatar.image.key}/128`,
        `${avatar.image.key}/64`,
        social.image.key,
        `${social.image.key}/640`,
      ].toSorted(),
    );
    const largest = await env.MEDIA.get(avatar.image.key);
    expect(largest?.httpMetadata?.contentType).toBe('image/webp');
    expect(await largest?.text()).toBe('webp 460x460');
  });

  it('falls back to the original when Images refuses', async () => {
    const store = mediaStore(env, { resizer: refusingResizer });
    const result = await store.uploadImage('user', 'u_1', new Blob([gif(32, 32)]));
    expect(result).toMatchObject({ ok: true, image: { normalized: false } });
    expect(await allKeys()).toHaveLength(1);
  });
});

describe('replace and delete', () => {
  it('prunes the previous picture and its sizes once the new key is saved', async () => {
    const store = mediaStore(env, { resizer: recordingResizer() });
    const first = await store.uploadImage('user', 'u_1', new Blob([png(64, 64)]));
    const second = await store.uploadImage('user', 'u_1', new Blob([png(65, 65)]));
    const other = await store.uploadImage('user', 'u_2', new Blob([png(64, 64)]));
    if (!first.ok || !second.ok || !other.ok) throw new Error('uploads failed');
    expect(await store.pruneImages('user', 'u_1', second.image.key)).toBe(3);
    const keys = await allKeys();
    expect(keys.filter((key) => key.startsWith('users/u_1/'))).toEqual(
      [second.image.key, `${second.image.key}/128`, `${second.image.key}/64`].toSorted(),
    );
    expect(keys.filter((key) => key.startsWith('users/u_2/'))).toHaveLength(3);
  });

  it('deletes one image, or everything an owner has', async () => {
    const store = plain();
    const avatar = await store.uploadImage('user', 'u_1', new Blob([png(64, 64)]));
    await store.uploadImage('repo', 'r1', new Blob([png(64, 64)]));
    if (!avatar.ok) throw new Error('upload failed');
    await store.deleteImage(avatar.image.key);
    await store.deleteImage('users/u_1/../../repos'); // not a key: ignored
    expect(await allKeys()).toHaveLength(1);
    expect(await store.deleteOwnerMedia('repo', 'r1')).toBe(1);
    expect(await allKeys()).toEqual([]);
  });
});

describe('imageUrl and keys', () => {
  const key = 'users/u_1/avatar/0123456789abcdef0123456789abcdef';

  it('picks the smallest stored width that covers the display size', () => {
    expect(imageUrl(key, 40)).toBe(`/media/${key}/64`);
    expect(imageUrl(key, 64)).toBe(`/media/${key}/64`);
    expect(imageUrl(key, 100)).toBe(`/media/${key}/128`);
    expect(imageUrl(key, 300)).toBe(`/media/${key}`);
    expect(imageUrl(key, 2000)).toBe(`/media/${key}`);
    expect(imageUrl(key)).toBe(`/media/${key}`);
  });

  it('knows whose slot a key is in, so a save cannot point at someone else’s picture', () => {
    expect(isImageKeyOf(key, 'user', 'u_1')).toBe(true);
    expect(isImageKeyOf(key, 'user', 'u_2')).toBe(false);
    expect(isImageKeyOf(key, 'org', 'u_1')).toBe(false);
    expect(parseImageKey('users/u_1/icon/0123456789abcdef0123456789abcdef')).toBeNull();
    expect(parseImageKey(`${key}/64`)).toBeNull();
  });
});

describe('serveImage', () => {
  it('serves with immutable caching, answers 304 for its ETag, and serves sizes', async () => {
    const store = mediaStore(env, { resizer: recordingResizer() });
    const uploaded = await store.uploadImage('user', 'u_1', new Blob([png(64, 64)]));
    if (!uploaded.ok) throw new Error('upload failed');
    const path = uploaded.image.key;
    const first = await serveImage(env, new Request(`https://w.test/media/${path}`), path);
    expect(first.status).toBe(200);
    expect(first.headers.get('cache-control')).toBe('public, max-age=31536000, immutable');
    expect(first.headers.get('content-type')).toBe('image/webp');
    expect(first.headers.get('x-content-type-options')).toBe('nosniff');
    expect(await first.text()).toBe('webp 460x460');
    const etag = first.headers.get('etag') ?? '';
    const again = await serveImage(
      env,
      new Request(`https://w.test/media/${path}`, { headers: { 'if-none-match': etag } }),
      path,
    );
    expect(again.status).toBe(304);
    const small = await serveImage(env, new Request('https://w.test/'), `${path}/64`);
    expect(await small.text()).toBe('webp 64x64');
  });

  it('serves the original for any size when only the original is stored', async () => {
    const uploaded = await plain().uploadImage('user', 'u_1', new Blob([png(64, 64)]));
    if (!uploaded.ok) throw new Error('upload failed');
    const response = await serveImage(
      env,
      new Request('https://w.test/'),
      `${uploaded.image.key}/64`,
    );
    expect(response.status).toBe(200);
    expect(response.headers.get('content-type')).toBe('image/png');
  });

  it('404s on anything that is not an image key or a preset size', async () => {
    const key = 'users/u_1/avatar/0123456789abcdef0123456789abcdef';
    const paths = [key, `${key}/65`, 'users/u_1/avatar', '../secrets', `${key}/64/x`];
    const responses = await Promise.all(
      paths.map((path) => serveImage(env, new Request('https://w.test/'), path)),
    );
    expect(responses.map((response) => response.status)).toEqual(paths.map(() => 404));
  });
});

describe('fallback avatars', () => {
  it('takes one or two initials', () => {
    expect(initialsOf('Coop Smith')).toBe('CS');
    expect(initialsOf('dana')).toBe('D');
    expect(initialsOf('@acme-labs')).toBe('AL');
    expect(initialsOf('  ')).toBe('?');
  });

  it('is stable per seed, mirrored, and escapes what it draws', () => {
    const avatar = fallbackAvatar('u_123', 'Coop');
    expect(fallbackAvatar('u_123', 'Other name').hue).toBe(avatar.hue);
    for (const row of avatar.cells) expect(row).toEqual(row.toReversed());
    const svg = fallbackAvatarSvg({ ...avatar, initials: '<&' }, 'initials');
    expect(svg).not.toContain('<&');
    expect(svg).toContain('&#60;&#38;');
    expect(fallbackAvatarSvg(avatar, 'identicon')).toContain('<rect');
  });
});
