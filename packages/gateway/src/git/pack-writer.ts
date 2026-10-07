/**
 * Writes git objects and packs in the Worker, for the few objects the gateway itself puts in
 * a repository: a bean's status tag, and an empty first commit for a repository without one.
 * Objects are zlib-compressed (`CompressionStream('deflate')` is zlib) and the pack ends with
 * its SHA-1, as `git index-pack` expects.
 */
import { concatBytes } from './pkt-line';

export type GitObjectType = 'commit' | 'tree' | 'blob' | 'tag';

export type GitObject = {
  readonly type: GitObjectType;
  readonly body: Uint8Array;
  /** The object id: SHA-1 of `<type> <length>\0<body>`. */
  readonly id: string;
};

const TYPE_CODES: Readonly<Record<GitObjectType, number>> = { commit: 1, tree: 2, blob: 3, tag: 4 };
const encoder = new TextEncoder();

/** The empty tree, which every git repository can name without storing it. */
export const EMPTY_TREE_ID = '4b825dc642cb6eb9a060e54bf8d69288fbee4904';

/** A git object and its id. */
export async function gitObject(
  type: GitObjectType,
  body: string | Uint8Array,
): Promise<GitObject> {
  const bytes = typeof body === 'string' ? encoder.encode(body) : body;
  const header = encoder.encode(`${type} ${bytes.length}\0`);
  return { type, body: bytes, id: await sha1Hex(concatBytes([header, bytes])) };
}

/** Who the gateway signs its objects as, and when (`<unix seconds> +0000`). */
export type Signature = { readonly name: string; readonly email: string; readonly atMs: number };

function signatureLine(who: Signature): string {
  return `${who.name} <${who.email}> ${Math.floor(who.atMs / 1000)} +0000`;
}

/** An annotated tag object on a commit. */
export function annotatedTag(input: {
  object: string;
  tag: string;
  tagger: Signature;
  message: string;
}): Promise<GitObject> {
  const message = input.message.endsWith('\n') ? input.message : `${input.message}\n`;
  return gitObject(
    'tag',
    `object ${input.object}\ntype commit\ntag ${input.tag}\ntagger ${signatureLine(input.tagger)}\n\n${message}`,
  );
}

/** A commit object (no parents: a repository's first commit). */
export function commitObject(input: {
  tree: string;
  parents: readonly string[];
  author: Signature;
  message: string;
}): Promise<GitObject> {
  const parents = input.parents.map((parent) => `parent ${parent}\n`).join('');
  const who = signatureLine(input.author);
  return gitObject(
    'commit',
    `tree ${input.tree}\n${parents}author ${who}\ncommitter ${who}\n\n${input.message}\n`,
  );
}

/** A pack (version 2) holding `objects`, undeltified. */
export async function buildPack(objects: readonly GitObject[]): Promise<Uint8Array> {
  const header = new Uint8Array(12);
  header.set(encoder.encode('PACK'), 0);
  const view = new DataView(header.buffer);
  view.setUint32(4, 2);
  view.setUint32(8, objects.length);
  const entries = await Promise.all(
    objects.map(async (object) => concatBytes([entryHeader(object), await deflate(object.body)])),
  );
  const body = concatBytes([header, ...entries]);
  return concatBytes([body, await sha1Bytes(body)]);
}

/** Type and size: 3 type bits and 4 size bits, then 7 size bits per continued byte. */
function entryHeader(object: GitObject): Uint8Array {
  const bytes: number[] = [];
  let size = object.body.length;
  let byte = (TYPE_CODES[object.type] << 4) | (size & 0x0f);
  size = Math.floor(size / 16);
  while (size > 0) {
    bytes.push(byte | 0x80);
    byte = size & 0x7f;
    size = Math.floor(size / 128);
  }
  bytes.push(byte);
  return Uint8Array.from(bytes);
}

async function deflate(bytes: Uint8Array): Promise<Uint8Array> {
  const stream = new Blob([bytes]).stream().pipeThrough(new CompressionStream('deflate'));
  return new Uint8Array(await new Response(stream).arrayBuffer());
}

async function sha1Bytes(bytes: Uint8Array): Promise<Uint8Array> {
  return new Uint8Array(await crypto.subtle.digest('SHA-1', bytes));
}

async function sha1Hex(bytes: Uint8Array): Promise<string> {
  return [...(await sha1Bytes(bytes))].map((byte) => byte.toString(16).padStart(2, '0')).join('');
}
