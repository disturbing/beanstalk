/**
 * A timing harness for the live Ask path (`docs/claude-opus/14` §11): the gateway's own repo
 * explorer and import-closure code, run over a simulated Artifacts binding that serves a
 * recorded run's repo, with a fixed latency per Artifacts call and per RPC hop. Tests drive it
 * under fake timers, so the latencies cost no wall time and the measured time is the critical
 * path of the round trips. CPU time is not modelled (it is measured separately, at zero latency).
 *
 * Test support only: the deployed gateway is never called.
 */
import type { RunId } from '@gitstalk/shared-race/ids';
import { TaskId } from '@gitstalk/shared-race/ids';
import type { BeanSummary, GatewayRpc, RpcResult, TestCoverage } from '@gitstalk/shared-race/rpc';

import type { GatewayBinding } from '@gitstalk/shared-ask/forge/gateway-rpc';
import { repoExplorer } from '../../../../gateway/src/adapters/repo-explorer';
import { importClosures } from '../../../../gateway/src/repo/import-closure';
import { cachedReader, memoryObjectStore } from '../../../../gateway/src/repo/object-cache';
import { recordedSource } from '../recorded-source';
import type { RecordedRun } from '../../recorded/recorded-runs';

export type SimulatedLatency = {
  /** One call on the Artifacts binding or a repo handle (`get`, `readTree`, `readBlob` …). */
  readonly artifactsMs: number;
  /** One service-binding RPC hop (web → gateway, gateway → RunDO). */
  readonly hopMs: number;
  /**
   * `parallel`: Artifacts calls overlap freely. `serial`: the repo answers one call at a time
   * (a repo is one Durable Object), so every call waits for the ones before it.
   */
  readonly artifacts: 'parallel' | 'serial';
};

export type CallCounts = {
  /** Calls on the Artifacts binding, by method. */
  readonly artifacts: Map<string, number>;
  /** RPC calls the web app made on the gateway, by method. */
  readonly rpc: Map<string, number>;
};

export type SimulatedGateway = {
  readonly binding: GatewayBinding<Fetcher>;
  readonly counts: CallCounts;
  /** What the RunDO did at each landing of the run: read the new head's objects into the index. */
  warmLandings(): Promise<void>;
};

/**
 * `none`: the gateway before the read index (repo reads in the gateway Worker, straight to
 * Artifacts). `objects`: repo reads in the RunDO through its object cache.
 */
export type ReadPath = 'none' | 'objects';

/** The gateway's RPC with answers reduced to the fields the web app reads. */
type LooseRpc = {
  readonly [M in keyof GatewayRpc]: (
    ...args: Parameters<NonNullable<GatewayRpc[M]>>
  ) => Promise<unknown>;
};

/** Files the closures of one `testsFor` call may read (the RunDO's bound). */
const MAX_CLOSURE_READS = 400;

