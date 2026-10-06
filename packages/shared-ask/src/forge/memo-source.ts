/**
 * Per-request memoisation of a `ForgeSource` (`docs/claude-opus/14` §11, fix 1): one answer
 * reads the tree, the beans, the event log and the tests several times over; the wrapper
 * makes every repeat of a read with the same arguments share the first call's promise.
 *
 * Create one per request and drop it with the request: nothing here expires, so a long-lived
 * wrapper would serve a live run's old state. A failed read is forgotten, so a retry calls
 * again. `decide` is never memoised, and it clears every read, since the run has moved.
 */
import type { ForgeSource } from './forge-source';

export function memoSource(source: ForgeSource): ForgeSource {
  const clears: (() => void)[] = [];
  const memo = <A extends readonly unknown[], T>(
    read: (...args: A) => Promise<T>,
  ): ((...args: A) => Promise<T>) => {
    const calls = new Map<string, Promise<T>>();
    clears.push(() => calls.clear());
    return (...args) => {
      const key = JSON.stringify(args);
      const cached = calls.get(key);
      if (cached !== undefined) return cached;
      const started = read(...args);
      calls.set(key, started);
      // A failed read is not kept: the caller sees the failure, the next call retries.
      started.catch(() => calls.delete(key));
      return started;
    };
  };
  return {
    listRuns: memo(source.listRuns.bind(source)),
    runOptions: memo(source.runOptions.bind(source)),
    runEvents: memo(source.runEvents.bind(source)),
    repoTree: memo(source.repoTree.bind(source)),
    repoFile: memo(source.repoFile.bind(source)),
    repoDiff: memo(source.repoDiff.bind(source)),
    repoLog: memo(source.repoLog.bind(source)),
    repoGrep: memo(source.repoGrep.bind(source)),
    beansByPath: memo(source.beansByPath.bind(source)),
    beanDetail: memo(source.beanDetail.bind(source)),
    decisions: memo(source.decisions.bind(source)),
    testsFor: memo(source.testsFor.bind(source)),
    decide: async (run, card, answer) => {
      const outcome = await source.decide(run, card, answer);
      for (const clear of clears) clear();
      return outcome;
    },
  };
}
