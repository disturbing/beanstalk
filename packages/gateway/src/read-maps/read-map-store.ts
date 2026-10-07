/**
 * The run's read maps, in its RunDO's SQLite: one row per (traced tree, test file) with what
 * the file read, probed and listed there, and the manifest (path to blob id) of every traced
 * tree and of every check that asked for one. Whatever ran traced adds its rows; queries use
 * each test file's newest map unless asked for one tree's. `ReadMapIndex` is the engine's
 * view of it (`EngineEnv.readMaps`).
 */
import { z } from 'zod';

import type {
  AffectedAnswer,
  AffectedQuery,
  CheckReadMaps,
  CheckedTree,
  ReadMapSummary,
} from '@beanstalk/shared-race/read-maps';

import type { Manifest, StoredReadMap } from './affected-tests';
import { affectedTests, isDefaultTestFile } from './affected-tests';

/**
 * The engine's read-only view of the store. Synchronous (SQLite in the RunDO), so a step can
 * ask it; answers depend only on what checks have reported so far.
 */
export type ReadMapIndex = {
  /** Which test files may observe `query.changes` (see `AffectedQuery`). */
  affectedTests(query: AffectedQuery): AffectedAnswer;
  /** Whether `tree` has maps (a traced check of it reported). */
  hasMaps(tree: string): boolean;
  summary(): ReadMapSummary;
};

/** Traced trees whose maps are kept beyond each test file's newest. */
const KEPT_TREES = 200;
/** Manifests kept (each a few KB to a few hundred KB). */
const KEPT_MANIFESTS = 400;

/** A map row's JSON body. */
const MapBody = z.object({
  reads: z.array(z.string()),
  probes: z.array(z.string()),
  dirs: z.array(z.string()),
  packages: z.array(z.string()),
  hashes: z.record(z.string(), z.string()),
  seconds: z.number(),
});
type MapBody = z.infer<typeof MapBody>;
/** A manifest row's JSON body. */
const Blobs = z.record(z.string(), z.string());

type MapRow = {
  tree: string;
  test: string;
  environment: string | null;
  body: string;
};

/** Creates the tables if they do not exist (idempotent; safe in the constructor). */
export function migrateReadMaps(sql: SqlStorage): void {
  sql.exec(
    `CREATE TABLE IF NOT EXISTS read_maps (
       tree TEXT NOT NULL,
       test TEXT NOT NULL,
       environment TEXT,
       passed INTEGER NOT NULL,
       traced_at REAL NOT NULL,
       body TEXT NOT NULL,
       PRIMARY KEY (tree, test)
     )`,
  );
  sql.exec('CREATE INDEX IF NOT EXISTS read_maps_by_test ON read_maps (test, traced_at)');
  sql.exec(
    `CREATE TABLE IF NOT EXISTS read_map_trees (
       tree TEXT PRIMARY KEY,
       commit_sha TEXT NOT NULL,
       blobs TEXT NOT NULL,
       recorded_at REAL NOT NULL
     )`,
  );
}

/**
 * The key of a checked tree: its commit, or the commit plus a digest of its blobs when extra
 * files were written over it (the tree is then not the commit's).
 */
export function treeKey(tree: CheckedTree): string {
  return tree.extra_files ? `${tree.commit}+${digest(JSON.stringify(tree.blobs))}` : tree.commit;
}

/**
 * Stores what one check reported: the tree's manifest, and a map per traced test file (an
 * untraced file's row is dropped so it reads as unmapped). Returns the tree's key, or null when
 * the check reported no tree.
 */
export function recordCheck(
  sql: SqlStorage,
  report: { tree: CheckedTree | null; readMaps: CheckReadMaps | null; atMs: number },
): string | null {
  const { tree, readMaps, atMs } = report;
  if (tree === null) return null;
  const key = treeKey(tree);
  sql.exec(
    'INSERT OR REPLACE INTO read_map_trees (tree, commit_sha, blobs, recorded_at) VALUES (?, ?, ?, ?)',
    key,
    tree.commit,
    JSON.stringify(tree.blobs),
    atMs,
  );
  if (readMaps?.status === 'traced') {
    for (const file of readMaps.files) {
      if (!file.traced) {
        sql.exec('DELETE FROM read_maps WHERE tree = ? AND test = ?', key, file.file);
        continue;
      }
      const body: MapBody = {
        reads: file.reads,
        probes: file.probes,
        dirs: file.dirs,
        packages: file.packages,
        hashes: file.hashes,
        seconds: file.seconds,
      };
      sql.exec(
        `INSERT OR REPLACE INTO read_maps (tree, test, environment, passed, traced_at, body)
         VALUES (?, ?, ?, ?, ?, ?)`,
        key,
        file.file,
        readMaps.environment ?? null,
        file.passed ? 1 : 0,
        atMs,
        JSON.stringify(body),
      );
    }
  }
  prune(sql);
  return key;
}

