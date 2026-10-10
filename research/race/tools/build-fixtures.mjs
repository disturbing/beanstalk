// Builds the web app's recorded-run fixtures from the race runs in research/race/runs.
//
//   node research/race/tools/build-fixtures.mjs
//
// For each run it writes packages/web/fixtures/<run>/:
//   events.jsonl   the run's events, slimmed to the fields the web app reads (no local paths)
//   summary.json   the run's summary.json, minus account details
//   tasks.json     the arena tasks of the run: id, title, prompt (the bean's intent), tests
//   repo.json      the run repo as git saw it: the base, every commit of the line (the sprout,
//                  or the stalk for the queue), every bean head, their trees and file contents
//
// Everything in repo.json comes from git: the commits are read from the agents' worktrees
// (work/agents/*), which fetched the run repo as it grew. A line commit that no worktree saw
// (the last landing) is rebuilt the way the runner squashes (`git merge-tree --merge-base`,
// then a commit by beanstalk-runner) and must hash to the recorded sha, or the build fails.
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

const REPO_ROOT = resolve(import.meta.dirname, '../../..');
const OUT_DIR = join(REPO_ROOT, 'packages/web/fixtures');
const ARENA_TASKS = join(REPO_ROOT, 'research/arena/tasks');
const ARENA_GIT = join(REPO_ROOT, 'research/corpora/arena.git');

/**
 * The recorded Cloudflare runs of the demo (`docs/claude-opus/12`, seed 7, 12 Sonnet agents):
 * Gitstalk v2.5 with dependency-aware starts against the merge queue.
 */
const RUNS = [
  {
    run: 'j6boaclinn',
    dir: 'research/race/runs/cf-v25dep2-sonnet-12-s7',
    policyLabel: 'beanstalk',
  },
  {
    run: 'u0ntf65lbe',
    dir: 'research/race/runs/cf-queue-sonnet-12-s7-landed',
    policyLabel: 'queue',
  },
];

/** The runner's union preset for v2 (`unionPaths`); the queue merges without it. */
const UNION_PATTERNS = ['CHANGELOG.md', 'CHANGELOG*.md', '**/CHANGELOG.md'];
const RUNNER_IDENT = 'beanstalk-runner <runner@beanstalk.invalid>';
/** How far before its landing a rebuilt commit's timestamp is searched (it was squashed then). */
const REBUILD_WINDOW_SECONDS = 900;

/** Fields kept per event type; the envelope (seq, t, ts, type) is always kept. */
const KEEP = {
  'race.setup': ['policy', 'repo', 'arena_digest', 'setup_seconds'],
  'footprint.predicted': ['task', 'method', 'selected'],
  'invocation.end': [
    'inv',
    'kind',
    'task',
    'agent',
    'spent_usd',
    'ok',
    'killed',
    'infra_error',
    'timed_out',
    'subtype',
    'is_error',
    'cost_usd',
    'cost_source',
    'num_turns',
    'wall_ms',
    'tool_uses',
    'result_text',
  ],
  'invocation.start': ['inv', 'kind', 'task', 'agent', 'adapter', 'model', 'attempt', 'resume'],
};
/** Events dropped whole: the agent's session init (local paths, plugin list). */
const DROP = new Set(['invocation.init']);
/** Patterns that must never reach a fixture. */
const SECRET_PATTERNS = [
  /sk-ant-[a-z0-9-]{8,}/i,
  /\bbst1\.[A-Za-z0-9_-]{8,}/,
  /\bBearer\s+[A-Za-z0-9._-]{12,}/,
  /\bgh[pousr]_[A-Za-z0-9]{20,}/,
  /\bAKIA[0-9A-Z]{16}\b/,
  /-----BEGIN [A-Z ]*PRIVATE KEY-----/,
  // Local paths: macOS and Linux homes, temp and per-user cache directories.
  /\/Users\/[A-Za-z0-9._-]+\//,
  /\/home\/[A-Za-z0-9._-]+\//,
  /\/(?:private\/var|var\/folders|private\/tmp)\//,
  // Cloudflare account and zone ids (32 hex digits standing alone; git shas have 40).
  /(?<![0-9a-f])[0-9a-f]{32}(?![0-9a-f])/,
  // A deployed gateway's address names the account's workers.dev subdomain.
  /\b[a-z0-9-]+\.[a-z0-9-]+\.workers\.dev\b/i,
];
/**
 * Summary keys copied; account details (`subscription`), platform usage (`infra`), the run
 * repo's state (`repos`) and footprint research stay out.
 */