/** A gateway for `recorded`, as if it were a live run whose race just ended. */
export function simulatedGateway(
  recorded: RecordedRun,
  latency: SimulatedLatency,
  readPath: ReadPath = 'objects',
): SimulatedGateway {
  const counts: CallCounts = { artifacts: new Map(), rpc: new Map() };
  const store = repoStore(recorded);
  const artifacts = simulatedArtifacts(store, { latency, counts });
  const index: Parameters<typeof cachedReader>[1] = {
    store: memoryObjectStore(),
    refs: new Map(),
    now: () => Date.now(),
  };
  const explorer =
    readPath === 'none'
      ? repoExplorer(artifacts, 'race')
      : repoExplorer(artifacts, 'race', (handle) => cachedReader(handle, index));
  const forge = recordedSource({ fixture: recorded });
  const run = recorded.run;
  const hop = <T>(method: string, answer: () => Promise<T>): Promise<T> => {
    bump(counts.rpc, method);
    return delay(latency.hopMs).then(answer);
  };
  /** A RunDO read: one more hop, from the gateway to the run's Durable Object. */
  const viaRun = <T>(answer: () => Promise<T>): Promise<T> => delay(latency.hopMs).then(answer);
  /** A stream read: one more hop, from the gateway to the run's RunStreamDO. */
  const viaStreams = <T>(answer: () => Promise<T>): Promise<T> => delay(latency.hopMs).then(answer);
  /** A repo read: in the gateway Worker before the index, in the RunDO with it. */
  const viaRepo = <T>(answer: () => Promise<T>): Promise<T> =>
    readPath === 'none' ? answer() : viaRun(answer);

  const rpc: LooseRpc = {
    listRuns: () => hop('listRuns', () => Promise.resolve([])),
    runView: () => hop('runView', () => viaRun(async () => ok(runView(run)))),
    runEvents: (_run, after, limit) =>
      hop('runEvents', () =>
        viaRun(async () => {
          const events = recorded.events.filter((event) => event.seq > after).slice(0, limit);
          return ok({
            events: events.map((event) => JSON.stringify(event)),
            next_after: events.at(-1)?.seq ?? after,
            done: events.length < limit,
          });
        }),
      ),
    decide: () => hop('decide', () => Promise.resolve(unavailable())),
    viewToken: () => hop('viewToken', () => Promise.resolve(unavailable())),
    repoTree: (_run, ref, path = '', recursive = false) =>
      hop('repoTree', () => viaRepo(async () => ok(await explorer.tree(ref, path, recursive)))),
    repoFile: (_run, ref, path) =>
      hop('repoFile', () => viaRepo(async () => ok(await explorer.file(ref, path)))),
    repoDiff: (_run, from, to, paths) =>
      hop('repoDiff', () => viaRepo(async () => ok(await explorer.diff(from, to, paths ?? null)))),
    repoLog: (_run, ref, paths, limit) =>
      hop('repoLog', () => viaRepo(async () => ok(await explorer.log(ref, paths, limit)))),
    repoGrep: (_run, ref, pattern, paths) =>
      hop('repoGrep', () =>
        viaRepo(async () => ok(await explorer.grep(ref, pattern, paths ?? null))),
      ),
    beansByPath: (_run, paths) =>
      hop('beansByPath', () =>
        viaRun(async () => ok((await forge.beansByPath(run, paths)).map(toSummary))),
      ),
    beanDetail: (_run, bean) =>
      hop('beanDetail', () =>
        viaRun(async () => {
          const detail = await forge.beanDetail(run, TaskId.parse(bean));
          if (detail === undefined) return unavailable();
          const landed = recorded.repo.line.find((commit) => commit.task === detail.id);
          return ok({
            ...toSummary(detail),
            base_sha: detail.diffBase,
            head_sha: detail.diffHead,
            landed_sha: landed?.sha ?? null,
            started_at: detail.startedAt,
            landed_at: detail.landedAt,
            green_at: detail.greenAt,
            drop_reason: detail.dropReason,
            acceptance: detail.tests.map((path) => ({ path, amended: false })),
            invocations: [],
            checks: [],
            reworks: [],
            decisions: [],
          });
        }),
      ),
    decisions: () =>
      hop('decisions', () =>
        viaRun(async () => {
          const cards = await forge.decisions(run);
          return ok(
            cards.map((card) => ({ card: card.card, by: null, outcome: null, files: card.files })),
          );
        }),
      ),
    testsFor: (_run, paths) =>
      hop('testsFor', () => viaRun(async () => ok(await testCoverage(recorded, explorer, paths)))),
    verifyViewToken: () => hop('verifyViewToken', () => Promise.resolve(unavailable())),
    // Streams answer from the run's RunStreamDO: one more hop, never the RunDO (a recorded
    // run has nothing streaming).
    beanStreams: () => hop('beanStreams', () => viaStreams(async () => ok([]))),
    beanStream: () => hop('beanStream', () => viaStreams(async () => ok(null))),
  };
  return {
    binding: {
      // The client validates every answer (`gateway-rpc.ts` schemas) and reads only the
      // fields built here, so the partial answers stand in for the gateway's full ones.
      ...(rpc as unknown as GatewayRpc),
      fetch: () => Promise.resolve(new Response('not simulated', { status: 404 })),
      connect: () => {
        throw new Error('the simulated gateway has no sockets');
      },
    },
    counts,
    warmLandings: async () => {
      for (const head of [
        recorded.repo.base,
        ...recorded.repo.line.map((landing) => landing.sha),
      ]) {
        // oxlint-disable-next-line no-await-in-loop -- landings happen one after another
        await explorer.warm(head);
      }
    },
  };
}

