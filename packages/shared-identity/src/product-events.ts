/**
 * Product analytics and log identity (`docs/claude-opus/16` item 1.7). Product events go to
 * the Workers Analytics Engine dataset `product_events` (binding PRODUCT_EVENTS) as one data
 * point each; people and sessions appear only as hashed ids, in events and in logs, so neither
 * can be joined back to the identity database by someone holding just the logs.
 *
 * Data point layout (what `scripts/product-events.mjs` and the SQL in doc 19 read):
 * - `index1`: the hashed user id (Analytics Engine samples per index, so per person);
 * - `blob1`: the event; `blob2`: the hashed user id; `blob3`: a short detail (the agent's
 *   client name for `connect`, the repository's origin for `repo_create`);
 * - `double1`: 1.
 */
import { z } from 'zod';

import { hashSecret } from './secrets';

export const ProductEvent = z.enum(['signup', 'connect', 'repo_create', 'bean_push']);
export type ProductEvent = z.infer<typeof ProductEvent>;

/** The binding's one method; Analytics Engine writes are fire-and-forget. */
export type ProductEventsDataset = Pick<AnalyticsEngineDataset, 'writeDataPoint'>;

/** The longest detail kept (blobs are cheap, but a detail is a label, not a payload). */
const MAX_DETAIL = 80;

/**
 * A stable, non-reversible id for logs and analytics: `h_` + 16 hex characters of SHA-256.
 * Ids are random already; hashing keeps logs from carrying the database's keys.
 */
export async function hashedId(id: string): Promise<string> {
  return `h_${(await hashSecret(`beanstalk-id:${id}`)).slice(0, 16)}`;
}

/** The log fields naming who acted: hashed `user_id` and, when there is one, `session_id`. */
export async function logIdentity(input: {
  readonly userId: string;
  readonly sessionId?: string | null;
}): Promise<{ readonly user_id: string; readonly session_id?: string }> {
  const user_id = await hashedId(input.userId);
  if (input.sessionId === undefined || input.sessionId === null) return { user_id };
  return { user_id, session_id: await hashedId(input.sessionId) };
}

/**
 * Records one product event. A deployment without the binding records nothing; a failing
 * write is never the request's problem (analytics must not break sign-up).
 */
export async function recordProductEvent(
  dataset: ProductEventsDataset | undefined,
  event: ProductEvent,
  input: { readonly userId: string; readonly detail?: string },
): Promise<void> {
  if (dataset === undefined) return;
  const user = await hashedId(input.userId);
  try {
    dataset.writeDataPoint({
      indexes: [user],
      blobs: [event, user, (input.detail ?? '').slice(0, MAX_DETAIL)],
      doubles: [1],
    });
  } catch {
    // Analytics Engine refused the point (a binding fault): the product action still stands.
  }
}

/** The binding from an env object, when the Worker has one (it is optional per deployment). */
export function productEventsOf(env: object): ProductEventsDataset | undefined {
  const binding: unknown = Reflect.get(env, 'PRODUCT_EVENTS');
  return isDataset(binding) ? binding : undefined;
}

function isDataset(value: unknown): value is ProductEventsDataset {
  return (
    typeof value === 'object' &&
    value !== null &&
    typeof Reflect.get(value, 'writeDataPoint') === 'function'
  );
}
