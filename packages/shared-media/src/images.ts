/**
 * Uploaded images (avatars, org icons, repository social images) in the R2 bucket
 * `beanstalk-media`, served by the web host under `/media/<key>` with year-long immutable
 * caching: every key ends in a hash of the uploaded bytes, so a new picture is a new URL.
 *
 * Keys: `users/<id>/avatar/<hash>`, `orgs/<id>/icon/<hash>`, `repos/<id>/social/<hash>`. The
 * object at the key is the largest size; `<key>/<width>` are the smaller ones.
 *
 * With an Images binding the upload is re-encoded to WebP at each preset size (first frame of
 * a GIF, metadata gone). Without one (or if Images refuses it) the original is stored once,
 * with its location and camera metadata stripped, and served for every size.
 *
 * The contract other lanes use: `mediaStore(env).uploadImage(kind, ownerId, file)` → `{ key,
 * url }`, then `imageUrl(key, size)`; `pruneImages` after the new key is saved, so a replaced
 * picture's objects are deleted.
 */
import type { ImageFormat } from './image-format';
import { IMAGE_CONTENT_TYPES, sniffImage, stripMetadata } from './image-format';

export type ImageKind = 'user' | 'org' | 'repo';

/** The bindings: the bucket, and Cloudflare Images when the account has it. */
export type MediaEnv = {
  readonly MEDIA: R2Bucket;
  readonly IMAGES?: ImagesBinding | undefined;
};

/** Largest upload accepted, before anything is read. */
export const MAX_IMAGE_BYTES = 2 * 1024 * 1024;
/** Smallest and largest side, in pixels. */
export const MIN_IMAGE_SIDE = 16;
export const MAX_IMAGE_SIDE = 4096;

/** The widths each kind is stored at, largest first; avatars are square, social images 2:1. */
export const IMAGE_WIDTHS: Readonly<Record<ImageKind, readonly number[]>> = {
  user: [460, 128, 64],
  org: [460, 128, 64],
  repo: [1280, 640],
};

export type UploadedImage = {
  readonly key: string;
  /** The largest size's URL on the web host; `imageUrl(key, size)` for others. */
  readonly url: string;
  readonly width: number;
  readonly height: number;
  /** True when Images re-encoded it to WebP sizes; false when the stripped original is kept. */
  readonly normalized: boolean;
};

export type UploadRefusalCode =
  | 'empty'
  | 'too_large'
  | 'svg'
  | 'unsupported_type'
  | 'corrupt'
  | 'too_small'
  | 'too_big'
  | 'bad_owner';

export type UploadRefusal = { readonly code: UploadRefusalCode; readonly message: string };

export type UploadResult =
  | { readonly ok: true; readonly image: UploadedImage }
  | { readonly ok: false; readonly error: UploadRefusal };

/** Turns image bytes into one size (Cloudflare Images in production, a fake in tests). */
export type ImageResizer = {
  resize(bytes: Uint8Array<ArrayBuffer>, target: ResizeTarget): Promise<Uint8Array>;
};
export type ResizeTarget = { readonly width: number; readonly height: number };

export type MediaStore = {
  uploadImage(kind: ImageKind, ownerId: string, file: Blob): Promise<UploadResult>;
  /** Deletes every image of the owner's slot except `keep` (null: all of them). */
  pruneImages(kind: ImageKind, ownerId: string, keep: string | null): Promise<number>;
  /** Deletes one image and its sizes; a key that is not an image key is ignored. */
  deleteImage(key: string): Promise<void>;
  /** Everything stored for an owner (account or organisation deletion). */
  deleteOwnerMedia(kind: ImageKind, ownerId: string): Promise<number>;
};

/** The store over the env's bindings; `resizer` overrides the Images binding (tests). */
export function mediaStore(
  env: MediaEnv,
  options: { readonly resizer?: ImageResizer | null } = {},
): MediaStore {
  const resizer = options.resizer === undefined ? bindingResizer(env) : options.resizer;
  return {
    uploadImage: (kind, ownerId, file) => upload(env.MEDIA, resizer, { kind, ownerId, file }),
    pruneImages: (kind, ownerId, keep) => prune(env.MEDIA, slotPrefix(kind, ownerId), keep),
    deleteImage: async (key) => {
      if (parseImageKey(key) !== null) await prune(env.MEDIA, key, null, key);
    },
    deleteOwnerMedia: (kind, ownerId) => prune(env.MEDIA, `${KIND_DIRS[kind]}/${ownerId}/`, null),
  };
}

/** The web path of an image at a display size: the smallest stored width that covers it. */
export function imageUrl(key: string, size?: number): string {
  const parsed = parseImageKey(key);
  if (parsed === null || size === undefined) return `/media/${key}`;
  const widths = IMAGE_WIDTHS[parsed.kind];
  const largest = widths[0] ?? size;
  const fits = widths.filter((width) => width >= size);
  const width = fits.at(-1) ?? largest;
  return width === largest ? `/media/${key}` : `/media/${key}/${width}`;
}

