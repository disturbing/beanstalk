/**
 * What a repository engine remembers about its checks, in its RunDO's SQLite: each clean
 * squash of a bean (the tree it would land as, the sprout commit it was merged onto, the files
 * it changes), so the pre-land check of that tree can apply the sprout's protected paths; and
 * the lines each checked tree gave the pushes (which checks ran, or why none did).
 */
import { z } from 'zod';

import { Sha } from '@gitstalk/shared-race/ids';

/** Rows kept per table; older rows concern beans long landed or reworked. */
const KEPT_ROWS = 500;

/** A bean merged onto the sprout: the tree its pre-land check runs on. */
export type LandingTree = {
  readonly sha: Sha;
  readonly task: string;
  readonly onto: Sha;
  readonly files: readonly string[];
};

const Files = z.array(z.string());
const Lines = z.array(z.string());

export function migrateCheckStore(sql: SqlStorage): void {
  sql.exec(
    'CREATE TABLE IF NOT EXISTS landing_trees (sha TEXT PRIMARY KEY, task TEXT NOT NULL, onto TEXT NOT NULL, files TEXT NOT NULL, at INTEGER NOT NULL)',
  );
  sql.exec(
    'CREATE TABLE IF NOT EXISTS check_lines (sha TEXT PRIMARY KEY, lines TEXT NOT NULL, at INTEGER NOT NULL)',
  );
}

export function saveLandingTree(sql: SqlStorage, tree: LandingTree, atMs: number): void {
  sql.exec(
    'INSERT OR REPLACE INTO landing_trees (sha, task, onto, files, at) VALUES (?, ?, ?, ?, ?)',
    tree.sha,
    tree.task,
    tree.onto,
    JSON.stringify(tree.files),
    atMs,
  );
  prune(sql, 'landing_trees');
}

export function readLandingTree(sql: SqlStorage, sha: string): LandingTree | null {
  const row = sql
    .exec<{ task: string; onto: string; files: string }>(
      'SELECT task, onto, files FROM landing_trees WHERE sha = ?',
      sha,
    )
    .toArray()[0];
  if (row === undefined) return null;
  const files = Files.safeParse(JSON.parse(row.files));
  const ids = z.object({ sha: Sha, onto: Sha }).safeParse({ sha, onto: row.onto });
  if (!files.success || !ids.success) return null;
  return { ...ids.data, task: row.task, files: files.data };
}

export function saveCheckLines(
  sql: SqlStorage,
  sha: string,
  lines: readonly string[],
  atMs: number,
): void {
  sql.exec(
    'INSERT OR REPLACE INTO check_lines (sha, lines, at) VALUES (?, ?, ?)',
    sha,
    JSON.stringify(lines),
    atMs,
  );
  prune(sql, 'check_lines');
}

/** The lines the check of `sha` gave; empty when it gave none (or is not a repository's). */
export function readCheckLines(sql: SqlStorage, sha: string): readonly string[] {
  const row = sql
    .exec<{ lines: string }>('SELECT lines FROM check_lines WHERE sha = ?', sha)
    .toArray()[0];
  if (row === undefined) return [];
  const lines = Lines.safeParse(JSON.parse(row.lines));
  return lines.success ? lines.data : [];
}

function prune(sql: SqlStorage, table: 'landing_trees' | 'check_lines'): void {
  sql.exec(
    `DELETE FROM ${table} WHERE sha NOT IN (SELECT sha FROM ${table} ORDER BY at DESC, sha LIMIT ?)`,
    KEPT_ROWS,
  );
}
