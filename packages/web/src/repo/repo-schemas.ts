/** Zod schemas for repo shapes that cross the network inside the app (the bean diff route). */
import { z } from 'zod';

import { Sha } from '@beanstalk/shared-race/ids';

const DiffLine = z.object({
  kind: z.enum(['context', 'add', 'del']),
  text: z.string(),
  oldNo: z.number().int().nullable(),
  newNo: z.number().int().nullable(),
});

const DiffHunk = z.object({
  oldStart: z.number().int(),
  oldLines: z.number().int(),
  newStart: z.number().int(),
  newLines: z.number().int(),
  lines: z.array(DiffLine),
});

export const RepoDiffSchema = z.object({
  from: Sha,
  to: Sha,
  files: z.array(
    z.object({
      path: z.string(),
      status: z.enum(['added', 'modified', 'deleted']),
      additions: z.number().int(),
      deletions: z.number().int(),
      hunks: z.array(DiffHunk),
    }),
  ),
});