/** Whether `key` is an image of this owner's slot (what a settings save may point at). */
export function isImageKeyOf(key: string, kind: ImageKind, ownerId: string): boolean {
  const parsed = parseImageKey(key);
  return parsed !== null && parsed.kind === kind && parsed.ownerId === ownerId;
}

export type ImageKeyParts = {
  readonly kind: ImageKind;
  readonly ownerId: string;
  readonly hash: string;
};

/** A key's parts, or null when it is not `<dir>/<owner>/<slot>/<hash>`. */
export function parseImageKey(key: string): ImageKeyParts | null {
  const match =
    /^(users|orgs|repos)\/([A-Za-z0-9_-]{1,64})\/(avatar|icon|social)\/([0-9a-f]{32})$/.exec(key);
  if (match === null) return null;
  const [, dir, ownerId, slot, hash] = match;
  const kind = KINDS_BY_DIR[dir ?? ''];
  if (kind === undefined || SLOTS[kind] !== slot || ownerId === undefined || hash === undefined)
    return null;
  return { kind, ownerId, hash };
}

/**
 * `GET /media/<path>`: the image with immutable caching, a 304 for a matching ETag, and a 404
 * (cached a minute) for anything else. Never serves a type other than the four image types.
 */
export async function serveImage(env: MediaEnv, request: Request, path: string): Promise<Response> {
  const target = mediaTarget(path);
  if (target === null) return notFound();
  const conditional = { onlyIf: request.headers };
  const variant =
    target.width === null
      ? null
      : await env.MEDIA.get(`${target.key}/${target.width}`, conditional);
  const object = variant ?? (await env.MEDIA.get(target.key, conditional));
  if (object === null) return notFound();
  const headers = imageHeaders(object);
  if (!hasBody(object)) return new Response(null, { status: 304, headers });
  return new Response(request.method === 'HEAD' ? null : object.body, { headers });
}

/** Cloudflare Images as a resizer: cover-crop to the target, WebP, first frame only. */
export function imagesResizer(images: ImagesBinding): ImageResizer {
  return {
    async resize(bytes, target) {
      const result = await images
        .input(new Blob([bytes]).stream())
        .transform({ width: target.width, height: target.height, fit: 'cover' })
        .output({ format: 'image/webp', quality: 85, anim: false });
      return new Uint8Array(await result.response().arrayBuffer());
    },
  };
}

function bindingResizer(env: MediaEnv): ImageResizer | null {
  return env.IMAGES === undefined ? null : imagesResizer(env.IMAGES);
}

const KIND_DIRS: Readonly<Record<ImageKind, string>> = {
  user: 'users',
  org: 'orgs',
  repo: 'repos',
};
const KINDS_BY_DIR: Readonly<Record<string, ImageKind>> = {
  users: 'user',
  orgs: 'org',
  repos: 'repo',
};
const SLOTS: Readonly<Record<ImageKind, string>> = { user: 'avatar', org: 'icon', repo: 'social' };
const IMMUTABLE = 'public, max-age=31536000, immutable';
const OWNER_ID = /^[A-Za-z0-9_-]{1,64}$/;

type UploadInput = {
  readonly kind: ImageKind;
  readonly ownerId: string;
  readonly file: Blob;
};

async function upload(
  bucket: R2Bucket,
  resizer: ImageResizer | null,
  input: UploadInput,
): Promise<UploadResult> {
  const { kind, ownerId, file } = input;
  if (!OWNER_ID.test(ownerId)) return refuse('bad_owner', 'That owner id is not valid.');
  if (file.size === 0) return refuse('empty', 'Choose an image file.');
  if (file.size > MAX_IMAGE_BYTES)
    return refuse('too_large', 'Images can be up to 2 MB. Pick a smaller one.');
  const bytes = new Uint8Array(await file.arrayBuffer());
  const sniffed = sniffImage(bytes);
  if (!sniffed.ok) return refuse(...sniffRefusal(sniffed.reason));
  const { width, height, format } = sniffed.image;
  if (Math.min(width, height) < MIN_IMAGE_SIDE)
    return refuse('too_small', `Use an image at least ${MIN_IMAGE_SIDE} pixels on each side.`);
  if (Math.max(width, height) > MAX_IMAGE_SIDE)
    return refuse('too_big', `Use an image at most ${MAX_IMAGE_SIDE} pixels on each side.`);
  const key = `${slotPrefix(kind, ownerId)}${await contentHash(bytes)}`;
  const normalized =
    resizer !== null && (await storeSizes(bucket, resizer, { key, kind, bytes, width, height }));
  if (!normalized) await storeOriginal(bucket, key, format, bytes, { width, height });
  return { ok: true, image: { key, url: imageUrl(key), width, height, normalized } };
}

type SizesInput = {
  readonly key: string;
  readonly kind: ImageKind;
  readonly bytes: Uint8Array<ArrayBuffer>;
  readonly width: number;
  readonly height: number;
};

/**
 * Every preset width through the resizer; false (nothing kept) when the resizer refuses, so
 * the caller stores the original instead. A refusal is an answer here, not a bug: Images
 * turns away files its decoder cannot read, and the account may be out of transformations.
 */
