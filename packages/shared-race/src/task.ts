import { z } from 'zod';

import { TaskId } from './ids';

/** Largest acceptance test file accepted in a run (bytes of UTF-16 text, roughly). */
const MAX_TEST_FILE_CHARS = 1_000_000;

/**
 * A repository-relative path the driver may write: no absolute paths, no `..`, nothing
 * inside `.git`. Acceptance tests are written into agent worktrees, so this is a boundary.
 */
export function isSafeRepoPath(path: string): boolean {
  if (path.length === 0 || path.length > 512 || path.startsWith('/') || path.includes('\\')) {
    return false;
  }
  if (path.includes('\0')) return false;
  const segments = path.split('/');
  if (segments.some(isBadSegment)) return false;
  return segments[0] !== '.git';
}

function isBadSegment(segment: string): boolean {
  return segment === '' || segment === '.' || segment === '..';
}

const RepoPath = z.string().refine(isSafeRepoPath, 'must be a relative path inside the repository');

/** A coupling between two arena tasks (`textual`: same lines; `semantic`: merges clean, breaks). */
export const Coupling = z.object({
  with: TaskId.optional(),
  type: z.string().default(''),
  note: z.string().default(''),
});
export type Coupling = z.infer<typeof Coupling>;

/**
 * One arena task, the format of `research/arena/tasks/tNNN.json`. Unknown keys are
 * dropped rather than rejected so a newer arena file still loads.
 */
export const ArenaTask = z.object({
  id: TaskId,
  title: z.string().min(1).max(500),
  prompt: z.string().max(100_000),
  acceptance_tests: z
    .record(RepoPath, z.string().max(MAX_TEST_FILE_CHARS))
    .refine((tests) => Object.keys(tests).length > 0, 'a task needs at least one acceptance test'),
  oracle_paths: z.array(RepoPath).default([]),
  oracle_modules: z.array(z.string()).default([]),
  kind: z.string().default(''),
  difficulty: z.number().int().default(1),
  couplings: z.array(Coupling).default([]),
});
export type ArenaTask = z.infer<typeof ArenaTask>;

/** Acceptance test paths in the order the harness lists them (`sorted(acceptance_tests)`). */
export function acceptancePaths(task: Pick<ArenaTask, 'acceptance_tests'>): readonly string[] {
  return Object.keys(task.acceptance_tests).toSorted();
}

/** Ids of the tasks a task is coupled with, optionally of one coupling type. */
export function couplingPartners(
  task: Pick<ArenaTask, 'couplings'>,
  type?: string,
): readonly TaskId[] {
  return task.couplings.flatMap((coupling) => {
    const matchesType = type === undefined || coupling.type === type;
    return coupling.with !== undefined && matchesType ? [coupling.with] : [];
  });
}
