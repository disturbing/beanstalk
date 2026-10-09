// Reads a real git pack (version 2, undeltified, as the gateway's own pack writer makes them)
// into the fake Artifacts' maps, so a commit the gateway builds (the automation builder's
// saves) has its files in tests as a JSON test payload's commit does. Tests only.
import { inflateSync } from 'node:zlib';

const TYPES = { 1: 'commit', 2: 'tree', 3: 'blob', 4: 'tag' };
const TREE_TYPES = { 40000: 'tree', 100755: 'exec' };
const ROUNDS = [
  { until: 20, k: 0x5a827999, f: (b, c, d) => (b & c) | (~b & d) },
  { until: 40, k: 0x6ed9eba1, f: (b, c, d) => b ^ c ^ d },
  { until: 60, k: 0x8f1bbcdc, f: (b, c, d) => (b & c) | (b & d) | (c & d) },
  { until: 80, k: 0xca62c1d6, f: (b, c, d) => b ^ c ^ d },
];
const decoder = new TextDecoder();

/** Stores the pack's blobs, trees and commits (with their file maps) in `repo`. */
export function storeRealPack(repo, pack) {
  if (pack.length < 12 || decoder.decode(pack.subarray(0, 4)) !== 'PACK') return;
  const view = new DataView(pack.buffer, pack.byteOffset, pack.byteLength);
  // A test payload (`PACK{...}` JSON) is not a pack; a real one says version 2.
  if (view.getUint32(4) !== 2) return;
  const count = view.getUint32(8);
  let offset = 12;
  const commits = [];
  for (let index = 0; index < count; index += 1) {
    let byte = pack[offset];
    const type = TYPES[(byte >> 4) & 7];
    offset += 1;
    while (byte & 0x80) {
      byte = pack[offset];
      offset += 1;
    }
    const { buffer, engine } = inflateSync(pack.subarray(offset), { info: true });
    offset += engine.bytesWritten;
    const body = new Uint8Array(buffer);
    const id = objectIdOf(type, body);
    if (type === 'blob') repo.blobs.set(id, decoder.decode(body));
    else if (type === 'tree') repo.trees.set(id, treeEntries(body));
    else if (type === 'commit') commits.push({ id, text: decoder.decode(body) });
  }
  for (const commit of commits) repo.commits.set(commit.id, commitOf(repo, commit.text));
}

function objectIdOf(type, body) {
  // Git's id: SHA-1 of `<type> <size>\0<body>`, computed synchronously (crypto.subtle is async).
  return sha1Hex(
    new Uint8Array([...new TextEncoder().encode(`${type} ${body.length}\0`), ...body]),
  );
}

function treeEntries(body) {
  const entries = [];
  let offset = 0;
  while (offset < body.length) {
    const space = body.indexOf(0x20, offset);
    const nul = body.indexOf(0, space);
    const mode = decoder.decode(body.subarray(offset, space));
    const name = decoder.decode(body.subarray(space + 1, nul));
    const hash = [...body.subarray(nul + 1, nul + 21)]
      .map((value) => value.toString(16).padStart(2, '0'))
      .join('');
    const type = TREE_TYPES[mode] ?? 'blob';
    entries.push({ name, mode, hash, type });
    offset = nul + 21;
  }
  return entries;
}

function commitOf(repo, text) {
  const [head, ...message] = text.split('\n\n');
  const lines = head.split('\n');
  const tree = lines.find((line) => line.startsWith('tree '))?.slice(5) ?? '';
  const parents = lines.filter((line) => line.startsWith('parent ')).map((line) => line.slice(7));
  return {
    parents,
    message: message.join('\n\n').trimEnd(),
    time: 0,
    files: filesOf(repo, tree, ''),
    tree,
  };
}

function filesOf(repo, tree, prefix) {
  const files = {};
  for (const entry of repo.trees.get(tree) ?? []) {
    const path = `${prefix}${entry.name}`;
    if (entry.type === 'tree') Object.assign(files, filesOf(repo, entry.hash, `${path}/`));
    else files[path] = repo.blobs.get(entry.hash) ?? '';
  }
  return files;
}

/** SHA-1 (FIPS 180-1), synchronous: the fake has no async step while it stores a push. */
function sha1Hex(bytes) {
  const words = [];
  const length = bytes.length;
  const padded = new Uint8Array(((length + 9 + 63) >> 6) << 6);
  padded.set(bytes);
  padded[length] = 0x80;
  const bits = length * 8;
  const view = new DataView(padded.buffer);
  view.setUint32(padded.length - 4, bits >>> 0);
  view.setUint32(padded.length - 8, Math.floor(bits / 2 ** 32));
  let [h0, h1, h2, h3, h4] = [0x67452301, 0xefcdab89, 0x98badcfe, 0x10325476, 0xc3d2e1f0];
  for (let chunk = 0; chunk < padded.length; chunk += 64) {
    for (let index = 0; index < 16; index += 1) words[index] = view.getUint32(chunk + index * 4);
    for (let index = 16; index < 80; index += 1) {
      const value = words[index - 3] ^ words[index - 8] ^ words[index - 14] ^ words[index - 16];
      words[index] = (value << 1) | (value >>> 31);
    }
    let [a, b, c, d, e] = [h0, h1, h2, h3, h4];
    for (let index = 0; index < 80; index += 1) {
      const round = ROUNDS.find((candidate) => index < candidate.until);
      const next = (((a << 5) | (a >>> 27)) + round.f(b, c, d) + e + round.k + words[index]) >>> 0;
      e = d;
      d = c;
      c = (b << 30) | (b >>> 2);
      b = a;
      a = next;
    }
    h0 = (h0 + a) >>> 0;
    h1 = (h1 + b) >>> 0;
    h2 = (h2 + c) >>> 0;
    h3 = (h3 + d) >>> 0;
    h4 = (h4 + e) >>> 0;
  }
  return [h0, h1, h2, h3, h4].map((value) => (value >>> 0).toString(16).padStart(8, '0')).join('');
}
