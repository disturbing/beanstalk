/**
 * Sign-in rate limits through the Workers Rate Limiting binding: every key must pass (per IP,
 * and per email or handle where there is one). Keys are hashed so no address reaches the
 * limiter in the clear.
 */
import { hashSecret } from './secrets';

export type Limiter = Pick<RateLimit, 'limit'>;

/** Whether every key is still under its limit; checks all keys so each one counts the attempt. */
export async function isWithinLimits(limiter: Limiter, keys: readonly string[]): Promise<boolean> {
  const outcomes = await Promise.all(
    keys.map(async (key) =>
      limiter.limit({ key: (await hashSecret(`signin:${key}`)).slice(0, 32) }),
    ),
  );
  return outcomes.every((outcome) => outcome.success);
}
