/**
 * SSH public keys in their wire format (RFC 4253 §6.6, RFC 5656 §3.1, RFC 8709): parsing an
 * `authorized_keys`-style line into a typed key, and its SHA-256 fingerprint as
 * `ssh-keygen -l` prints it. Pure: runs in Workers and in Node.
 */

/** Key types Beanstalk accepts for git signatures. Security-key (`sk-`) types are not yet. */
export const SSH_KEY_TYPES = [
  'ssh-ed25519',
  'ecdsa-sha2-nistp256',
  'ecdsa-sha2-nistp384',
  'ecdsa-sha2-nistp521',
  'ssh-rsa',
] as const;
export type SshKeyType = (typeof SSH_KEY_TYPES)[number];

export type SshPublicKey =
  | { readonly type: 'ssh-ed25519'; readonly blob: Uint8Array; readonly raw: Uint8Array }
  | {
      readonly type: 'ecdsa-sha2-nistp256' | 'ecdsa-sha2-nistp384' | 'ecdsa-sha2-nistp521';
      readonly blob: Uint8Array;
      readonly point: Uint8Array;
    }
  | {
      readonly type: 'ssh-rsa';
      readonly blob: Uint8Array;
      readonly exponent: Uint8Array;
      readonly modulus: Uint8Array;
    };

export type ParsedKeyLine =
  | {
      readonly ok: true;
      readonly key: SshPublicKey;
      readonly comment: string;
      readonly fingerprint: string;
    }
  | { readonly ok: false; readonly reason: string };

const MIN_RSA_BITS = 2048;

/** Reads `ssh-ed25519 AAAA… comment` (one line, as in a `.pub` file or `ssh-add -L`). */
export async function parsePublicKeyLine(line: string): Promise<ParsedKeyLine> {
  const [type = '', encoded = '', ...comment] = line.trim().split(/\s+/);
  if (type.startsWith('sk-'))
    return refuse('security-key (sk-) SSH keys are not supported yet; use an ed25519 key');
  if (!isKeyType(type)) return refuse(`unsupported key type "${type.slice(0, 40)}"`);
  const blob = decodeBase64(encoded);
  if (blob === null) return refuse('the key is not valid base64');
  const key = parseKeyBlob(blob);
  if (key === null || key.type !== type) return refuse('the key data does not match its type');
  if (key.type === 'ssh-rsa' && significantBits(key.modulus) < MIN_RSA_BITS)
    return refuse(`RSA keys need at least ${MIN_RSA_BITS} bits`);
  return {
    ok: true,
    key,
    comment: comment.join(' ').slice(0, 100),
    fingerprint: await fingerprintOf(blob),
  };
}

/** A key from its wire blob, or null when it is malformed or of an unsupported type. */
export function parseKeyBlob(blob: Uint8Array): SshPublicKey | null {
  const reader = new SshReader(blob);
  const type = reader.text();
  if (type === 'ssh-ed25519') {
    const raw = reader.bytes();
    return raw !== null && raw.length === 32 && reader.isDone() ? { type, blob, raw } : null;
  }
  if (
    type === 'ecdsa-sha2-nistp256' ||
    type === 'ecdsa-sha2-nistp384' ||
    type === 'ecdsa-sha2-nistp521'
  ) {
    const curve = reader.text();
    const point = reader.bytes();
    if (curve !== type.slice('ecdsa-sha2-'.length) || point === null || !reader.isDone())
      return null;
    return point[0] === 4 ? { type, blob, point } : null;
  }
  if (type === 'ssh-rsa') {
    const exponent = reader.bytes();
    const modulus = reader.bytes();
    if (exponent === null || modulus === null || !reader.isDone()) return null;
    return { type, blob, exponent, modulus };
  }
  return null;
}

/** `SHA256:<base64, no padding>` of the key blob: what `ssh-keygen -lf key.pub` prints. */
export async function fingerprintOf(blob: Uint8Array): Promise<string> {
  const digest = new Uint8Array(await crypto.subtle.digest('SHA-256', copy(blob)));
  return `SHA256:${encodeBase64(digest).replace(/=+$/, '')}`;
}

/** Sequential reads of SSH wire types (uint32 lengths, big-endian). Null on any overrun. */
export class SshReader {
  private offset = 0;
  private readonly data: Uint8Array;

  constructor(data: Uint8Array) {
    this.data = data;
  }

  uint32(): number | null {
    if (this.offset + 4 > this.data.length) return null;
    const view = new DataView(this.data.buffer, this.data.byteOffset + this.offset, 4);
    this.offset += 4;
    return view.getUint32(0);
  }

  bytes(): Uint8Array | null {
    const length = this.uint32();
    if (length === null || this.offset + length > this.data.length) return null;
    const value = this.data.subarray(this.offset, this.offset + length);
    this.offset += length;
    return value;
  }

  text(): string | null {
    const value = this.bytes();
    return value === null ? null : new TextDecoder().decode(value);
  }

  isDone(): boolean {
    return this.offset === this.data.length;
  }
}

export function concatBytes(parts: readonly Uint8Array[]): Uint8Array<ArrayBuffer> {
  const out = new Uint8Array(parts.reduce((total, part) => total + part.length, 0));
  let offset = 0;
  for (const part of parts) {
    out.set(part, offset);
    offset += part.length;
  }
  return out;
}

/** A copy backed by its own ArrayBuffer (what WebCrypto's types ask for). */
export function copy(bytes: Uint8Array): Uint8Array<ArrayBuffer> {
  return concatBytes([bytes]);
}

/** Standard base64 (with or without padding); null when it is not base64. */
export function decodeBase64(text: string): Uint8Array<ArrayBuffer> | null {
  if (text === '' || !/^[A-Za-z0-9+/]+={0,2}$/.test(text)) return null;
  try {
    const binary = atob(text);
    const bytes = new Uint8Array(binary.length);
    for (let index = 0; index < binary.length; index += 1) bytes[index] = binary.charCodeAt(index);
    return bytes;
  } catch {
    // atob refused it: not base64, which the caller treats as absent.
    return null;
  }
}

export function encodeBase64(bytes: Uint8Array): string {
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary);
}

function isKeyType(type: string): type is SshKeyType {
  return SSH_KEY_TYPES.some((known) => known === type);
}

function significantBits(value: Uint8Array): number {
  const start = value.findIndex((byte) => byte !== 0);
  if (start < 0) return 0;
  return (value.length - start) * 8 - Math.clz32(value[start] ?? 0) + 24;
}

function refuse(reason: string): ParsedKeyLine {
  return { ok: false, reason };
}
