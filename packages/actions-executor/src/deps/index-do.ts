/**
 * DepsCacheIndex: one Durable Object per repository (named by its id) indexing that
 * repository's dependency snapshots (doc 27 §4.2, §4.10). It answers lookups in the
 * `actions/cache` restore-keys order, commits manifests (the commit point of a save), enforces
 * the per-repository total by evicting the least recently restored snapshots, and once a day
 * sweeps idle snapshots and chunks no manifest references. When the repository is deleted,
 * `forget` drops the index and every object of the repository (doc 27 §10.8); the sweep does the
 * same for a repository the gateway no longer knows, in case that call never arrived.
 *
 * Objects in R2: `deps/<repoId>/chunks/<sha256>.tar.zst` (immutable) and
 * `deps/<repoId>/manifests/<scope>/<snapshotKey>.json`.
 */
import { DurableObject } from 'cloudflare:workers';

import { readConfig } from '../config';
import { createLogger } from '../log';
import type { Logger } from '../log';
import type { RepositoryForgotten } from '../contract';
import { purgePrefix, repoPrefix, repositoryStatus } from './forget';
import { readDepsSettings } from './grant';
import type { DepsSettings } from './grant';
import type { LookupMatch, Manifest } from './wire';

const DAY_MS = 24 * 60 * 60 * 1000;
/** An unreferenced chunk younger than this may belong to a save in progress. */
const CHUNK_GRACE_MS = DAY_MS;

/** A snapshot found by a lookup. */
export type IndexHit = {
  readonly match: Exclude<LookupMatch, 'none'>;
  readonly scope: string;
  readonly snapshotKey: string;
};

export type IndexLookup = {
  readonly hit: IndexHit | null;
  /** The family's chunk count, kept across lockfile changes; null for a new family. */
  readonly chunkCount: number | null;
};

export type CommitInput = {
  readonly repoId: string;
  readonly scope: string;
  readonly sourceRef: string;
  readonly manifest: Manifest;
  readonly snapshotMaxBytes: number;
};

export type CommitOutcome = { readonly saved: boolean; readonly reason: string | null };

/** R2 key prefixes of one repository. */
export function chunkKey(repoId: string, sha256: string): string {
  return `deps/${repoId}/chunks/${sha256}.tar.zst`;
}

export function manifestKey(repoId: string, scope: string, snapshotKey: string): string {
  return `deps/${repoId}/manifests/${encodeURIComponent(scope)}/${snapshotKey}.json`;
}

export class DepsCacheIndex extends DurableObject<Env> {
  readonly #sql: SqlStorage;
  readonly #settings: DepsSettings;
  readonly #log: Logger;

