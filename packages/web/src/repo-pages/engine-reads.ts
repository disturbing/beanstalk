/**
 * What a repository's tabs read from its engine, through the GATEWAY binding, for one request:
 * each read happens at most once per request (a page that needs the pushed beans twice asks
 * once), independent reads run together, and every answer is validated. Code, Changes and
 * History each make a fixed number of calls, never one per bean or per file.
 */
import { z } from 'zod';

import { RunId, Sha, TaskId } from '@beanstalk/shared-race/ids';
import type { RpcResult } from '@beanstalk/shared-race/rpc';

import { allEvents } from '@beanstalk/shared-ask/ask/plan-context';
import type { ForgeSource } from '@beanstalk/shared-ask/forge/forge-source';
import type { RaceEvent } from '@beanstalk/shared-ask/race/race-events';
import type { RefName, RepoDiff, RepoTree } from '@beanstalk/shared-ask/repo/repo-types';
import type { PushedBean } from '../changes/pushed-beans';
import { readPushedBeans } from '../changes/pushed-beans';
import type { RefChoice } from '../code/tree';
import { forgeForRun } from '../forge/sources';
import type { LogCommit } from '../history/history';
import { LogCommit as LogCommitSchema } from '../history/history';

/** Commits each line's history shows. */
export const HISTORY_LIMIT = 100;

export type FileBlob = {
  readonly path: string;
  readonly size: number;
  readonly binary: boolean;
  /** Null for a binary file. */
  readonly content: string | null;
  readonly truncated: boolean;
};

export type EngineReads = {
  readonly engine: RunId;
  readonly source: ForgeSource;
  events(): Promise<readonly RaceEvent[]>;
  pushed(): Promise<readonly PushedBean[]>;
  /** The ref a choice browses: a line by name, a bean by its pushed head; null for an unknown bean. */
  resolve(ref: RefChoice): Promise<RefName | null>;
  tree(ref: RefName): Promise<RepoTree>;
  file(ref: RefName, path: string): Promise<FileBlob | null>;
  log(ref: 'stalk' | 'sprout'): Promise<readonly LogCommit[]>;
  /** A bean's own change: its landing, or its newest head against its base. */
  beanDiff(bean: string): Promise<RepoDiff | null>;
};

const FileAnswer = z.object({
  path: z.string(),
  size: z.number(),
  binary: z.boolean(),
  content: z.string().nullable(),
  truncated: z.boolean(),
});
const LogAnswer = z.object({ commits: z.array(LogCommitSchema) });

/** Raw reads the forge source does not carry (a file's binary flag, commit authors and dates). */
type RawReads = {
  repoFile(run: string, ref: string, path: string): Promise<RpcResult<unknown>>;
  repoLog(run: string, ref: string, paths: null, limit: number): Promise<RpcResult<unknown>>;
};

export function engineReads(binding: Fetcher, engine: RunId): EngineReads {
  const source = forgeForRun(binding, engine);
  const raw = hasRawReads(binding) ? binding : null;
  const events = once<readonly RaceEvent[]>();
  const pushed = once<readonly PushedBean[]>();
  const trees = once<RepoTree>();
  const files = once<FileBlob | null>();
  const logs = once<readonly LogCommit[]>();
  const diffs = once<RepoDiff | null>();
  const readPushed = () => pushed('', () => readPushedBeans(binding, engine));
  return {
    engine,
    source,
    events: () => events('', () => allEvents(source, engine)),
    pushed: readPushed,
    resolve: async (ref) => {
      if (ref.kind === 'commit') return Sha.safeParse(ref.sha).data ?? null;
      if (ref.kind !== 'bean') return ref.kind;
      const head = Sha.safeParse((await readPushed()).find((bean) => bean.bean === ref.name)?.head);
      return head.success ? head.data : null;
    },
    tree: (ref) => trees(ref, () => source.repoTree(engine, ref)),
    file: (ref, path) =>
      files(`${ref}:${path}`, async () => {
        const answer = await raw?.repoFile(engine, ref, path);
        return answer?.ok === true ? FileAnswer.parse(answer.value) : null;
      }),
    log: (ref) =>
      logs(ref, async () => {
        const answer = await raw?.repoLog(engine, ref, null, HISTORY_LIMIT);
        return answer?.ok === true ? LogAnswer.parse(answer.value).commits : [];
      }),
    beanDiff: (bean) =>
      diffs(bean, async () => {
        const id = TaskId.safeParse(bean);
        const detail = id.success ? await source.beanDetail(engine, id.data) : undefined;
        if (detail === undefined || detail.diffBase === null || detail.diffHead === null)
          return null;
        return source.repoDiff(engine, detail.diffBase, detail.diffHead);
      }),
  };
}

function hasRawReads(binding: object): binding is RawReads {
  return ['repoFile', 'repoLog'].every(
    (method) => typeof Reflect.get(binding, method) === 'function',
  );
}

/** The engine of a repository record, or null for a record whose engine id is malformed. */
export function engineOf(engineId: string): RunId | null {
  const parsed = RunId.safeParse(engineId);
  return parsed.success ? parsed.data : null;
}

/** A per-request cache of one kind of read: the first call for a key reads, later ones share it. */
function once<T>(): (key: string, read: () => Promise<T>) => Promise<T> {
  const reads = new Map<string, Promise<T>>();
  return (key, read) => {
    const cached = reads.get(key);
    if (cached !== undefined) return cached;
    const started = read();
    reads.set(key, started);
    return started;
  };
}
