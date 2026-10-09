/**
 * Forgetting a deleted repository's dependency cache (doc 27 §10.8): every object under
 * `deps/<repoId>/` in R2, and whether the gateway still knows the repository (so the daily
 * sweep finds what a failed `forgetRepository` call left behind).
 */
import type { RepositoryDirectory } from '../contract';

/** R2 deletes at most this many keys per call; a listing page is the same size. */
const PAGE = 1000;
const REPO_ID = /^[A-Za-z0-9_-]{1,64}$/;

/** A repository id that is safe to put in an R2 prefix (no `/`, no `..`). */
export function isRepoId(value: unknown): value is string {
  return typeof value === 'string' && REPO_ID.test(value);
}

/** Every key of one repository's cache starts with this. */
export function repoPrefix(repoId: string): string {
  return `deps/${repoId}/`;
}

/** Deletes every object under `prefix`, a listing page at a time; the number deleted. */
export async function purgePrefix(bucket: R2Bucket, prefix: string): Promise<number> {
  let deleted = 0;
  let cursor: string | undefined = undefined;
  do {
    // oxlint-disable-next-line no-await-in-loop -- R2 listing pages follow each other
    const page: R2Objects = await bucket.list({
      prefix,
      limit: PAGE,
      ...(cursor === undefined ? {} : { cursor }),
    });
    const keys = page.objects.map((object) => object.key);
    // oxlint-disable-next-line no-await-in-loop -- delete this page before reading the next
    if (keys.length > 0) await bucket.delete(keys);
    deleted += keys.length;
    cursor = page.truncated ? page.cursor : undefined;
  } while (cursor !== undefined);
  return deleted;
}

/**
 * `'gone'` only when the gateway answers that the repository does not exist; `'unknown'` when
 * there is no gateway (a standalone stack), an older gateway without the method, or an error.
 * Nothing is deleted on `'unknown'`.
 */
export async function repositoryStatus(
  env: Env,
  repoId: string,
): Promise<'exists' | 'gone' | 'unknown'> {
  const binding: unknown = Reflect.get(env, 'ACTIONS_JOBS');
  if (!isRepositoryDirectory(binding)) return 'unknown';
  try {
    const answer = await binding.repositoryExists(repoId);
    if (!answer.ok) return 'unknown';
    return answer.value.exists ? 'exists' : 'gone';
  } catch {
    // An unreachable gateway is the same as no answer: the next sweep asks again.
    return 'unknown';
  }
}

function isRepositoryDirectory(value: unknown): value is RepositoryDirectory {
  return (
    typeof value === 'object' &&
    value !== null &&
    typeof Reflect.get(value, 'repositoryExists') === 'function'
  );
}