const SUMMARY_KEYS = [
  'label',
  'policy',
  'agent',
  'model',
  'arena_base',
  'arena_digest',
  'config',
  'aborted',
  'wall_seconds',
  'tasks',
  'tasks_green',
  'tasks_landed',
  'tasks_dropped',
  'acceptance_restored',
  'drops_by_reason',
  'changes_green_per_hour',
  'wall_to_all_green_seconds',
  'task_start_to_green_seconds',
  'agent_minutes',
  'agent_minutes_per_agent',
  'invocations',
  'cost_usd',
  'cost_by_kind',
  'ci_runs',
  'ci_runs_total',
  'ci_minutes',
  'ci_minutes_total',
  'textual_conflicts',
  'red_validations',
  'final',
  'per_task',
  'beanstalk',
  'queue',
];

main();

function main() {
  mkdirSync(OUT_DIR, { recursive: true });
  for (const spec of RUNS) buildRun(spec);
}

function buildRun(spec) {
  const runDir = join(REPO_ROOT, spec.dir);
  const events = readEvents(join(runDir, 'events.jsonl'));
  const store = openStore(runDir);
  try {
    const repo = buildRepo(store, events, spec);
    const outDir = join(OUT_DIR, spec.run);
    mkdirSync(outDir, { recursive: true });
    writeChecked(
      join(outDir, 'events.jsonl'),
      events.flatMap(slimEvent).map(stableJson).join('\n') + '\n',
    );
    writeChecked(join(outDir, 'summary.json'), `${JSON.stringify(trimSummary(runDir), null, 1)}\n`);
    writeChecked(join(outDir, 'tasks.json'), `${JSON.stringify(readTasks(events), null, 1)}\n`);
    writeChecked(join(outDir, 'repo.json'), `${JSON.stringify(repo)}\n`);
    report(
      `${spec.run}: ${events.length} events, ${repo.line.length} line commits, ` +
        `${repo.beanHeads.length} bean heads, ${repo.paths.length} paths, ${repo.blobs.length} blobs`,
    );
  } finally {
    rmSync(store.dir, { recursive: true, force: true });
  }
}

// ---------------------------------------------------------------------------------------
// The object store: one bare repo whose alternates are every worktree of the run.

function openStore(runDir) {
  const dir = mkdtempSync(join(tmpdir(), 'gitstalk-fixture-'));
  git(dir, ['init', '--bare', '--quiet', '.']);
  const worktrees = [
    ...readdirSync(join(runDir, 'work/agents')).map((name) => join(runDir, 'work/agents', name)),
    join(runDir, 'work/seed'),
  ];
  const objectDirs = [
    join(ARENA_GIT, 'objects'),
    ...worktrees.map((tree) => join(tree, '.git/objects')).filter((path) => existsSync(path)),
  ];
  writeFileSync(join(dir, 'objects/info/alternates'), `${objectDirs.join('\n')}\n`);
  return { dir };
}

function hasObject(store, sha) {
  try {
    git(store.dir, ['cat-file', '-e', `${sha}^{commit}`]);
    return true;
  } catch {
    // `cat-file -e` exits non-zero exactly when the object is absent.
    return false;
  }
}

// ---------------------------------------------------------------------------------------
// The repo: the base, the line commits, the bean heads, their trees and blobs.

function buildRepo(store, events, spec) {
  const start = events.find((event) => event.type === 'race.start');
  if (start === undefined) throw new Error(`${spec.run}: no race.start`);
  const base = start.base;
  const titles = taskTitles(events);
  const lands = landingsInLineOrder(events);
  const line = [];
  let parent = base;
  for (const land of lands) {
    const commit = ensureLineCommit(store, { land, parent, events, titles, spec });
    line.push({ ...commit, parent });
    parent = land.sha;
  }
  const lineHead = parent;
  const beanHeads = events
    .filter((event) => event.type === 'task.commit')
    .map((event) => beanHead(store, event, lineHead));
  const commits = [base, ...line.map((commit) => commit.sha), ...beanHeads.map((head) => head.sha)];
  const mergeBases = beanHeads.map((head) => head.mergeBase);
  const treeShas = [...new Set([...commits, ...mergeBases])];
  return { base, ...internTrees(store, treeShas), line, beanHeads };
}

/** `land` events in the order their commits sit on the line (the sprout, or the queue's stalk). */
function landingsInLineOrder(events) {
  const lands = events.filter(
    (event) => event.type === 'land' && (event.target === 'trunk' || event.target === 'main'),
  );
  if (lands.every((land) => typeof land.trunk_idx === 'number')) {
    return lands.toSorted((a, b) => a.trunk_idx - b.trunk_idx);
  }
  return lands;
}

