/**
 * The per-job request token (`ACTIONS_ID_TOKEN_REQUEST_TOKEN`): `bsoidc.<payload>.<mac>`, a payload
 * of `{ exp, job }` signed with HMAC-SHA-256. It is self-contained, so the issuer needs no store:
 * the job's identity is fixed when the control plane mints it, and the token is useless for any
 * other job. It is not an identity token and no cloud provider accepts it. The control plane
 * sets its life to the job's timeout plus a grace period and may also refuse it earlier through
 * `isJobActive` (the job ended).
 */
import { z } from 'zod';

import { base64UrlDecode, base64UrlEncode, encodeJson } from './base64url';
import { IdTokenJob } from './job-identity';

export const REQUEST_TOKEN_PREFIX = 'bsoidc';
/** The longest a request token may live: the 60-minute job limit plus the 5-minute grace. */
export const MAX_REQUEST_TOKEN_TTL_SECONDS = 65 * 60;

const Payload = z.object({ exp: z.number().int(), job: IdTokenJob });

export type VerifiedRequestToken = {
  readonly job: IdTokenJob;
  readonly expiresSeconds: number;
};

export type RequestTokenSecrets = {
  /** Signs new tokens. */
  readonly current: string;
  /** Still accepted for verification, so a rotation does not break running jobs. */
  readonly previous?: string;
};

export async function signRequestToken(
  job: IdTokenJob,
  secrets: RequestTokenSecrets,
  expSeconds: number,
): Promise<string> {
  const body = `${REQUEST_TOKEN_PREFIX}.${encodeJson({ exp: expSeconds, job })}`;
  const mac = await hmac(secrets.current, 'sign', body);
  return `${body}.${base64UrlEncode(mac)}`;
}

/** The job a request token was minted for, or null when the token is malformed, forged or expired. */
export async function verifyRequestToken(
  token: string,
  secrets: RequestTokenSecrets,
  nowSeconds: number,
): Promise<VerifiedRequestToken | null> {
  const parts = token.split('.');
  if (parts.length !== 3 || parts[0] !== REQUEST_TOKEN_PREFIX) return null;
  const [prefix, payloadText, macText] = parts;
  const mac = base64UrlDecode(macText ?? '');
  if (mac === null || payloadText === undefined) return null;
  const body = `${prefix}.${payloadText}`;
  const candidates = [
    secrets.current,
    ...(secrets.previous === undefined ? [] : [secrets.previous]),
  ];
  const checks = await Promise.all(candidates.map((secret) => hmacMatches(secret, body, mac)));
  if (!checks.includes(true)) return null;
  const payload = parsePayload(payloadText);
  if (payload === null || payload.exp <= nowSeconds) return null;
  return { job: payload.job, expiresSeconds: payload.exp };
}

function parsePayload(payloadText: string): z.infer<typeof Payload> | null {
  const bytes = base64UrlDecode(payloadText);
  if (bytes === null) return null;
  try {
    const parsed = Payload.safeParse(JSON.parse(new TextDecoder().decode(bytes)));
    return parsed.success ? parsed.data : null;
  } catch {
    return null;
  }
}

async function hmacMatches(
  secret: string,
  body: string,
  mac: Uint8Array<ArrayBuffer>,
): Promise<boolean> {
  const key = await importHmacKey(secret, 'verify');
  // subtle.verify compares in constant time.
  return crypto.subtle.verify('HMAC', key, mac, new TextEncoder().encode(body));
}

async function hmac(secret: string, usage: 'sign', body: string): Promise<Uint8Array> {
  const key = await importHmacKey(secret, usage);
  return new Uint8Array(await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(body)));
}

function importHmacKey(secret: string, usage: 'sign' | 'verify'): Promise<CryptoKey> {
  return crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    [usage],
  );
}
