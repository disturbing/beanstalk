/**
 * The admin home's platform counts, read in one query from the identity database this Worker
 * binds (IDENTITY_DB). Repositories are not counted: the registry lives behind the gateway and
 * has no count call.
 */
import { z } from 'zod';

const Counts = z.object({ people: z.number(), disabled: z.number(), orgs: z.number() });

export type PlatformCounts = z.infer<typeof Counts>;

const COUNTS_SQL = `SELECT
  (SELECT COUNT(*) FROM users WHERE disabled_at IS NULL) AS people,
  (SELECT COUNT(*) FROM users WHERE disabled_at IS NOT NULL) AS disabled,
  (SELECT COUNT(*) FROM orgs) AS orgs`;

/** People with an account (active and disabled) and organizations. */
export async function platformCounts(db: D1Database): Promise<PlatformCounts> {
  return Counts.parse(await db.prepare(COUNTS_SQL).first());
}