/** The RunDO's `testsFor`, as `run-views.ts` computes it: closures on the landed line. */
async function testCoverage(
  recorded: RecordedRun,
  explorer: ReturnType<typeof repoExplorer>,
  paths: readonly string[],
): Promise<TestCoverage[]> {
  const line = await explorer.resolve('sprout');
  if (line === null) return [];
  const owners = new Map<string, string>();
  const known: Record<string, string> = {};
  for (const task of recorded.tasks) {
    for (const path of task.tests) {
      const text = sproutText(recorded, path);
      if (text === undefined) continue;
      owners.set(path, task.id);
      known[path] = text;
    }
  }
  const listing = await explorer.listFiles(line.commit);
  const files = new Set([...listing.files, ...Object.keys(known)]);
  const { closures } = await importClosures({
    known,
    files,
    read: (wanted) => explorer.readTexts(line.commit, wanted),
    maxReads: MAX_CLOSURE_READS,
  });
  return [...closures.entries()].flatMap(([test, closure]) => {
    const covers = paths.filter((path) =>
      [...closure].some((file) => file === path || file.startsWith(`${path}/`)),
    );
    if (covers.length === 0) return [];
    return [
      {
        test,
        task: owners.get(test) ?? '?',
        status: 'green' as const,
        covers,
        closure_size: closure.size,
        amended: false,
      },
    ];
  });
}

function sproutText(recorded: RecordedRun, path: string): string | undefined {
  const sprout = recorded.repo.line.at(-1)?.sha ?? recorded.repo.base;
  const pairs = recorded.repo.trees[sprout] ?? [];
  for (let index = 0; index + 1 < pairs.length; index += 2) {
    if (recorded.repo.paths[pairs[index] ?? -1] === path)
      return recorded.repo.blobs[pairs[index + 1] ?? -1];
  }
  return undefined;
}

function toSummary(bean: {
  readonly id: string;
  readonly title: string;
  readonly intent: string;
  readonly agent: string | null;
  readonly files: readonly string[];
}): BeanSummary {
  return {
    bean: bean.id,
    branch: `beans/${bean.id}`,
    title: bean.title,
    intent: bean.intent,
    status: 'green',
    agent: bean.agent,
    files: bean.files,
    head_sha: null,
    landed_sha: null,
    cards: [],
  };
}

/** The part of the run view the web app reads (`policy_state`). */
function runView(run: RunId) {
  return { run, policy_state: null };
}

function ok<T>(value: T): RpcResult<T> {
  return { ok: true, value };
}

function unavailable(): RpcResult<never> {
  return { ok: false, error: { code: 'not_found', status: 404, message: 'not simulated' } };
}

