/** Hunks from `git diff -p` text, per path (the gateway's `repoDiff` patch). */
import { parsePatch } from 'diff';

import type { DiffHunk } from './repo-types';
import { toHunk } from './file-diff';

export function hunksByPath(patch: string): ReadonlyMap<string, readonly DiffHunk[]> {
  const hunks = new Map<string, readonly DiffHunk[]>();
  if (patch.trim() === '') return hunks;
  for (const file of parsePatch(patch)) {
    const path = stripPrefix(
      file.newFileName === '/dev/null' ? file.oldFileName : file.newFileName,
    );
    if (path !== undefined) hunks.set(path, file.hunks.map(toHunk));
  }
  return hunks;
}

/** `b/src/x.ts` → `src/x.ts`. */
function stripPrefix(name: string | undefined): string | undefined {
  if (name === undefined || name === '/dev/null') return undefined;
  return name.replace(/^[ab]\//, '');
}
