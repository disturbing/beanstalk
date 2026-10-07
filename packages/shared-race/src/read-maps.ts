/**
 * Per-test-file read maps (the runner's traced checks, `packages/runner/src/check/trace`) and
 * the question the engine asks of them: "given these changed paths, which test files may
 * observe them?". The method and its evidence are `research/test-impact/README.md`.
 */
import { z } from 'zod';

/** How a path changed: modified, added or deleted (a rename is a delete plus an add). */
export const PathOp = z.enum(['M', 'A', 'D']);
export type PathOp = z.infer<typeof PathOp>;

export const PathChange = z.strictObject({
  path: z.string().min(1).max(4096),
  op: PathOp,
});
export type PathChange = z.infer<typeof PathChange>;

/** One test file's map as the runner reports it (`read_maps.files[]`). */
export const TestReadMap = z.object({
  file: z.string().min(1),
  passed: z.boolean(),
  tests: z.number().int().min(0),
  failures: z.number().int().min(0),
  seconds: z.number().min(0),
  timed_out: z.boolean(),
  /** False when the runner could not read the trace: the file counts as unmapped. */
  traced: z.boolean(),
  reads: z.array(z.string()),
  probes: z.array(z.string()),
  dirs: z.array(z.string()),
  packages: z.array(z.string()),
  /** Blob ids of the read files that are files of the checked tree. */
  hashes: z.record(z.string(), z.string()),
});
export type TestReadMap = z.infer<typeof TestReadMap>;

/** `read_maps` of a check response. */
export const CheckReadMaps = z.object({
  status: z.enum(['traced', 'unavailable']),
  reason: z.string().optional(),
  environment: z.string().optional(),
  files: z.array(TestReadMap),
});
export type CheckReadMaps = z.infer<typeof CheckReadMaps>;

/** `tree` of a check response: the checked tree's blob ids. */
export const CheckedTree = z.object({
  commit: z.string().regex(/^[0-9a-f]{40}([0-9a-f]{24})?$/),
  extra_files: z.boolean(),
  blobs: z.record(z.string(), z.string()),
});
export type CheckedTree = z.infer<typeof CheckedTree>;

/**
 * "Which test files may observe `changes`?"
 *
 * - `base`: the tree the changes apply to (a commit sha). A map traced on another tree is
 *   compared with `base` through both trees' manifests; without them it is stale.
 * - `mapsFrom`: use only the maps traced on this tree (evidence promotion asks about the tree
 *   it checked); absent, each test file's newest map.
 * - `tests`: the test files that exist (the universe); absent, every mapped test file plus each
 *   added path that matches node's default test patterns.
 */
export const AffectedQuery = z.strictObject({
  changes: z.array(PathChange).max(100_000),
  base: z.string().min(1).max(200).optional(),
  mapsFrom: z.string().min(1).max(200).optional(),
  tests: z.array(z.string().min(1)).max(100_000).optional(),
});
export type AffectedQuery = z.infer<typeof AffectedQuery>;

/**
 * Why a test file is affected:
 * - `own-change`: the test file itself changed.
 * - `unmapped`: no map (never traced, or its trace was unreadable): it must run.
 * - `stale`: its map was traced under another toolchain, or on a tree that differs from `base`
 *   in a path it observed, or `base`'s manifest is unknown.
 * - `read`, `probe`, `listing`: a changed path is one it read, one it looked for and missed,
 *   or lands in (or leaves) a directory it listed.
 * - `dependency`: a lockfile or `package.json` changed and it loads installed packages, or a
 *   changed path lies inside a package it loaded.
 */
export const AffectedReason = z.enum([
  'own-change',
  'unmapped',
  'stale',
  'read',
  'probe',
  'listing',
  'dependency',
]);
export type AffectedReason = z.infer<typeof AffectedReason>;

export const AffectedAnswer = z.object({
  /** Test files that may observe the changes: run these. Sorted. */
  affected: z.array(z.string()),
  /** Test files whose maps prove they cannot. Sorted. */
  unaffected: z.array(z.string()),
  /** The affected test files with no map (a subset of `affected`). */
  unknown: z.array(z.string()),
  /** For each affected test file, the first reason found and the path that caused it. */
  reasons: z.record(z.string(), z.object({ reason: AffectedReason, path: z.string().nullable() })),
});
export type AffectedAnswer = z.infer<typeof AffectedAnswer>;

/** One traced tree: its manifest (null when unknown) and each test file's map there. */
export const ReadMapTree = z.object({
  tree: z.string(),
  blobs: z.record(z.string(), z.string()).nullable(),
  maps: z.array(
    z.object({
      test: z.string(),
      reads: z.array(z.string()),
      probes: z.array(z.string()),
      dirs: z.array(z.string()),
      packages: z.array(z.string()),
    }),
  ),
});
export type ReadMapTree = z.infer<typeof ReadMapTree>;

/** What the store holds, for the run's read views. */
export const ReadMapSummary = z.object({
  /** Test files with at least one map. */
  tests: z.number().int().min(0),
  /** Maps kept (one per test file and traced tree). */
  maps: z.number().int().min(0),
  /** Trees traced, newest first, with how many files each mapped. */
  trees: z.array(
    z.object({ tree: z.string(), files: z.number().int().min(0), tracedAtMs: z.number() }),
  ),
  /** Tree manifests kept (traced trees and checks that asked for one). */
  manifests: z.number().int().min(0),
  environment: z.string().nullable(),
});
export type ReadMapSummary = z.infer<typeof ReadMapSummary>;
