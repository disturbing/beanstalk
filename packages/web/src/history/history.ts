/**
 * The History tab's model: the stalk's commits (who, what, when, which bean) and, above them,
 * the sprout's commits that are not validated yet. A commit's bean comes from its `Task:`
 * trailer or the landing that made it; its person from who pushed that bean. Pure.
 */
import { z } from 'zod';

import type { RaceEvent } from '@gitstalk/shared-ask/race/race-events';
import type { PushedBean } from '../changes/pushed-beans';

export const LogCommit = z.object({
  sha: z.string(),
  parents: z.array(z.string()),
  message: z.string(),
  author: z.object({ name: z.string(), email: z.string() }),
  committed_at: z.string(),
});
export type LogCommit = z.infer<typeof LogCommit>;

export type HistoryRow = {
  readonly sha: string;
  readonly title: string;
  /** The bean the commit landed, if any. */
  readonly bean: string | null;
  /** Who pushed that bean (a handle), or the commit's author name for other commits. */
  readonly by: { readonly kind: 'person' | 'name'; readonly name: string };
  /** Epoch milliseconds, or null when the date is unreadable. */
  readonly at: number | null;
  /** The repository's first commit. */
  readonly root: boolean;
};

export type History = {
  /** On the sprout, waiting for validation; newest first. */
  readonly pending: readonly HistoryRow[];
  /** On the stalk; newest first. */
  readonly stalk: readonly HistoryRow[];
};

/** The two lines as rows. `landings` maps a landing commit to its bean (the engine's `land`). */
export function historyOf(input: {
  readonly stalk: readonly LogCommit[];
  readonly sprout: readonly LogCommit[];
  readonly pushed: readonly PushedBean[];
  readonly landings: ReadonlyMap<string, string>;
}): History {
  const onStalk = new Set(input.stalk.map((commit) => commit.sha));
  const landedBy = new Map(
    input.pushed.flatMap((bean) =>
      bean.landed_sha === null ? [] : [[bean.landed_sha, bean.bean]],
    ),
  );
  const actors = new Map(input.pushed.map((bean) => [bean.bean, bean.actor]));
  const row = (commit: LogCommit): HistoryRow => {
    const bean =
      landedBy.get(commit.sha) ?? input.landings.get(commit.sha) ?? trailerTask(commit.message);
    const actor = bean === null ? undefined : actors.get(bean);
    const at = Date.parse(commit.committed_at);
    return {
      sha: commit.sha,
      title: commit.message.split('\n')[0]?.trim() ?? '',
      bean,
      by:
        actor === undefined
          ? { kind: 'name', name: commit.author.name }
          : { kind: 'person', name: actor },
      at: Number.isNaN(at) ? null : at,
      root: commit.parents.length === 0,
    };
  };
  return {
    pending: input.sprout.filter((commit) => !onStalk.has(commit.sha)).map(row),
    stalk: input.stalk.map(row),
  };
}

/** Each landing commit's bean, from the engine's `land` events. */
export function landingsOf(events: readonly RaceEvent[]): ReadonlyMap<string, string> {
  return new Map(
    events.flatMap((event): [string, string][] =>
      event.type === 'land' && event.task !== null ? [[event.sha, event.task]] : [],
    ),
  );
}

/** A validation's word on one commit, from the repository index (repo-events). */
export type Verdict = {
  readonly kind: 'validated' | 'red' | 'demoted' | 'reverted';
  readonly text: string;
  /** ISO 8601. */
  readonly at: string;
};

/** Activity kinds that are a validation's verdict on a commit of the lines. */
const VERDICT_KINDS: Readonly<Record<string, Verdict['kind']>> = {
  promoted: 'validated',
  red: 'red',
  demoted: 'demoted',
  reverted: 'reverted',
};

/**
 * Each commit's newest verdict (`activity` is newest first): a green validation that moved the
 * stalk to it, a red validation of it, an audit that moved the stalk back to it, or the
 * revert that took a bean off. Pure.
 */
export function verdictsOf(
  activity: readonly {
    readonly kind: string;
    readonly sha: string | null;
    readonly text: string;
    readonly at: string;
  }[],
): ReadonlyMap<string, Verdict> {
  const verdicts = new Map<string, Verdict>();
  for (const line of activity) {
    const kind = VERDICT_KINDS[line.kind];
    if (kind === undefined || line.sha === null || verdicts.has(line.sha)) continue;
    verdicts.set(line.sha, { kind, text: line.text, at: line.at });
  }
  return verdicts;
}

/** The `Task: <id>` trailer the engine writes on a landing commit. */
export function trailerTask(message: string): string | null {
  const found = /^Task:\s*(\S+)\s*$/m.exec(message);
  return found?.[1] ?? null;
}
