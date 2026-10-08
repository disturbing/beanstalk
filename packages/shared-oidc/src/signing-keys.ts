/**
 * Signing keys for the OIDC issuer.
 *
 * The keys live in one Worker secret (`OIDC_SIGNING_KEYS`), a JSON document:
 * `{ "active": "<kid>", "keys": [<private JWK with kid and alg>, ...] }`.
 * Every key's public half is published in the JWKS; only `active` signs. Rotation is two steps
 * with an overlap: add the new key (published, not yet signing), wait longer than a JWKS cache
 * lifetime, set `active` to it, and remove the old key once its last token (10 minutes) expired.
 */
import { z } from 'zod';

import { base64UrlEncode } from './base64url';

export const SIGNING_ALGORITHMS = ['RS256', 'ES256'] as const;
export type SigningAlgorithm = (typeof SIGNING_ALGORITHMS)[number];

const PrivateJwk = z.object({
  kty: z.enum(['RSA', 'EC']),
  kid: z.string().min(1).max(64),
  alg: z.enum(SIGNING_ALGORITHMS),
  // RSA and EC parameters; the WebCrypto import rejects a malformed key.
  n: z.string().optional(),
  e: z.string().optional(),
  d: z.string().min(1),
  p: z.string().optional(),
  q: z.string().optional(),
  dp: z.string().optional(),
  dq: z.string().optional(),
  qi: z.string().optional(),
  crv: z.string().optional(),
  x: z.string().optional(),
  y: z.string().optional(),
});
export type PrivateJwk = z.infer<typeof PrivateJwk>;

const KeySetDocument = z.object({
  active: z.string().min(1),
  keys: z.array(PrivateJwk).min(1).max(4),
});

/** A published key: the public half of a signing key (RFC 7517). */
export type PublicJwk = {
  readonly kty: string;
  readonly kid: string;
  readonly alg: SigningAlgorithm;
  readonly use: 'sig';
  readonly [parameter: string]: string;
};

export type SigningKey = {
  readonly kid: string;
  readonly alg: SigningAlgorithm;
  readonly privateKey: CryptoKey;
  readonly publicJwk: PublicJwk;
};

export type SigningKeySet = {
  readonly active: SigningKey;
  readonly all: readonly SigningKey[];
};

export class SigningKeysError extends Error {}

/** Parses and imports the `OIDC_SIGNING_KEYS` secret. Throws `SigningKeysError` without echoing key material. */
export async function loadSigningKeys(secretJson: string): Promise<SigningKeySet> {
  let document: z.infer<typeof KeySetDocument>;
  try {
    document = KeySetDocument.parse(JSON.parse(secretJson));
  } catch {
    throw new SigningKeysError('OIDC_SIGNING_KEYS is not a valid key set document');
  }
  const kids = new Set(document.keys.map((key) => key.kid));
  if (kids.size !== document.keys.length)
    throw new SigningKeysError('duplicate kid in the key set');
  const all = await Promise.all(document.keys.map(importSigningKey));
  const active = all.find((key) => key.kid === document.active);
  if (active === undefined) throw new SigningKeysError('the active kid is not in the key set');
  return { active, all };
}

/** Generates a key and returns its private JWK (store it in the secret; never log it). */
export async function generateSigningKey(alg: SigningAlgorithm, kid: string): Promise<PrivateJwk> {
  const pair = await crypto.subtle.generateKey(generateParameters(alg), true, ['sign', 'verify']);
  if (!('privateKey' in pair)) throw new SigningKeysError('key generation returned no key pair');
  const exported = await crypto.subtle.exportKey('jwk', pair.privateKey);
  return PrivateJwk.parse(Object.assign({}, exported, { kid, alg }));
}

/** A key id that sorts by creation time and cannot collide: `2026-10-08-<8 random hex>`. */
export function newKeyId(now: Date): string {
  const random = base64UrlEncode(crypto.getRandomValues(new Uint8Array(6)));
  return `${now.toISOString().slice(0, 10)}-${random}`;
}

/** The JWKS document: the public half of every key in the set. */
export function publicJwks(keys: SigningKeySet): { readonly keys: readonly PublicJwk[] } {
  return { keys: keys.all.map((key) => key.publicJwk) };
}

/** Signs `signingInput` (`header.payload`) and returns the JWS signature segment. */
export async function signJws(key: SigningKey, signingInput: string): Promise<string> {
  const signature = await crypto.subtle.sign(
    signParameters(key.alg),
    key.privateKey,
    new TextEncoder().encode(signingInput),
  );
  return base64UrlEncode(new Uint8Array(signature));
}

async function importSigningKey(jwk: PrivateJwk): Promise<SigningKey> {
  const expectedKty = jwk.alg === 'RS256' ? 'RSA' : 'EC';
  if (jwk.kty !== expectedKty) throw new SigningKeysError(`key ${jwk.kid}: kty does not match alg`);
  try {
    const privateKey = await crypto.subtle.importKey(
      'jwk',
      { ...definedParameters(jwk), kty: jwk.kty, key_ops: ['sign'], ext: false },
      importParameters(jwk.alg),
      false,
      ['sign'],
    );
    return { kid: jwk.kid, alg: jwk.alg, privateKey, publicJwk: publicHalf(jwk) };
  } catch {
    throw new SigningKeysError(`key ${jwk.kid} could not be imported`);
  }
}

function publicHalf(jwk: PrivateJwk): PublicJwk {
  const parameters =
    jwk.alg === 'RS256' ? { n: jwk.n, e: jwk.e } : { crv: jwk.crv, x: jwk.x, y: jwk.y };
  const present = Object.entries(parameters).filter(
    (entry): entry is [string, string] => entry[1] !== undefined,
  );
  return { kty: jwk.kty, kid: jwk.kid, alg: jwk.alg, use: 'sig', ...Object.fromEntries(present) };
}

function generateParameters(alg: SigningAlgorithm) {
  return alg === 'RS256'
    ? {
        name: 'RSASSA-PKCS1-v1_5',
        modulusLength: 2048,
        publicExponent: new Uint8Array([1, 0, 1]),
        hash: 'SHA-256',
      }
    : { name: 'ECDSA', namedCurve: 'P-256' };
}

function importParameters(alg: SigningAlgorithm) {
  return alg === 'RS256'
    ? { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' }
    : { name: 'ECDSA', namedCurve: 'P-256' };
}

function signParameters(alg: SigningAlgorithm) {
  return alg === 'RS256' ? { name: 'RSASSA-PKCS1-v1_5' } : { name: 'ECDSA', hash: 'SHA-256' };
}

/** The defined entries of a JWK-shaped object (WebCrypto rejects explicit `undefined`). */
function definedParameters(jwk: PrivateJwk): Record<string, string> {
  return Object.fromEntries(
    Object.entries(jwk).filter((entry): entry is [string, string] => entry[1] !== undefined),
  );
}