async function storeSizes(
  bucket: R2Bucket,
  resizer: ImageResizer,
  input: SizesInput,
): Promise<boolean> {
  const widths = IMAGE_WIDTHS[input.kind];
  const ratio = input.kind === 'repo' ? 0.5 : 1;
  const resized = await Promise.all(
    widths.map((width) =>
      resizer
        .resize(input.bytes, { width, height: Math.round(width * ratio) })
        .then((bytes) => ({ width, bytes }))
        .catch((error: unknown) => ({ width, error })),
    ),
  );
  if (resized.some((size) => 'error' in size)) return false;
  await Promise.all(
    resized.map((size, index) => {
      if (!('bytes' in size)) return Promise.resolve(null);
      const objectKey = index === 0 ? input.key : `${input.key}/${size.width}`;
      return bucket.put(objectKey, size.bytes, {
        httpMetadata: { contentType: 'image/webp', cacheControl: IMMUTABLE },
        customMetadata: {
          width: String(size.width),
          height: String(Math.round(size.width * ratio)),
        },
      });
    }),
  );
  return true;
}

async function storeOriginal(
  bucket: R2Bucket,
  key: string,
  format: ImageFormat,
  bytes: Uint8Array,
  size: { readonly width: number; readonly height: number },
): Promise<void> {
  await bucket.put(key, stripMetadata(format, bytes), {
    httpMetadata: { contentType: `image/${format}`, cacheControl: IMMUTABLE },
    customMetadata: { width: String(size.width), height: String(size.height) },
  });
}

/** Deletes objects under `prefix`, keeping `keep` and its sizes; `only` limits to one image. */
async function prune(
  bucket: R2Bucket,
  prefix: string,
  keep: string | null,
  only?: string,
): Promise<number> {
  let deleted = 0;
  let cursor: string | undefined;
  do {
    // oxlint-disable-next-line no-await-in-loop -- R2 lists one page at a time, each from the last cursor
    const page = await bucket.list({ prefix, ...(cursor === undefined ? {} : { cursor }) });
    const doomed = page.objects
      .map((object) => object.key)
      .filter((key) => keep === null || (key !== keep && !key.startsWith(`${keep}/`)))
      .filter((key) => only === undefined || key === only || key.startsWith(`${only}/`));
    // oxlint-disable-next-line no-await-in-loop -- a page is deleted before the next is listed
    if (doomed.length > 0) await bucket.delete(doomed);
    deleted += doomed.length;
    cursor = page.truncated ? page.cursor : undefined;
  } while (cursor !== undefined);
  return deleted;
}

function slotPrefix(kind: ImageKind, ownerId: string): string {
  return `${KIND_DIRS[kind]}/${ownerId}/${SLOTS[kind]}/`;
}

/** 128 bits of SHA-256, hex: the same file always lands on the same key. */
async function contentHash(bytes: Uint8Array<ArrayBuffer>): Promise<string> {
  const digest = new Uint8Array(await crypto.subtle.digest('SHA-256', bytes));
  return Array.from(digest.subarray(0, 16), (byte) => byte.toString(16).padStart(2, '0')).join('');
}

function mediaTarget(path: string): { readonly key: string; readonly width: number | null } | null {
  const segments = path.split('/');
  const last = segments.at(-1) ?? '';
  const hasWidth = segments.length === 5 && /^\d{2,4}$/.test(last);
  const key = hasWidth ? segments.slice(0, 4).join('/') : path;
  const parsed = parseImageKey(key);
  if (parsed === null) return null;
  if (!hasWidth) return { key, width: null };
  const width = Number(last);
  return IMAGE_WIDTHS[parsed.kind].includes(width) ? { key, width } : null;
}

function imageHeaders(object: R2Object): Headers {
  const stored = object.httpMetadata?.contentType ?? '';
  return new Headers({
    'content-type': IMAGE_CONTENT_TYPES.has(stored) ? stored : 'application/octet-stream',
    'cache-control': IMMUTABLE,
    etag: object.httpEtag,
    'x-content-type-options': 'nosniff',
    'content-security-policy': "default-src 'none'; sandbox",
  });
}

/** R2 answers an object without a body when the request's preconditions (If-None-Match) fail. */
function hasBody(object: R2Object): object is R2ObjectBody {
  return 'body' in object;
}

function notFound(): Response {
  return new Response('Not found', {
    status: 404,
    headers: { 'cache-control': 'public, max-age=60', 'content-type': 'text/plain' },
  });
}

function sniffRefusal(reason: 'unsupported' | 'svg' | 'corrupt'): [UploadRefusalCode, string] {
  switch (reason) {
    case 'svg':
      return [
        'svg',
        'SVG files can carry scripts, so they are not taken. Use PNG, JPEG, WebP or GIF.',
      ];
    case 'corrupt':
      return ['corrupt', 'That image could not be read. Try saving it again.'];
    case 'unsupported':
      return ['unsupported_type', 'Use a PNG, JPEG, WebP or GIF image.'];
    default:
      return assertNever(reason);
  }
}

function refuse(code: UploadRefusalCode, message: string): UploadResult {
  return { ok: false, error: { code, message } };
}

function assertNever(value: never): never {
  throw new Error(`unexpected value: ${String(value)}`);
}
