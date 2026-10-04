/**
 * Blame by bean: which bean last changed each line of a file, from its versions along the
 * line (oldest first). Lines from the base carry no bean.
 */
import { diffLines } from 'diff';

import type { TaskId } from '@beanstalk/shared-race/ids';

import type { BlameLine } from './answer';

export type FileVersion = {
  readonly task: TaskId | null;
  readonly idx: number | null;
  readonly text: string;
};

/** Attribution for every line of the newest version. */
export function blameByBean(versions: readonly FileVersion[]): readonly BlameLine[] {
  const start: { readonly lines: readonly BlameLine[]; readonly previous: string } = {
    lines: [],
    previous: '',
  };
  return versions.reduce(
    (state, version) => ({
      lines: carryForward({ lines: state.lines, previous: state.previous, next: version }),
      previous: version.text,
    }),
    start,
  ).lines;
}

function carryForward(input: {
  readonly lines: readonly BlameLine[];
  readonly previous: string;
  readonly next: FileVersion;
}): readonly BlameLine[] {
  const result: BlameLine[] = [];
  let cursor = 0;
  for (const change of diffLines(input.previous, input.next.text)) {
    const count = change.count;
    if (change.removed) {
      cursor += count;
    } else if (change.added) {
      for (let line = 0; line < count; line += 1)
        result.push({ task: input.next.task, idx: input.next.idx });
    } else {
      result.push(...input.lines.slice(cursor, cursor + count));
      cursor += count;
    }
  }
  return result;
}
