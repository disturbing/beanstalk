import type { TaskId } from '@beanstalk/shared-race/ids';
import type { RunConfig } from '@beanstalk/shared-race/run-config';
import type { ArenaTask } from '@beanstalk/shared-race/task';

import type { ReadMapIndex } from '../read-maps/read-map-store';
import { seededRandom } from './numbers';

/** The run's immutable inputs, kept out of the persisted engine state. */
export type EngineEnv = {
  readonly config: RunConfig;
  readonly tasks: ReadonlyMap<string, ArenaTask>;
  /**
   * The run's read maps (`read-maps/read-map-store.ts`): which test files may observe a set of
   * changed paths. Absent in engine tests that do not give one; the RunDO always does.
   */
  readonly readMaps?: ReadMapIndex;
};

/** Builds the engine environment from a parsed run configuration. */
export function engineEnv(config: RunConfig, readMaps?: ReadMapIndex): EngineEnv {
  return {
    config,
    tasks: new Map(config.tasks.map((task) => [task.id, task])),
    ...(readMaps === undefined ? {} : { readMaps }),
  };
}

/**
 * Task priority: arena order, or a seeded shuffle when `shuffle` is on (lower starts
 * first, as `Task.order` in the harness).
 */
export function taskOrder(config: RunConfig): TaskId[] {
  const ids = config.tasks.map((task) => task.id);
  if (!config.shuffle) return ids;
  const random = seededRandom(config.seed);
  const shuffled = [...ids];
  for (let index = shuffled.length - 1; index > 0; index -= 1) {
    const other = Math.floor(random() * (index + 1));
    const current = shuffled[index];
    const picked = shuffled[other];
    if (current === undefined || picked === undefined) continue;
    shuffled[index] = picked;
    shuffled[other] = current;
  }
  return shuffled;
}
