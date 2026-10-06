'use client';

import { useRef } from 'react';

import type { BeanStreamView } from '@beanstalk/shared-ask/forge/bean-stream';
import type { FileDiff } from '@beanstalk/shared-ask/repo/repo-types';
import { plural } from '../../src/race/race-format';
import styles from './home.module.css';
import { FileIcon } from './marks';

/** Lines of the file being written that stay on screen: its newest lines, like a log. */
const FOLLOW_LINES = 30;
/** Lines of the other files. */
const OTHER_LINES = 16;

const LINE_CLASS = { add: 'a', del: 'd', context: '' } as const;
const LINE_PREFIX = { add: '+', del: '-', context: ' ' } as const;

/**
 * A bean's streamed change (`stream_diffs`): every file so far, the one that changed last
 * open and followed at its end with the writing caret; the others folded. Updates in place:
 * rows keep their keys, so only the lines that changed repaint.
 */
export function StreamingDiff(props: {
  readonly view: BeanStreamView;
  readonly agent: string;
  readonly writing: boolean;
}) {
  const { view } = props;
  const latest = useLatestChanged(view);
  // Files keep git's order between snapshots (a list that reorders itself reads as flicker);
  // only which one is open follows the writing.
  const ordered = view.files;
  return (
    <>
      <div className={styles.jnote} data-stream-seq={view.summary.seq}>
        <span className={styles.chip} data-tone="fly">
          <i className={styles.mdot} />
          {props.writing ? 'streaming' : 'finished writing'}
        </span>{' '}
        {plural(view.files.length, 'file')} so far, +{view.summary.additions} −
        {view.summary.deletions}
        {view.summary.truncated ? ', cut to fit' : ''}
        {props.writing ? '' : '; its commit is on the way'}
      </div>
      <div className={styles.diff}>
        {ordered.map((file) => (
          <details key={file.path} open={file.path === latest}>
            <summary>
              <span className={styles.p}>
                <FileIcon dir={false} />
                <code>{file.path.replace(/^src\//, '')}</code>
              </span>
              <span />
              <span>
                <span className={styles.add}>+{file.additions}</span>{' '}
                <span className={styles.del}>−{file.deletions}</span>
              </span>
            </summary>
            <FollowedLines
              file={file}
              follow={file.path === latest}
              caret={props.writing && file.path === latest ? props.agent : null}
            />
          </details>
        ))}
      </div>
    </>
  );
}

function FollowedLines(props: {
  readonly file: FileDiff;
  readonly follow: boolean;
  readonly caret: string | null;
}) {
  const lines = props.file.hunks.flatMap((hunk) => [
    {
      kind: 'h',
      text: `@@ -${hunk.oldStart},${hunk.oldLines} +${hunk.newStart},${hunk.newLines} @@`,
    },
    ...hunk.lines.map((line) => ({
      kind: LINE_CLASS[line.kind],
      text: `${LINE_PREFIX[line.kind]}${line.text}`,
    })),
  ]);
  const limit = props.follow ? FOLLOW_LINES : OTHER_LINES;
  const shown = props.follow ? lines.slice(-limit) : lines.slice(0, limit);
  const hidden = lines.length - shown.length;
  const hiddenNote =
    hidden > 0 ? (
      <div className={styles.h}>
        … {hidden} {props.follow ? 'earlier' : 'more'} lines
      </div>
    ) : null;
  return (
    <div className={styles.hunk}>
      {props.follow ? hiddenNote : null}
      {lines.length === 0 ? <div className={styles.h}>binary, or too large to stream</div> : null}
      {shown.map((line, index) => (
        <div
          key={lines.length - shown.length + index}
          className={line.kind === '' ? undefined : styles[line.kind]}
        >
          {line.text}
        </div>
      ))}
      {props.follow ? null : hiddenNote}
      {props.caret === null ? null : (
        <div className={styles.streaming}>
          <i className={styles.cur} />
          {props.caret} is writing
        </div>
      )}
    </div>
  );
}

/** The file whose counts changed in the newest snapshot (kept while nothing else changes). */
function useLatestChanged(view: BeanStreamView): string | null {
  const previous = useRef<ReadonlyMap<string, string>>(new Map());
  const latest = useRef<string | null>(null);
  const counts = new Map(view.files.map((file) => [file.path, stamp(file)]));
  const changed = view.files.filter((file) => previous.current.get(file.path) !== stamp(file));
  if (changed.length > 0) latest.current = changed.at(-1)?.path ?? latest.current;
  previous.current = counts;
  return latest.current ?? view.files.at(-1)?.path ?? null;
}

function stamp(file: FileDiff): string {
  return `${file.additions}/${file.deletions}/${file.hunks.length}/${file.hunks.at(-1)?.lines.length ?? 0}`;
}
