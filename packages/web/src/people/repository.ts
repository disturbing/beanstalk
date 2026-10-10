/**
 * The repository a run's page presents. A run is a benchmark artifact; its page shows the
 * repository it grew. The recorded runs and the live races all grow the arena shop, owned by
 * its placeholder owner until repositories carry their own identity.
 */
import type { RunId } from '@gitstalk/shared-race/ids';

export type Repository = { readonly owner: string; readonly name: string };

const ARENA: Repository = { owner: 'coop', name: 'beanstalk-shop' };

export function repositoryOf(_run: RunId): Repository {
  return ARENA;
}