function ensureLineCommit(store, { land, parent, events, titles, spec }) {
  const commit = {
    sha: land.sha,
    task: land.task ?? null,
    kind: land.kind ?? 'task',
    idx: land.trunk_idx ?? null,
    t: land.t,
    rebuilt: false,
  };
  if (hasObject(store, land.sha)) {
    assertParent(store, land.sha, parent);
    return { ...commit, ...diffStats(store, parent, land.sha) };
  }
  rebuildLanding(store, { land, parent, events, title: titles.get(land.task), spec });
  return { ...commit, rebuilt: true, ...diffStats(store, parent, land.sha) };
}

function assertParent(store, sha, parent) {
  const parents = git(store.dir, ['rev-list', '--parents', '-n', '1', sha])
    .trim()
    .split(' ')
    .slice(1);
  if (parents.length !== 1 || parents[0] !== parent) {
    throw new Error(`line commit ${sha} has parents ${parents.join(',')}, expected ${parent}`);
  }
}

/**
 * Rebuilds a landing no worktree fetched, exactly as the runner's squash does: the bean's
 * head merged onto the line with their merge base, committed by beanstalk-runner. The
 * timestamp is searched until the commit hashes to the recorded sha.
 */
function rebuildLanding(store, { land, parent, events, title, spec }) {
  if (title === undefined) throw new Error(`no title for ${land.task}`);
  const head = lastCommitBefore(events, land.task, land.t);
  const mergeBase = git(store.dir, ['merge-base', head, parent]).trim();
  const tree = mergeTree(store, {
    parent,
    head,
    mergeBase,
    union: spec.policyLabel === 'beanstalk',
  });
  const message = `${title}\n\nTask: ${land.task}\nPolicy: ${spec.policyLabel}\n`;
  const landedAt = Math.floor(Date.parse(land.ts) / 1000);
  for (let at = landedAt + 2; at >= landedAt - REBUILD_WINDOW_SECONDS; at -= 1) {
    const body = commitBody({ tree, parent, at, message });
    if (gitObjectSha('commit', body) !== land.sha) continue;
    const written = git(store.dir, ['hash-object', '-t', 'commit', '-w', '--stdin'], body).trim();
    if (written !== land.sha) throw new Error(`wrote ${written}, expected ${land.sha}`);
    report(`  rebuilt ${land.sha.slice(0, 10)} (${land.task}) from ${head.slice(0, 10)}`);
    return;
  }
  throw new Error(`could not rebuild ${land.sha} (${land.task}): no timestamp matched`);
}

function lastCommitBefore(events, task, t) {
  const commits = events.filter(
    (event) => event.type === 'task.commit' && event.task === task && event.t <= t,
  );
  const last = commits.at(-1);
  if (last === undefined) throw new Error(`no commit of ${task} before t=${t}`);
  return last.sha;
}

function mergeTree(store, { parent, head, mergeBase, union }) {
  const attributes = join(store.dir, 'union-attributes');
  writeFileSync(attributes, union ? UNION_PATTERNS.map((p) => `${p} merge=union\n`).join('') : '');
  const output = git(store.dir, [
    '-c',
    `core.attributesFile=${attributes}`,
    'merge-tree',
    '--write-tree',
    `--merge-base=${mergeBase}`,
    parent,
    head,
  ]);
  return output.split('\n')[0];
}

function commitBody({ tree, parent, at, message }) {
  return (
    `tree ${tree}\nparent ${parent}\nauthor ${RUNNER_IDENT} ${at} +0000\n` +
    `committer ${RUNNER_IDENT} ${at} +0000\n\n${message}`
  );
}

function gitObjectSha(type, body) {
  const bytes = Buffer.from(body, 'utf8');
  return createHash('sha1').update(`${type} ${bytes.length}\0`).update(bytes).digest('hex');
}

/** One bean head (`task.commit`): its own change is what it adds on top of the line. */
function beanHead(store, event, lineHead) {
  if (!hasObject(store, event.sha))
    throw new Error(`bean head ${event.sha} (${event.task}) missing`);
  const mergeBase = git(store.dir, ['merge-base', event.sha, lineHead]).trim();
  return {
    task: event.task,
    sha: event.sha,
    kind: event.kind,
    t: event.t,
    mergeBase,
    ...diffStats(store, mergeBase, event.sha),
  };
}

function diffStats(store, from, to) {
  const numstat = git(store.dir, ['diff', '--numstat', '--no-renames', from, to]);
  const statuses = new Map(
    git(store.dir, ['diff', '--name-status', '--no-renames', from, to])
      .split('\n')
      .filter((row) => row !== '')
      .map((row) => {
        const [status, path] = row.split('\t');
        return [path, status];
      }),
  );
  const files = numstat
    .split('\n')
    .filter((row) => row !== '')
    .map((row) => {
      const [additions, deletions, path] = row.split('\t');
      return {
        path,
        status: statuses.get(path) ?? 'M',
        additions: Number(additions),
        deletions: Number(deletions),
      };
    });
  return { files };
}

