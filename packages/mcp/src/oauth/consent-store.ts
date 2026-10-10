/**
 * Pending consent requests, between `/authorize` on this Worker and `/connect` on the web
 * app (another origin on workers.dev; the same zone in production). The request the
 * library validated is kept server-side in KV for ten minutes under the hash of a random
 * id; the browser carries only the id. The first signed-in person to open it claims it, and
 * approving or denying consumes it.
 */
import type { AuthRequest, ConsentDescription } from '@cloudflare/workers-oauth-provider';
import { z } from 'zod';

import { hashSecret, randomSecret } from '@gitstalk/shared-identity/secrets';

const CONSENT_SECONDS = 600;
const KEY_PREFIX = 'beanstalk-consent:';

const StoredConsent = z.object({
  request: z.custom<AuthRequest>((value) => typeof value === 'object' && value !== null),
  description: z.custom<ConsentDescription>((value) => typeof value === 'object' && value !== null),
  claimedBy: z.string().nullable(),
  createdAt: z.number(),
});
export type StoredConsent = z.infer<typeof StoredConsent>;

export async function saveConsent(
  kv: KVNamespace,
  input: {
    readonly request: AuthRequest;
    readonly description: ConsentDescription;
    readonly now: number;
  },
): Promise<string> {
  const id = randomSecret();
  const stored: StoredConsent = { ...input, claimedBy: null, createdAt: input.now };
  await kv.put(await keyOf(id), JSON.stringify(stored), { expirationTtl: CONSENT_SECONDS });
  return id;
}

/** The pending request, claimed by `userId` if nobody has yet; null when gone or claimed by another. */
export async function claimConsent(
  kv: KVNamespace,
  id: string,
  userId: string,
): Promise<StoredConsent | null> {
  const key = await keyOf(id);
  const stored = await read(kv, key);
  if (stored === null) return null;
  if (stored.claimedBy !== null) return stored.claimedBy === userId ? stored : null;
  const claimed = { ...stored, claimedBy: userId };
  const left = Math.max(60, Math.ceil(CONSENT_SECONDS - (Date.now() - stored.createdAt) / 1000));
  await kv.put(key, JSON.stringify(claimed), { expirationTtl: left });
  return claimed;
}

/** Removes and returns the request unless another person claimed it: each one is decided once. */
export async function takeConsent(
  kv: KVNamespace,
  id: string,
  userId: string,
): Promise<StoredConsent | null> {
  const key = await keyOf(id);
  const stored = await read(kv, key);
  if (stored === null || (stored.claimedBy !== null && stored.claimedBy !== userId)) return null;
  await kv.delete(key);
  return stored;
}

async function read(kv: KVNamespace, key: string): Promise<StoredConsent | null> {
  const text = await kv.get(key);
  if (text === null) return null;
  const parsed = StoredConsent.safeParse(JSON.parse(text));
  return parsed.success ? parsed.data : null;
}

async function keyOf(id: string): Promise<string> {
  if (!/^[A-Za-z0-9_-]{43}$/.test(id)) return `${KEY_PREFIX}invalid`;
  return `${KEY_PREFIX}${await hashSecret(id)}`;
}