function bump(counts: Map<string, number>, key: string): void {
  counts.set(key, (counts.get(key) ?? 0) + 1);
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

// ---------------------------------------------------------------------------------------------
// The simulated Artifacts repo: git objects with content-derived ids, as the real one has.

type RepoStore = {
  readonly commits: Map<string, ArtifactsCommitMetadata>;
  readonly trees: Map<string, ArtifactsTreeEntry[]>;
  readonly blobs: Map<string, string>;
  readonly refs: Map<string, string>;
};

function repoStore(recorded: RecordedRun): RepoStore {
  const store: RepoStore = {
    commits: new Map(),
    trees: new Map(),
    blobs: new Map(),
    refs: new Map(),
  };
  const { repo } = recorded;
  const parents = new Map<string, string[]>([[repo.base, []]]);
  for (const commit of repo.line) parents.set(commit.sha, [commit.parent]);
  for (const head of repo.beanHeads) parents.set(head.sha, [head.mergeBase]);
  for (const [sha, pairs] of Object.entries(repo.trees)) {
    const files = new Map<string, string>();
    for (let index = 0; index + 1 < pairs.length; index += 2) {
      const path = repo.paths[pairs[index] ?? -1];
      const text = repo.blobs[pairs[index + 1] ?? -1];
      if (path !== undefined && text !== undefined) files.set(path, text);
    }
    const tree = writeTree(store, files);
    store.commits.set(sha, commitOf(sha, tree, parents.get(sha) ?? []));
  }
  const sprout = repo.line.at(-1)?.sha ?? repo.base;
  store.refs.set('sprout', sprout);
  store.refs.set('stalk', sprout);
  for (const head of repo.beanHeads) store.refs.set(`beans/${head.task}`, head.sha);
  return store;
}

function commitOf(sha: string, tree: string, parents: string[]): ArtifactsCommitMetadata {
  const person = { name: 'gitstalk-runner', email: 'runner@gitstalk.invalid' };
  return {
    hash: sha,
    treeHash: tree,
    message: `commit ${sha.slice(0, 8)}`,
    author: person,
    committer: person,
    parents,
    authoredAt: 0,
    committedAt: 0,
  };
}

/** Writes the tree of `files` (paths from its root) and returns its id. */
function writeTree(store: RepoStore, files: ReadonlyMap<string, string>): string {
  const here = new Map<string, string>();
  const below = new Map<string, Map<string, string>>();
  for (const [path, text] of files) {
    const slash = path.indexOf('/');
    if (slash < 0) {
      here.set(path, text);
      continue;
    }
    const dir = path.slice(0, slash);
    const nested = below.get(dir) ?? new Map<string, string>();
    nested.set(path.slice(slash + 1), text);
    below.set(dir, nested);
  }
  const entries: ArtifactsTreeEntry[] = [];
  for (const [name, nested] of below)
    entries.push({ name, mode: '40000', type: 'tree', hash: writeTree(store, nested) });
  for (const [name, text] of here) {
    const hash = objectId(`blob ${text}`);
    store.blobs.set(hash, text);
    entries.push({ name, mode: '100644', type: 'blob', hash });
  }
  entries.sort((a, b) => (a.name < b.name ? -1 : 1));
  const id = objectId(`tree ${entries.map((entry) => `${entry.name}:${entry.hash}`).join(',')}`);
  store.trees.set(id, entries);
  return id;
}

/** A 40-hex id derived from the content (five FNV-1a passes with different seeds). */
function objectId(content: string): string {
  let id = '';
  for (const seed of [0x811c9dc5, 0x01000193, 0x9e3779b9, 0x85ebca6b, 0xc2b2ae35]) {
    let hash = seed >>> 0;
    for (let index = 0; index < content.length; index += 1) {
      hash ^= content.charCodeAt(index);
      hash = Math.imul(hash, 0x01000193) >>> 0;
    }
    id += hash.toString(16).padStart(8, '0');
  }
  return id;
}

function simulatedArtifacts(
  store: RepoStore,
  sim: { readonly latency: SimulatedLatency; readonly counts: CallCounts },
): Artifacts {
  let queue: Promise<void> = Promise.resolve();
  const op = async <T>(method: string, answer: () => T): Promise<T> => {
    bump(sim.counts.artifacts, method);
    if (sim.latency.artifacts === 'parallel') {
      await delay(sim.latency.artifactsMs);
      return answer();
    }
    const turn = queue.then(() => delay(sim.latency.artifactsMs));
    queue = turn;
    await turn;
    return answer();
  };
  const resolve = (ref: string): ArtifactsCommitMetadata | undefined =>
    store.commits.get(store.refs.get(ref) ?? ref);
  const handle = {
    readTree: (hash: string) => op('readTree', () => store.trees.get(hash) ?? null),
    readBlob: (hash: string) =>
      op('readBlob', () => {
        const text = store.blobs.get(hash);
        return text === undefined ? null : blob(text);
      }),
    readCommit: (hash: string) => op('readCommit', () => store.commits.get(hash) ?? null),
    readFile: (args: { ref: string; path: string }) =>
      op('readFile', () => {
        const commit = resolve(args.ref);
        const text = commit === undefined ? undefined : fileAt(store, commit.treeHash, args.path);
        return text === undefined ? null : blob(text);
      }),
    log: (opts?: { ref?: string; limit?: number }) =>
      op('log', () => {
        const commits: ArtifactsCommitMetadata[] = [];
        let current = resolve(opts?.ref ?? 'sprout');
        while (current !== undefined && commits.length < (opts?.limit ?? 50)) {
          commits.push(current);
          const parent = current.parents[0];
          current = parent === undefined ? undefined : store.commits.get(parent);
        }
        return commits;
      }),
    [Symbol.dispose]: () => undefined,
  };
  return {
    get: (_name: string) => op('get', () => handle),
  } as unknown as Artifacts;
}

function blob(text: string): Blob {
  return new Blob([text]);
}

function fileAt(store: RepoStore, root: string, path: string): string | undefined {
  let tree: string | undefined = root;
  const segments = path.split('/');
  for (const [index, segment] of segments.entries()) {
    const entry: ArtifactsTreeEntry | undefined = store.trees
      .get(tree ?? '')
      ?.find((candidate) => candidate.name === segment);
    if (entry === undefined) return undefined;
    if (index === segments.length - 1) return store.blobs.get(entry.hash);
    tree = entry.hash;
  }
  return undefined;
}