/** Trees as [pathIndex, blobIndex] pairs over shared, de-duplicated paths and contents. */
function internTrees(store, shas) {
  const listings = new Map(shas.map((sha) => [sha, listTree(store, sha)]));
  const paths = [
    ...new Set([...listings.values()].flatMap((entries) => entries.map((e) => e.path))),
  ].toSorted(compareText);
  const blobShas = [
    ...new Set([...listings.values()].flatMap((entries) => entries.map((e) => e.blob))),
  ];
  const contents = readBlobs(store, blobShas);
  const pathIndex = new Map(paths.map((path, index) => [path, index]));
  const blobIndex = new Map(blobShas.map((sha, index) => [sha, index]));
  const trees = Object.fromEntries(
    [...listings].map(([sha, entries]) => [
      sha,
      entries.flatMap((entry) => [pathIndex.get(entry.path), blobIndex.get(entry.blob)]),
    ]),
  );
  return { paths, blobs: blobShas.map((sha) => contents.get(sha)), trees };
}

function listTree(store, sha) {
  return git(store.dir, ['ls-tree', '-r', '-z', sha])
    .split('\0')
    .filter((row) => row !== '')
    .map((row) => {
      const [meta, path] = row.split('\t');
      const [, type, blob] = meta.split(' ');
      if (type !== 'blob') throw new Error(`unexpected ${type} at ${path} in ${sha}`);
      return { path, blob };
    });
}

function readBlobs(store, shas) {
  const contents = new Map();
  for (const sha of shas) {
    const text = git(store.dir, ['cat-file', 'blob', sha]);
    if (text.includes('\0')) throw new Error(`binary blob ${sha}: the arena has none`);
    contents.set(sha, text);
  }
  return contents;
}

// ---------------------------------------------------------------------------------------
// Events, summary and tasks.

function readEvents(path) {
  return readFileSync(path, 'utf8')
    .split('\n')
    .filter((line) => line.trim() !== '')
    .map((line) => JSON.parse(line));
}

function slimEvent(event) {
  if (DROP.has(event.type)) return [];
  const keep = KEEP[event.type];
  if (keep === undefined) return [event];
  const slim = { seq: event.seq, t: event.t, ts: event.ts, type: event.type };
  for (const key of keep) if (key in event) slim[key] = event[key];
  return [slim];
}

function stableJson(value) {
  return JSON.stringify(value);
}

function trimSummary(runDir) {
  const summary = JSON.parse(readFileSync(join(runDir, 'summary.json'), 'utf8'));
  return Object.fromEntries(
    SUMMARY_KEYS.filter((key) => key in summary).map((key) => [key, summary[key]]),
  );
}

function taskTitles(events) {
  const ids = events.find((event) => event.type === 'race.start')?.tasks ?? [];
  return new Map(ids.map((id) => [id, readTask(id).title]));
}

/** What a bean is for: the arena task's title and prompt (its intent) and its own tests. */
function readTasks(events) {
  const ids = events.find((event) => event.type === 'race.start')?.tasks ?? [];
  return ids.map((id) => {
    const task = readTask(id);
    return {
      id: task.id,
      title: task.title,
      intent: task.prompt,
      kind: task.kind,
      tests: Object.keys(task.acceptance_tests).toSorted(compareText),
    };
  });
}

function readTask(id) {
  return JSON.parse(readFileSync(join(ARENA_TASKS, `${id}.json`), 'utf8'));
}

// ---------------------------------------------------------------------------------------

function writeChecked(path, text) {
  const leak = SECRET_PATTERNS.find((pattern) => pattern.test(text));
  if (leak !== undefined) throw new Error(`${path} matches ${leak}: refusing to write it`);
  writeFileSync(path, text);
}

function git(cwd, args, input) {
  return execFileSync('git', args, {
    cwd,
    input,
    encoding: 'utf8',
    maxBuffer: 64 * 1024 * 1024,
    env: { ...process.env, GIT_CONFIG_NOSYSTEM: '1', GIT_CONFIG_GLOBAL: '/dev/null', LC_ALL: 'C' },
    stdio: ['pipe', 'pipe', 'pipe'],
  });
}

/** Byte order, so paths sort the same everywhere (no locale). */
function compareText(a, b) {
  if (a < b) return -1;
  if (a > b) return 1;
  return 0;
}

function report(line) {
  process.stdout.write(`${line}\n`);
}
