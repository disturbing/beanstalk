/**
 * Who may do what with the dependency cache, decided per job from its spec and the executor's
 * settings (doc 27 §4.2, §4.5, §4.9). The container never names a repository or a scope: the
 * Worker derives both from the job's record, and the job's steps hold only a random bearer.
 */
import { z } from 'zod';

import type { JobSpec } from '../contract';

/** The executor's cache settings, from its vars. */
export type DepsSettings = {
  readonly enabled: boolean;
  readonly snapshotMaxBytes: number;
  readonly tmpfsMaxBytes: number;
  readonly repoMaxBytes: number;
  readonly idleDays: number;
};

/** What one job may do. */
export type DepsGrant = {
  readonly repoId: string;
  /** Scopes read in order: the job's own, then the default branch's. */
  readonly readScopes: readonly string[];
  /** The scope it saves into, or null when it only reads. */
  readonly saveScope: string | null;
  readonly sourceRef: string;
  readonly snapshotMaxBytes: number;
  readonly tmpfsMaxBytes: number;
};

/** The scope of the default branch (Beanstalk's trunk). */
export const DEFAULT_SCOPE = 'stalk';
/** The repository or org variable that changes the snapshot cap (`2GiB`, `500MB`, bytes). */
export const SNAPSHOT_MAX_VARIABLE = 'BEANSTALK_DEPS_SNAPSHOT_MAX';
/** The repository or org variable that turns the cache off for a repository (`off`). */
export const SWITCH_VARIABLE = 'BEANSTALK_DEPS_CACHE';

const GIB = 1024 ** 3;
const Vars = z.object({
  DEPS_CACHE_MODE: z.enum(['on', 'off']).default('on'),
  DEPS_SNAPSHOT_MAX_BYTES: z.coerce
    .number()
    .int()
    .positive()
    .default(4 * GIB),
  DEPS_TMPFS_MAX_BYTES: z.coerce
    .number()
    .int()
    .positive()
    .default(6 * GIB),
  DEPS_REPO_MAX_BYTES: z.coerce.number().int().positive().default(10_000_000_000),
  DEPS_IDLE_DAYS: z.coerce.number().int().positive().default(7),
});

/** Parses the executor's cache vars; throws on a misconfigured deployment. */
export function readDepsSettings(env: object): DepsSettings {
  const vars = Vars.parse({
    DEPS_CACHE_MODE: Reflect.get(env, 'DEPS_CACHE_MODE'),
    DEPS_SNAPSHOT_MAX_BYTES: Reflect.get(env, 'DEPS_SNAPSHOT_MAX_BYTES'),
    DEPS_TMPFS_MAX_BYTES: Reflect.get(env, 'DEPS_TMPFS_MAX_BYTES'),
    DEPS_REPO_MAX_BYTES: Reflect.get(env, 'DEPS_REPO_MAX_BYTES'),
    DEPS_IDLE_DAYS: Reflect.get(env, 'DEPS_IDLE_DAYS'),
  });
  return {
    enabled: vars.DEPS_CACHE_MODE === 'on',
    snapshotMaxBytes: vars.DEPS_SNAPSHOT_MAX_BYTES,
    tmpfsMaxBytes: vars.DEPS_TMPFS_MAX_BYTES,
    repoMaxBytes: vars.DEPS_REPO_MAX_BYTES,
    idleDays: vars.DEPS_IDLE_DAYS,
  };
}

/** The job's grant, or null when the cache is off for it. */
export function grantFor(spec: JobSpec, settings: DepsSettings): DepsGrant | null {
  if (!settings.enabled) return null;
  const vars = spec.vars ?? {};
  if (/^(off|false|0|no|disabled)$/i.test((vars[SWITCH_VARIABLE] ?? '').trim())) return null;
  const scope = spec.depsCache?.scope ?? DEFAULT_SCOPE;
  const asked = parseSize(vars[SNAPSHOT_MAX_VARIABLE]);
  return {
    repoId: spec.repo.id,
    readScopes: [...new Set([scope, DEFAULT_SCOPE])],
    saveScope: spec.depsCache?.canSave === true ? scope : null,
    sourceRef: spec.context.ref,
    snapshotMaxBytes: Math.min(asked ?? settings.snapshotMaxBytes, settings.repoMaxBytes),
    tmpfsMaxBytes: settings.tmpfsMaxBytes,
  };
}

/** `4GiB`, `500 MB`, `1.5gb` or plain bytes; null when absent or unreadable. */
export function parseSize(text: string | undefined): number | null {
  if (text === undefined) return null;
  const match = /^\s*(\d+(?:\.\d+)?)\s*(b|kb|kib|mb|mib|gb|gib|tb|tib)?\s*$/i.exec(text);
  if (match === null) return null;
  const units: Readonly<Record<string, number>> = {
    b: 1,
    kb: 1e3,
    kib: 1024,
    mb: 1e6,
    mib: 1024 ** 2,
    gb: 1e9,
    gib: GIB,
    tb: 1e12,
    tib: 1024 ** 4,
  };
  const bytes = Number(match[1]) * (units[(match[2] ?? 'b').toLowerCase()] ?? 1);
  return Number.isFinite(bytes) && bytes > 0 ? Math.floor(bytes) : null;
}

/** A random bearer for one job's steps (32 bytes, base64url). */
export function newDepsToken(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(32));
  return btoa(String.fromCharCode(...bytes))
    .replaceAll('+', '-')
    .replaceAll('/', '_')
    .replace(/=+$/, '');
}

/** Constant-time comparison of two bearers. */
export function sameToken(given: string, expected: string): boolean {
  const encoder = new TextEncoder();
  const a = encoder.encode(given);
  const b = encoder.encode(expected);
  return a.byteLength === b.byteLength && crypto.subtle.timingSafeEqual(a, b);
}