  constructor(ctx: DurableObjectState, env: Env) {
    super(ctx, env);
    this.#sql = ctx.storage.sql;
    this.#settings = readDepsSettings(env);
    this.#log = createLogger(readConfig(env).logLevel, { component: 'deps-index' });
    this.#sql.exec(`CREATE TABLE IF NOT EXISTS snapshots (
      scope TEXT NOT NULL, snapshot_key TEXT NOT NULL, family_key TEXT NOT NULL,
      repo_id TEXT NOT NULL, compressed_bytes INTEGER NOT NULL, extracted_bytes INTEGER NOT NULL,
      created_ms INTEGER NOT NULL, last_used_ms INTEGER NOT NULL, source_ref TEXT NOT NULL,
      PRIMARY KEY (scope, snapshot_key))`);
    this.#sql.exec(`CREATE TABLE IF NOT EXISTS snapshot_chunks (
      scope TEXT NOT NULL, snapshot_key TEXT NOT NULL, sha256 TEXT NOT NULL, bytes INTEGER NOT NULL,
      PRIMARY KEY (scope, snapshot_key, sha256))`);
    this.#sql.exec('CREATE TABLE IF NOT EXISTS meta (name TEXT PRIMARY KEY, value TEXT NOT NULL)');
    this.#sql.exec(`CREATE TABLE IF NOT EXISTS families (
      family_key TEXT PRIMARY KEY, chunk_count INTEGER NOT NULL,
      refused_bytes INTEGER, refused_ms INTEGER)`);
  }

  /** Exact key in any readable scope, else the family's latest in the first scope that has one. */
  async lookup(input: {
    readonly repoId: string;
    readonly scopes: readonly string[];
    readonly familyKey: string;
    readonly snapshotKey: string;
  }): Promise<IndexLookup> {
    const family = this.#sql
      .exec<{ chunk_count: number }>(
        'SELECT chunk_count FROM families WHERE family_key = ?',
        input.familyKey,
      )
      .toArray()[0];
    const chunkCount = family?.chunk_count ?? null;
    if (this.#isForgotten()) return { hit: null, chunkCount: null };
    // Every repository that uses the cache gets the daily sweep, so chunks of a save that
    // never committed, or of a repository deleted while its forget call failed, are found.
    this.#rememberRepo(input.repoId);
    await this.#ensureAlarm();
    for (const scope of input.scopes) {
      const exact = this.#sql
        .exec<{ snapshot_key: string }>(
          'SELECT snapshot_key FROM snapshots WHERE scope = ? AND snapshot_key = ?',
          scope,
          input.snapshotKey,
        )
        .toArray()[0];
      if (exact !== undefined)
        return { hit: this.#used('exact', scope, exact.snapshot_key), chunkCount };
    }
    for (const scope of input.scopes) {
      const latest = this.#sql
        .exec<{ snapshot_key: string }>(
          `SELECT snapshot_key FROM snapshots WHERE scope = ? AND family_key = ?
           ORDER BY created_ms DESC LIMIT 1`,
          scope,
          input.familyKey,
        )
        .toArray()[0];
      if (latest !== undefined)
        return { hit: this.#used('partial', scope, latest.snapshot_key), chunkCount };
    }
    return { hit: null, chunkCount };
  }

  /**
   * The commit point of a save: every chunk must already be in R2 and the total under the cap.
   * Over the cap the refusal is recorded on the family and the previous snapshot stays.
   */
  async commit(input: CommitInput): Promise<CommitOutcome> {
    const { manifest, repoId } = input;
    if (this.#isForgotten()) return { saved: false, reason: 'the repository was deleted' };
    this.#rememberRepo(repoId);
    const compressed = manifest.chunks.reduce((sum, chunk) => sum + chunk.bytes, 0);
    if (compressed > input.snapshotMaxBytes) {
      this.#sql.exec(
        `INSERT INTO families (family_key, chunk_count, refused_bytes, refused_ms) VALUES (?, ?, ?, ?)
         ON CONFLICT (family_key) DO UPDATE SET refused_bytes = excluded.refused_bytes,
         refused_ms = excluded.refused_ms`,
        manifest.familyKey,
        manifest.chunkCount,
        compressed,
        Date.now(),
      );
      return {
        saved: false,
        reason: `the snapshot is ${compressed} bytes compressed, over the ${input.snapshotMaxBytes}-byte limit; restores keep using the previous snapshot`,
      };
    }
    const missing = await this.#missingChunks(repoId, manifest);
    if (missing.length > 0)
      return { saved: false, reason: `${missing.length} chunks were not uploaded` };
    await this.env.DEPS_CACHE.put(
      manifestKey(repoId, input.scope, manifest.snapshotKey),
      JSON.stringify(manifest),
      { httpMetadata: { contentType: 'application/json' } },
    );
    this.#record(repoId, input, compressed);
    await this.#evictOverTotal(repoId, manifest.snapshotKey);
    await this.#ensureAlarm();
    return { saved: true, reason: null };
  }

  /**
   * The repository was deleted: drop the index and every object under `deps/<repoId>/`.
   * Idempotent. The index stays marked as forgotten, so a job of the deleted repository that is
   * still running can neither restore nor commit; its late uploads, and anything a failed purge
   * left, go in the sweep a day later.
   */
  async forget(repoId: string): Promise<RepositoryForgotten> {
    this.#rememberRepo(repoId);
    this.#sql.exec(
      "INSERT OR IGNORE INTO meta (name, value) VALUES ('forgotten_ms', ?)",
      String(Date.now()),
    );
    this.#sql.exec('DELETE FROM snapshots');
    this.#sql.exec('DELETE FROM snapshot_chunks');
    this.#sql.exec('DELETE FROM families');
    await this.ctx.storage.setAlarm(Date.now() + DAY_MS);
    try {
      const objectsDeleted = await purgePrefix(this.env.DEPS_CACHE, repoPrefix(repoId));
      this.#log.info('deps forgotten', { repo: repoId, objects_deleted: objectsDeleted });
      return { purged: true, objectsDeleted };
    } catch (error: unknown) {
      this.#log.warn('deps purge failed; the sweep retries', { repo: repoId, error });
      return { purged: false, objectsDeleted: 0 };
    }
  }

  /** The daily sweep: idle snapshots, then chunks nothing references. */
  override async alarm(): Promise<void> {
    const repoId = this.#sql
      .exec<{ value: string }>("SELECT value FROM meta WHERE name = 'repo_id'")
      .toArray()[0]?.value;
    if (repoId === undefined) return;
    if (this.#isForgotten()) return this.#purgeAgain(repoId);
    if ((await repositoryStatus(this.env, repoId)) === 'gone') {
      this.#log.info('deps of a deleted repository found by the sweep', { repo: repoId });
      await this.forget(repoId);
      return;
    }
    const now = Date.now();
    const idle = this.#sql
      .exec<{ scope: string; snapshot_key: string }>(
        'SELECT scope, snapshot_key FROM snapshots WHERE last_used_ms < ?',
        now - this.#settings.idleDays * DAY_MS,
      )
      .toArray();
    await Promise.all(
      idle.map(async (snapshot) => this.#forget(repoId, snapshot.scope, snapshot.snapshot_key)),
    );
    const chunks = await this.#sweepChunks(repoId, now);
    this.#log.info('deps sweep', {
      repo: repoId,
      idle: idle.length,
      chunks_deleted: chunks.deleted,
    });
    const left = this.#sql.exec<{ n: number }>('SELECT COUNT(*) AS n FROM snapshots').one().n;
    if (left > 0 || chunks.kept > 0) await this.ctx.storage.setAlarm(now + DAY_MS);
  }

  /** For tests and the admin view: the repository's snapshots and total bytes. */
  async summary(): Promise<{
    readonly snapshots: number;
    readonly totalBytes: number;
    readonly forgotten: boolean;
  }> {
    return {
      snapshots: this.#sql.exec<{ n: number }>('SELECT COUNT(*) AS n FROM snapshots').one().n,
      totalBytes: this.#totalBytes(),
      forgotten: this.#isForgotten(),
    };
  }

  #isForgotten(): boolean {
    return this.#sql.exec("SELECT 1 FROM meta WHERE name = 'forgotten_ms'").toArray().length > 0;
  }

  #rememberRepo(repoId: string): void {
    this.#sql.exec("INSERT OR REPLACE INTO meta (name, value) VALUES ('repo_id', ?)", repoId);
  }

  /** A forgotten repository's sweep: whatever arrived or stayed since; again a day later until empty. */
  async #purgeAgain(repoId: string): Promise<void> {
    const deleted = await purgePrefix(this.env.DEPS_CACHE, repoPrefix(repoId)).catch(
      (error: unknown) => {
        this.#log.warn('deps purge failed; retrying tomorrow', { repo: repoId, error });
        return -1;
      },
    );
    if (deleted > 0) this.#log.info('deps purged late objects', { repo: repoId, deleted });
    if (deleted !== 0) await this.ctx.storage.setAlarm(Date.now() + DAY_MS);
  }

  #used(match: IndexHit['match'], scope: string, snapshotKey: string): IndexHit {
    this.#sql.exec(
      'UPDATE snapshots SET last_used_ms = ? WHERE scope = ? AND snapshot_key = ?',
      Date.now(),
      scope,
      snapshotKey,
    );
    return { match, scope, snapshotKey };
  }

  #record(repoId: string, input: CommitInput, compressed: number): void {
    const { manifest } = input;
    const now = Date.now();
    this.#sql.exec(
      `INSERT OR REPLACE INTO snapshots (scope, snapshot_key, family_key, repo_id, compressed_bytes,
       extracted_bytes, created_ms, last_used_ms, source_ref) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      input.scope,
      manifest.snapshotKey,
      manifest.familyKey,
      repoId,
      compressed,
      manifest.extractedBytes,
      now,
      now,
      input.sourceRef,
    );
    this.#sql.exec(
      'DELETE FROM snapshot_chunks WHERE scope = ? AND snapshot_key = ?',
      input.scope,
      manifest.snapshotKey,
    );
    for (const chunk of manifest.chunks)
      this.#sql.exec(
        'INSERT OR IGNORE INTO snapshot_chunks (scope, snapshot_key, sha256, bytes) VALUES (?, ?, ?, ?)',
        input.scope,
        manifest.snapshotKey,
        chunk.sha256,
        chunk.bytes,
      );
    this.#sql.exec(
      `INSERT INTO families (family_key, chunk_count) VALUES (?, ?)
       ON CONFLICT (family_key) DO UPDATE SET chunk_count = excluded.chunk_count,
       refused_bytes = NULL, refused_ms = NULL`,
      manifest.familyKey,
      manifest.chunkCount,
    );
  }

  async #missingChunks(repoId: string, manifest: Manifest): Promise<string[]> {
    const unique = [...new Set(manifest.chunks.map((chunk) => chunk.sha256))];
    const heads = await Promise.all(
      unique.map(async (sha) =>
        (await this.env.DEPS_CACHE.head(chunkKey(repoId, sha))) === null ? sha : null,
      ),
    );
    return heads.filter((sha): sha is string => sha !== null);
  }

  /** Least recently used snapshots go until the repository is under its total. */
  async #evictOverTotal(repoId: string, keep: string): Promise<void> {
    while (this.#totalBytes() > this.#settings.repoMaxBytes) {
      const oldest = this.#sql
        .exec<{ scope: string; snapshot_key: string }>(
          'SELECT scope, snapshot_key FROM snapshots WHERE snapshot_key != ? ORDER BY last_used_ms ASC LIMIT 1',
          keep,
        )
        .toArray()[0];
      if (oldest === undefined) return;
      // oxlint-disable-next-line no-await-in-loop -- one eviction at a time until under the total
      await this.#forget(repoId, oldest.scope, oldest.snapshot_key);
    }
  }

  #totalBytes(): number {
    return (
      this.#sql
        .exec<{ total: number | null }>(
          'SELECT SUM(bytes) AS total FROM (SELECT DISTINCT sha256, bytes FROM snapshot_chunks)',
        )
        .one().total ?? 0
    );
  }

  async #forget(repoId: string, scope: string, snapshotKey: string): Promise<void> {
    this.#sql.exec(
      'DELETE FROM snapshots WHERE scope = ? AND snapshot_key = ?',
      scope,
      snapshotKey,
    );
    this.#sql.exec(
      'DELETE FROM snapshot_chunks WHERE scope = ? AND snapshot_key = ?',
      scope,
      snapshotKey,
    );
    await this.env.DEPS_CACHE.delete(manifestKey(repoId, scope, snapshotKey));
  }

  /** Deletes unreferenced chunks past the grace period; `kept` counts the chunks left. */
  async #sweepChunks(
    repoId: string,
    now: number,
  ): Promise<{ readonly deleted: number; readonly kept: number }> {
    const referenced = new Set(
      this.#sql
        .exec<{ sha256: string }>('SELECT DISTINCT sha256 FROM snapshot_chunks')
        .toArray()
        .map((row) => row.sha256),
    );
    const prefix = `deps/${repoId}/chunks/`;
    let deleted = 0;
    let kept = 0;
    let cursor: string | undefined = undefined;
    do {
      // oxlint-disable-next-line no-await-in-loop -- R2 listing pages follow each other
      const page: R2Objects = await this.env.DEPS_CACHE.list({
        prefix,
        limit: 1000,
        ...(cursor === undefined ? {} : { cursor }),
      });
      const stale = page.objects
        .filter((object) => !referenced.has(object.key.slice(prefix.length, -'.tar.zst'.length)))
        .filter((object) => object.uploaded.getTime() < now - CHUNK_GRACE_MS)
        .map((object) => object.key);
      // oxlint-disable-next-line no-await-in-loop -- delete this page before the next
      if (stale.length > 0) await this.env.DEPS_CACHE.delete(stale);
      deleted += stale.length;
      kept += page.objects.length - stale.length;
      cursor = page.truncated ? page.cursor : undefined;
    } while (cursor !== undefined);
    return { deleted, kept };
  }

  async #ensureAlarm(): Promise<void> {
    if ((await this.ctx.storage.getAlarm()) === null)
      await this.ctx.storage.setAlarm(Date.now() + DAY_MS);
  }
}
