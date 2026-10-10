/**
 * Read models of a run for the web app that are not in the event log: its row in the run
 * index, and which acceptance tests cover which paths (static import closures on the run's
 * landed line).
 */
import type { RunListItem, TestCoverage } from '@gitstalk/shared-race/rpc';

import { isUnder } from '../adapters/artifacts';
import type { RepoExplorer } from '../adapters/repo-explorer';
import type { EngineEnv } from '../engine/catalog';
import { effectiveTests } from '../engine/context';
import { roundTo } from '../engine/numbers';
import type { EngineState } from '../engine/state';
import { taskCounts } from '../engine/view';
import { importClosures } from '../repo/import-closure';
import type { StoredRun } from './run-store';

/** Repo files the closures of one `testsFor` call may read. */
const MAX_CLOSURE_READS = 400;

/** A run's row in the index (`updated_at` is added when it is sent). */
export function runListItem(stored: StoredRun): RunListItem {
  const { meta, config, state } = stored;
  const tasks = Object.values(state.tasks);
  return {
    run: meta.run,
    policy: config.policy,
    preset: config.preset,
    phase: state.phase,
    aborted: state.aborted,
    created_at: new Date(meta.createdAtMs).toISOString(),
    updated_at: '',
    agents: state.slots.length,
    tasks: { total: tasks.length, ...taskCounts(tasks) },
    spent_usd: roundTo(state.spent, 4),
  };
}

/** Acceptance tests whose import closure (on `commit`) covers some of `paths`. */
export async function testCoverage(input: {
  explorer: RepoExplorer;
  commit: string;
  state: EngineState;
  env: EngineEnv;
  paths: readonly string[];
}): Promise<TestCoverage[]> {
  const { explorer, commit, state, env } = input;
  const owners = new Map<string, string>();
  const known: Record<string, string> = {};
  for (const id of state.order) {
    for (const [path, content] of Object.entries(effectiveTests(env, state, id))) {
      owners.set(path, id);
      known[path] = content;
    }
  }
  const listing = await explorer.listFiles(commit);
  const files = new Set([...listing.files, ...Object.keys(known)]);
  const { closures } = await importClosures({
    known,
    files,
    read: (paths) => explorer.readTexts(commit, paths),
    maxReads: MAX_CLOSURE_READS,
  });
  return [...closures.entries()].flatMap(([test, closure]) => {
    const covers = input.paths.filter((path) => [...closure].some((file) => isUnder(file, [path])));
    const task = owners.get(test) ?? '?';
    if (covers.length === 0) return [];
    return [
      {
        test,
        task,
        status: state.tasks[task]?.status ?? 'pending',
        covers,
        closure_size: closure.size,
        amended: Object.hasOwn(state.amendedTests[task] ?? {}, test),
      },
    ];
  });
}
