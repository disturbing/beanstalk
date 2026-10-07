/**
 * Writes a small git history as a packfile: the gateway seeds a new repository's first commit
 * (a README, or a template's files) itself, so no token leaves it. Objects are stored whole
 * (no deltas), zlib-compressed, as git's pack format v2 describes; ids are git's SHA-1s.
 */

/** A file of the commit: a path inside the repo and its text. */
export type SeedFile = { readonly path: string; readonly content: string };

export type SeedCommit = {
  readonly files: readonly SeedFile[];
  readonly message: string;
  readonly author: { readonly name: string; readonly email: string };
  /** Unix seconds. */
  readonly time: number;
};

/** The pack and the id of the commit it carries. */
export type SeedPack = { readonly commit: string; readonly pack: Uint8Array };

type GitObject = { readonly kind: 'blob' | 'tree' | 'commit'; readonly body: Uint8Array };
type TreeEntry = { readonly name: string; readonly mode: '100644' | '40000'; readonly id: string };

const encoder = new TextEncoder();
const PACK_TYPE: Readonly<Record<GitObject['kind'], number>> = { commit: 1, tree: 2, blob: 3 };

/** A root commit of `files`, as a pack holding the commit, its trees and its blobs. */
export async function seedPack(seed: SeedCommit): Promise<SeedPack> {
  const objects = new Map<string, GitObject>();
  const tree = await storeTree(objects, nestFiles(seed.files));
  const commitBody = encoder.encode(commitText(tree, seed));
  const commit = await store(objects, { kind: 'commit', body: commitBody });
  return { commit, pack: await packOf([...objects.values()]) };
}

/** A pack with no objects: a push that only creates refs to commits the remote has. */
export function emptyPack(): Promise<Uint8Array> {
  return packOf([]);
}

/** Git's id of an object: SHA-1 of `<kind> <size>\0<body>`, as 40 hex characters. */
export async function objectId(object: GitObject): Promise<string> {
  return hex(await sha1(concat([header(object), object.body])));
}

type Directory = { readonly files: Map<string, string>; readonly dirs: Map<string, Directory> };

function nestFiles(files: readonly SeedFile[]): Directory {
  const root: Directory = { files: new Map(), dirs: new Map() };
  for (const file of files) {
    const parts = file.path.split('/');
    const name = parts.pop() ?? file.path;
    let directory = root;
    for (const part of parts) {
      const next = directory.dirs.get(part) ?? { files: new Map(), dirs: new Map() };
      directory.dirs.set(part, next);
      directory = next;
    }
    directory.files.set(name, file.content);
  }
  return root;
}

async function storeTree(objects: Map<string, GitObject>, directory: Directory): Promise<string> {
  const entries: TreeEntry[] = [];
  for (const [name, content] of directory.files) {
    // oxlint-disable-next-line no-await-in-loop -- objects are stored in order; trees are tiny
    const id = await store(objects, { kind: 'blob', body: encoder.encode(content) });
    entries.push({ name, mode: '100644', id });
  }
  for (const [name, child] of directory.dirs) {
    // oxlint-disable-next-line no-await-in-loop -- a subtree's id is needed before its parent's
    entries.push({ name, mode: '40000', id: await storeTree(objects, child) });
  }
  return store(objects, { kind: 'tree', body: treeBody(entries) });
}

/** Git sorts tree entries by name, comparing a directory as if its name ended in `/`. */
function treeBody(entries: readonly TreeEntry[]): Uint8Array {
  const sortKey = (entry: TreeEntry): string =>
    entry.mode === '40000' ? `${entry.name}/` : entry.name;
  const sorted = entries.toSorted((a, b) => compareBytes(sortKey(a), sortKey(b)));
  return concat(
    sorted.flatMap((entry) => [encoder.encode(`${entry.mode} ${entry.name}\0`), unhex(entry.id)]),
  );
}

function commitText(tree: string, seed: SeedCommit): string {
  const who = `${seed.author.name} <${seed.author.email}> ${Math.trunc(seed.time)} +0000`;
  const message = seed.message.endsWith('\n') ? seed.message : `${seed.message}\n`;
  return `tree ${tree}\nauthor ${who}\ncommitter ${who}\n\n${message}`;
}

async function store(objects: Map<string, GitObject>, object: GitObject): Promise<string> {
  const id = await objectId(object);
  objects.set(id, object);
  return id;
}

async function packOf(objects: readonly GitObject[]): Promise<Uint8Array> {
  const head = new Uint8Array(12);
  head.set(encoder.encode('PACK'), 0);
  const view = new DataView(head.buffer);
  view.setUint32(4, 2);
  view.setUint32(8, objects.length);
  const parts: Uint8Array[] = [head];
  for (const object of objects) {
    parts.push(entryHeader(PACK_TYPE[object.kind], object.body.length));
    // oxlint-disable-next-line no-await-in-loop -- entries are written in order
    parts.push(await deflate(object.body));
  }
  const body = concat(parts);
  return concat([body, await sha1(body)]);
}

/** A pack entry's header: type in bits 4–6 of the first byte, size as a little-endian varint. */
function entryHeader(type: number, size: number): Uint8Array {
  const bytes: number[] = [];
  let rest = Math.floor(size / 16);
  let byte = (type << 4) | (size & 0x0f);
  while (rest > 0) {
    bytes.push(byte | 0x80);
    byte = rest & 0x7f;
    rest = Math.floor(rest / 128);
  }
  bytes.push(byte);
  return Uint8Array.from(bytes);
}

function header(object: GitObject): Uint8Array {
  return encoder.encode(`${object.kind} ${object.body.length}\0`);
}

/** zlib (RFC 1950) compression, which is what `CompressionStream('deflate')` produces. */
async function deflate(bytes: Uint8Array): Promise<Uint8Array> {
  const stream = new Blob([bytes]).stream().pipeThrough(new CompressionStream('deflate'));
  return new Uint8Array(await new Response(stream).arrayBuffer());
}

async function sha1(bytes: Uint8Array): Promise<Uint8Array> {
  return new Uint8Array(await crypto.subtle.digest('SHA-1', bytes));
}

function concat(parts: readonly Uint8Array[]): Uint8Array {
  const out = new Uint8Array(parts.reduce((total, part) => total + part.length, 0));
  let offset = 0;
  for (const part of parts) {
    out.set(part, offset);
    offset += part.length;
  }
  return out;
}

function compareBytes(a: string, b: string): number {
  const left = encoder.encode(a);
  const right = encoder.encode(b);
  for (let index = 0; index < Math.min(left.length, right.length); index += 1) {
    const difference = (left[index] ?? 0) - (right[index] ?? 0);
    if (difference !== 0) return difference;
  }
  return left.length - right.length;
}

function hex(bytes: Uint8Array): string {
  return Array.from(bytes, (byte) => byte.toString(16).padStart(2, '0')).join('');
}

function unhex(id: string): Uint8Array {
  return Uint8Array.from(id.match(/../g) ?? [], (pair) => Number.parseInt(pair, 16));
}
