/**
 * A software passkey authenticator for tests: ES256 keys from WebCrypto, real CBOR
 * attestation objects ("none" attestation) and real DER signatures, so the server verifies
 * exactly what a browser would send. Tests only; never imported by a Worker.
 */
import type {
  AuthenticationResponseJSON,
  PublicKeyCredentialCreationOptionsJSON,
  PublicKeyCredentialRequestOptionsJSON,
  RegistrationResponseJSON,
} from '@simplewebauthn/server';

import { base64UrlDecode, base64UrlEncode } from '../secrets';

const encoder = new TextEncoder();

export type VirtualAuthenticator = {
  readonly credentialId: string;
  register(
    options: PublicKeyCredentialCreationOptionsJSON,
    origin: string,
  ): Promise<RegistrationResponseJSON>;
  authenticate(
    options: PublicKeyCredentialRequestOptionsJSON,
    origin: string,
  ): Promise<AuthenticationResponseJSON>;
};

/** A new authenticator holding one resident ES256 credential. */
export async function createVirtualAuthenticator(): Promise<VirtualAuthenticator> {
  const keys = await crypto.subtle.generateKey({ name: 'ECDSA', namedCurve: 'P-256' }, true, [
    'sign',
    'verify',
  ]);
  if (!('privateKey' in keys)) throw new Error('expected an ECDSA key pair');
  const rawId = crypto.getRandomValues(new Uint8Array(32));
  const credentialId = base64UrlEncode(rawId);
  let signCount = 0;
  let userHandle: string | undefined;
  return {
    credentialId,
    async register(options, origin) {
      userHandle = options.user.id;
      const clientData = clientDataJson('webauthn.create', options.challenge, origin);
      const publicKey = await crypto.subtle.exportKey('jwk', keys.publicKey);
      if (publicKey instanceof ArrayBuffer) throw new Error('expected a JWK');
      const authData = concat(
        await rpIdHash(options.rp.id ?? new URL(origin).hostname),
        Uint8Array.of(0x45), // user present, user verified, attested credential data
        uint32(signCount),
        new Uint8Array(16), // AAGUID
        Uint8Array.of(rawId.length >> 8, rawId.length & 0xff),
        rawId,
        coseKey(publicKey),
      );
      const attestationObject = cbor(
        new Map<string, CborValue>([
          ['fmt', 'none'],
          ['attStmt', new Map()],
          ['authData', authData],
        ]),
      );
      return {
        id: credentialId,
        rawId: credentialId,
        type: 'public-key',
        response: {
          clientDataJSON: base64UrlEncode(clientData),
          attestationObject: base64UrlEncode(attestationObject),
          transports: ['internal'],
        },
        clientExtensionResults: {},
      };
    },
    async authenticate(options, origin) {
      signCount += 1;
      const clientData = clientDataJson('webauthn.get', options.challenge, origin);
      const authData = concat(
        await rpIdHash(options.rpId ?? new URL(origin).hostname),
        Uint8Array.of(0x05),
        uint32(signCount),
      );
      const signed = concat(
        authData,
        new Uint8Array(await crypto.subtle.digest('SHA-256', clientData)),
      );
      const raw = new Uint8Array(
        await crypto.subtle.sign({ name: 'ECDSA', hash: 'SHA-256' }, keys.privateKey, signed),
      );
      return {
        id: credentialId,
        rawId: credentialId,
        type: 'public-key',
        response: {
          clientDataJSON: base64UrlEncode(clientData),
          authenticatorData: base64UrlEncode(authData),
          signature: base64UrlEncode(derSignature(raw)),
          ...(userHandle === undefined ? {} : { userHandle }),
        },
        clientExtensionResults: {},
      };
    },
  };
}

type CborValue = number | string | Uint8Array | ReadonlyMap<string | number, CborValue>;

function clientDataJson(type: string, challenge: string, origin: string): Uint8Array<ArrayBuffer> {
  return new Uint8Array(
    encoder.encode(JSON.stringify({ type, challenge, origin, crossOrigin: false })),
  );
}

async function rpIdHash(rpId: string): Promise<Uint8Array> {
  return new Uint8Array(await crypto.subtle.digest('SHA-256', encoder.encode(rpId)));
}

function coseKey(jwk: JsonWebKey): Uint8Array {
  const x = base64UrlDecode(jwk.x ?? '');
  const y = base64UrlDecode(jwk.y ?? '');
  if (x === null || y === null) throw new Error('the exported key has no coordinates');
  // kty EC2, alg ES256, crv P-256, x, y
  return cbor(
    new Map<number, CborValue>([
      [1, 2],
      [3, -7],
      [-1, 1],
      [-2, x],
      [-3, y],
    ]),
  );
}

/** Just enough CBOR for attestation objects: maps, ints, text and byte strings. */
function cbor(value: CborValue): Uint8Array {
  if (typeof value === 'number') return value >= 0 ? header(0, value) : header(1, -1 - value);
  if (typeof value === 'string') {
    const bytes = encoder.encode(value);
    return concat(header(3, bytes.length), bytes);
  }
  if (value instanceof Uint8Array) return concat(header(2, value.length), value);
  const parts: Uint8Array[] = [header(5, value.size)];
  for (const [key, item] of value) parts.push(cbor(key), cbor(item));
  return concat(...parts);
}

function header(major: number, length: number): Uint8Array {
  if (length < 24) return Uint8Array.of((major << 5) | length);
  if (length < 256) return Uint8Array.of((major << 5) | 24, length);
  return Uint8Array.of((major << 5) | 25, length >> 8, length & 0xff);
}

/** WebCrypto signs ECDSA as r‖s; WebAuthn wants ASN.1 DER. */
function derSignature(raw: Uint8Array): Uint8Array {
  const integer = (bytes: Uint8Array): Uint8Array => {
    let start = 0;
    while (start < bytes.length - 1 && bytes[start] === 0) start += 1;
    const trimmed = bytes.slice(start);
    const padded = (trimmed[0] ?? 0) & 0x80 ? concat(Uint8Array.of(0), trimmed) : trimmed;
    return concat(Uint8Array.of(0x02, padded.length), padded);
  };
  const body = concat(integer(raw.slice(0, 32)), integer(raw.slice(32)));
  return concat(Uint8Array.of(0x30, body.length), body);
}

function uint32(value: number): Uint8Array {
  return Uint8Array.of(
    (value >>> 24) & 0xff,
    (value >>> 16) & 0xff,
    (value >>> 8) & 0xff,
    value & 0xff,
  );
}

function concat(...parts: readonly Uint8Array[]): Uint8Array<ArrayBuffer> {
  const out = new Uint8Array(parts.reduce((total, part) => total + part.length, 0));
  let offset = 0;
  for (const part of parts) {
    out.set(part, offset);
    offset += part.length;
  }
  return out;
}