/** The index over `sql` the engine and the read routes use. */
export function sqlReadMapIndex(sql: SqlStorage): ReadMapIndex {
  return {
    affectedTests: (query) => answer(sql, query),
    hasMaps: (tree) =>
      sql.exec<{ n: number }>('SELECT COUNT(*) AS n FROM read_maps WHERE tree = ?', tree).one().n >
      0,
    summary: () => summarize(sql),
  };
}

function answer(sql: SqlStorage, query: AffectedQuery): AffectedAnswer {
  const maps = loadMaps(sql, query.mapsFrom ?? null);
  const added = query.changes
    .filter((change) => change.op === 'A' && isDefaultTestFile(change.path))
    .map((change) => change.path);
  const universe = query.tests ?? [...maps.keys(), ...added];
  const manifests = new Map<string, Manifest | null>();
  const manifestOf = (tree: string): Manifest | null => {
    if (!manifests.has(tree)) manifests.set(tree, loadManifest(sql, tree));
    return manifests.get(tree) ?? null;
  };
  return affectedTests({
    maps,
    universe,
    changes: query.changes,
    base: query.base ?? null,
    environment: newestEnvironment(sql),
    manifestOf,
  });
}

function loadMaps(sql: SqlStorage, tree: string | null): Map<string, StoredReadMap> {
  const rows =
    tree === null
      ? sql
          .exec<MapRow>(
            `SELECT tree, test, environment, body FROM read_maps AS outer_map
             WHERE traced_at = (SELECT MAX(traced_at) FROM read_maps WHERE test = outer_map.test)`,
          )
          .toArray()
      : sql
          .exec<MapRow>('SELECT tree, test, environment, body FROM read_maps WHERE tree = ?', tree)
          .toArray();
  const maps = new Map<string, StoredReadMap>();
  for (const row of rows) {
    const body = MapBody.parse(JSON.parse(row.body));
    maps.set(row.test, {
      test: row.test,
      tree: row.tree,
      environment: row.environment,
      reads: body.reads,
      probes: body.probes,
      dirs: body.dirs,
      packages: body.packages,
    });
  }
  return maps;
}

function loadManifest(sql: SqlStorage, tree: string): Manifest | null {
  const row = sql
    .exec<{ blobs: string }>('SELECT blobs FROM read_map_trees WHERE tree = ?', tree)
    .toArray()[0];
  if (row === undefined) return null;
  return new Map(Object.entries(Blobs.parse(JSON.parse(row.blobs))));
}

function newestEnvironment(sql: SqlStorage): string | null {
  const row = sql
    .exec<{ environment: string | null }>(
      'SELECT environment FROM read_maps ORDER BY traced_at DESC LIMIT 1',
    )
    .toArray()[0];
  return row?.environment ?? null;
}

function summarize(sql: SqlStorage): ReadMapSummary {
  const count = (query: string): number => sql.exec<{ n: number }>(query).one().n;
  const trees = sql
    .exec<{ tree: string; files: number; traced_at: number }>(
      `SELECT tree, COUNT(*) AS files, MAX(traced_at) AS traced_at FROM read_maps
       GROUP BY tree ORDER BY traced_at DESC LIMIT 50`,
    )
    .toArray()
    .map((row) => ({ tree: row.tree, files: row.files, tracedAtMs: row.traced_at }));
  return {
    tests: count('SELECT COUNT(DISTINCT test) AS n FROM read_maps'),
    maps: count('SELECT COUNT(*) AS n FROM read_maps'),
    trees,
    manifests: count('SELECT COUNT(*) AS n FROM read_map_trees'),
    environment: newestEnvironment(sql),
  };
}

/** Keeps each test file's newest map, the maps of the newest traced trees, and recent manifests. */
function prune(sql: SqlStorage): void {
  sql.exec(
    `DELETE FROM read_maps
     WHERE tree NOT IN (
       SELECT tree FROM read_maps GROUP BY tree ORDER BY MAX(traced_at) DESC LIMIT ?
     )
     AND traced_at < (SELECT MAX(traced_at) FROM read_maps AS newest WHERE newest.test = read_maps.test)`,
    KEPT_TREES,
  );
  sql.exec(
    `DELETE FROM read_map_trees
     WHERE tree NOT IN (SELECT tree FROM read_map_trees ORDER BY recorded_at DESC LIMIT ?)
     AND tree NOT IN (SELECT DISTINCT tree FROM read_maps)`,
    KEPT_MANIFESTS,
  );
}

/** A short, stable digest of `text` (cyrb53): enough to tell extra-file trees apart. */
function digest(text: string): string {
  let first = 0xdeadbeef;
  let second = 0x41c6ce57;
  for (let index = 0; index < text.length; index += 1) {
    const code = text.charCodeAt(index);
    first = Math.imul(first ^ code, 2_654_435_761);
    second = Math.imul(second ^ code, 1_597_334_677);
  }
  first =
    Math.imul(first ^ (first >>> 16), 2_246_822_507) ^
    Math.imul(second ^ (second >>> 13), 3_266_489_909);
  second =
    Math.imul(second ^ (second >>> 16), 2_246_822_507) ^
    Math.imul(first ^ (first >>> 13), 3_266_489_909);
  return (4_294_967_296 * (2_097_151 & second) + (first >>> 0)).toString(16);
}
