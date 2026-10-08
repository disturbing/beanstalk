/**
 * The two bearer strings of Actions besides the job token:
 *
 * - **log tickets** (`bsa1.<claims>.<hmac>`): a watcher's pass to one job's live log socket,
 *   signed with RUN_TOKEN_SECRET and valid for 10 minutes; `logStream` issues them after the
 *   read check, the socket route verifies them;
 * - **report tokens** (`<run>.<job>.<secret>`): the executor's bearer for one job's sink
 *   calls; the run DO keeps the secret's SHA-256 and forgets it when the job ends. Never given
 *   to step code (that is the job token's role).
 */
import { ActionsJobId, ActionsRunId } from '@beanstalk/shared-race/actions';
import { z } from 'zod';

import { base64UrlDecode, base64UrlEncode } from '../auth/base64url';

const PREFIX = 'bsa1';
export const LOG_TICKET_TTL_MS = 10 * 60 * 1000;

const TicketClaims = z.strictObject({
  run: ActionsRunId,
  job: ActionsJobId,
  exp: z.number().int(),
});
export type TicketClaims = z.infer<typeof TicketClaims>;

/** A log ticket for one job, signed with `secret`. */
export async function issueLogTicket(
  secret: string,
  target: { readonly run: ActionsRunId; readonly job: ActionsJobId },
  nowMs: number,
): Promise<{ readonly token: string; readonly expiresAt: string }> {
  const exp = nowMs + LOG_TICKET_TTL_MS;
  const payload = base64UrlEncode(new TextEncoder().encode(JSON.stringify({ ...target, exp })));
  const signature = await sign(secret, payload);
  return { token: `${PREFIX}.${payload}.${signature}`, expiresAt: new Date(exp).toISOString() };
}

/** The ticket's claims when it is valid, signed and unexpired; else null. Never throws. */
export async function verifyLogTicket(
  secret: string,
  token: string,
  nowMs: number,
): Promise<TicketClaims | null> {
  const [prefix, payload, signature, extra] = token.split('.');
  if (prefix !== PREFIX || payload === undefined || signature === undefined || extra !== undefined)
    return null;
  const signatureBytes = base64UrlDecode(signature);
  const payloadBytes = base64UrlDecode(payload);
  if (signatureBytes === null || payloadBytes === null) return null;
  const isValid = await crypto.subtle.verify(
    'HMAC',
    await hmacKey(secret),
    new Uint8Array(signatureBytes),
    new TextEncoder().encode(`${PREFIX}.${payload}`),
  );
  if (!isValid) return null;
  try {
    const claims = TicketClaims.safeParse(JSON.parse(new TextDecoder().decode(payloadBytes)));
    return claims.success && claims.data.exp > nowMs ? claims.data : null;
  } catch {
    return null;
  }
}

/** A fresh report token for a job, and the secret part the run DO keeps the hash of. */
export function newReportToken(
  run: ActionsRunId,
  job: ActionsJobId,
): { token: string; secret: string } {
  const secret = base64UrlEncode(crypto.getRandomValues(new Uint8Array(32)));
  return { token: `${run}.${job}.${secret}`, secret };
}

/** The run, job and secret a report token names; null when it is not one. */
export function parseReportToken(
  token: string,
): { readonly run: ActionsRunId; readonly job: ActionsJobId; readonly secret: string } | null {
  const [run, job, secret, extra] = token.split('.');
  const parsedRun = ActionsRunId.safeParse(run);
  const parsedJob = ActionsJobId.safeParse(job);
  if (
    !parsedRun.success ||
    !parsedJob.success ||
    secret === undefined ||
    secret === '' ||
    extra !== undefined
  )
    return null;
  return { run: parsedRun.data, job: parsedJob.data, secret };
}

async function sign(secret: string, payload: string): Promise<string> {
  const signature = await crypto.subtle.sign(
    'HMAC',
    await hmacKey(secret),
    new TextEncoder().encode(`${PREFIX}.${payload}`),
  );
  return base64UrlEncode(new Uint8Array(signature));
}

function hmacKey(secret: string): Promise<CryptoKey> {
  return crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(`actions-log-ticket\0${secret}`),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign', 'verify'],
  );
}
