'use client';

import type { UIEvent } from 'react';
import { useLayoutEffect, useRef, useState } from 'react';

import type { FileDiff } from '@beanstalk/shared-ask/repo/repo-types';
import { followChange } from '../../src/stream/followed-change';
import type { DiffRow, FollowedChange, FollowMode } from '../../src/stream/followed-change';
import styles from './home.module.css';
import { FileIcon } from './marks';

/** Lines of the folded files shown when a reader opens one. */
const OTHER_LINES = 16;
/** Rows kept above the changed hunk when the view follows it. */
const CONTEXT_ROWS = 3;
/** A scroll this soon after a wheel, touch or key on the box is the reader's, not ours. */
const GESTURE_MS = 1000;

/** The snapshot a `StreamingDiff` draws: a streamed one, or the commit that replaced the stream. */
export type StreamSnapshot = {
  readonly key: string;
  readonly inv: string;
  readonly mode: FollowMode;
};

/**
 * A bean's streamed change (`stream_diffs`): every file so far in git's order, the one changed
 * last open in a scroll box that follows the hunk changed last, with the rows the newest
 * snapshot added or deleted briefly highlighted. Rows keep stable keys across snapshots, so
 * only what changed repaints. A reader who scrolls the box away pauses the following (the
 * open file stays put too) until they scroll back to the edit or press "follow".
 * When the commit replaces the stream (`mode: 'commit'`) the same rows stay where they are.
 */
export function StreamingDiff(props: {
  readonly files: readonly FileDiff[];
  readonly snapshot: StreamSnapshot;
  /** The agent writing now, for the caret; null once it stopped. */
  readonly writer: string | null;
}) {
  const change = useFollowedChange(props.files, props.snapshot);
  const follow = useFollowing(change);
  return (
    <div className={styles.diff}>
      {change.files.map(({ file, rows }) => {
        const open = file.path === follow.openPath;
        return (
          <details key={file.path} open={open}>
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
            {open ? (
              <FollowBox
                rows={rows}
                target={change.focusRow}
                following={follow.following}
                snapshot={props.snapshot}
                jump={follow.jump}
                onReaderScroll={follow.onReaderScroll}
              />
            ) : (
              <FoldedRows rows={rows} />
            )}
            {open && props.writer !== null ? (
              <div className={styles.streaming}>
                <i className={styles.cur} />
                {props.writer} is writing
                {follow.following ? null : (
                  <button type="button" className={styles.followbtn} onClick={follow.resume}>
                    {follow.pausedNote(change)}
                  </button>
                )}
              </div>
            ) : null}
          </details>
        );
      })}
    </div>
  );
}

/** The view state for `files`, built once per snapshot (render twice, compute once). */
function useFollowedChange(files: readonly FileDiff[], snapshot: StreamSnapshot): FollowedChange {
  const memo = useRef<{ readonly files: readonly FileDiff[]; readonly change: FollowedChange }>(
    null,
  );
  const current = memo.current;
  if (current === null || current.files !== files || current.change.key !== snapshot.key) {
    memo.current = { files, change: followChange(current?.change ?? null, files, snapshot) };
  }
  return memo.current?.change ?? followChange(null, files, snapshot);
}

type Following = {
  readonly following: boolean;
  readonly openPath: string | null;
  /** Bumped by "follow": the box scrolls to the edit even if the snapshot is the same. */
  readonly jump: number;
  readonly onReaderScroll: (targetVisible: boolean) => void;
  readonly resume: () => void;
  readonly pausedNote: (change: FollowedChange) => string;
};

/** Whether the view follows the agent, and which file is open while it does not. */
function useFollowing(change: FollowedChange): Following {
  const [paused, setPaused] = useState<{
    readonly path: string | null;
    readonly key: string;
  } | null>(null);
  const [jump, setJump] = useState(0);
  const openPath = paused === null ? change.focusPath : paused.path;
  return {
    following: paused === null,
    openPath,
    jump,
    onReaderScroll: (targetVisible) => {
      if (targetVisible) setPaused(null);
      else setPaused((current) => current ?? { path: openPath, key: change.key });
    },
    resume: () => {
      setPaused(null);
      setJump((count) => count + 1);
    },
    pausedNote: (latest) => {
      if (paused === null || latest.key === paused.key) return 'follow';
      if (latest.focusPath !== null && latest.focusPath !== paused.path)
        return `new edit in ${latest.focusPath.split('/').at(-1) ?? latest.focusPath}, follow`;
      return 'new edit, follow';
    },
  };
}

/**
 * The open file's rows in a scroll box. Following, it brings `target` into view (a few rows
 * above it kept) whenever a new snapshot arrives; it never scrolls the page itself.
 */
function FollowBox(props: {
  readonly rows: readonly DiffRow[];
  readonly target: number | null;
  readonly following: boolean;
  readonly snapshot: StreamSnapshot;
  readonly jump: number;
  readonly onReaderScroll: (targetVisible: boolean) => void;
}) {
  const box = useRef<HTMLDivElement>(null);
  const gestureAt = useRef(Number.NEGATIVE_INFINITY);
  const scrolledFor = useRef<string | null>(null);
  const { target, following, snapshot, jump } = props;
  useLayoutEffect(() => {
    const element = box.current;
    const marker = `${snapshot.key}#${jump}`;
    if (element === null || target === null || scrolledFor.current === marker) return;
    const first = scrolledFor.current === null;
    // Snapshots that arrive while the reader is elsewhere count as seen: scrolling back to the
    // edit resumes following without a jump; "follow" (a new `jump`) moves the box.
    scrolledFor.current = marker;
    if (!following) return;
    // The commit replacing the stream keeps the rows where they are: nothing to move.
    if (snapshot.mode === 'commit' && !first) return;
    const row = element.querySelector<HTMLElement>(`[data-row="${target}"]`);
    if (row === null) return;
    const top = Math.max(0, row.offsetTop - CONTEXT_ROWS * row.offsetHeight);
    element.scrollTo({ top, behavior: first || prefersReducedMotion() ? 'instant' : 'smooth' });
  }, [target, following, snapshot, jump]);
  const noteGesture = () => {
    gestureAt.current = performance.now();
  };
  const onScroll = (event: UIEvent<HTMLDivElement>) => {
    if (performance.now() - gestureAt.current > GESTURE_MS) return;
    props.onReaderScroll(isRowVisible(event.currentTarget, target));
  };
  return (
    <div
      ref={box}
      className={`${styles.hunk} ${styles.follow}`}
      data-follow-box=""
      onWheel={noteGesture}
      onTouchMove={noteGesture}
      onKeyDown={noteGesture}
      onPointerDown={noteGesture}
      onScroll={onScroll}
      // Scrollable regions are focusable so keyboard readers can scroll them too.
      tabIndex={0}
    >
      {props.rows.length === 0 ? (
        <div className={styles.h}>binary, or too large to stream</div>
      ) : null}
      {props.rows.map((row) => (
        <div key={row.id} data-row={row.id} className={rowClass(row)}>
          {row.text}
        </div>
      ))}
    </div>
  );
}

function FoldedRows(props: { readonly rows: readonly DiffRow[] }) {
  const shown = props.rows.slice(0, OTHER_LINES);
  const hidden = props.rows.length - shown.length;
  return (
    <div className={styles.hunk}>
      {props.rows.length === 0 ? (
        <div className={styles.h}>binary, or too large to stream</div>
      ) : null}
      {shown.map((row) => (
        <div key={row.id} className={rowClass(row)}>
          {row.text}
        </div>
      ))}
      {hidden > 0 ? <div className={styles.h}>… {hidden} more lines</div> : null}
    </div>
  );
}

const ROW_CLASS = { h: styles.h, a: styles.a, d: styles.d, c: undefined } as const;

function rowClass(row: DiffRow): string | undefined {
  const base = ROW_CLASS[row.kind];
  if (!row.fresh) return base;
  return base === undefined ? styles.fresh : `${base} ${styles.fresh}`;
}

/** Whether the row `id` is (at least partly) inside the box's visible area; false when absent. */
function isRowVisible(element: HTMLElement, id: number | null): boolean {
  if (id === null) return false;
  const row = element.querySelector<HTMLElement>(`[data-row="${id}"]`);
  if (row === null) return false;
  const bottom = element.scrollTop + element.clientHeight;
  return row.offsetTop + row.offsetHeight > element.scrollTop && row.offsetTop < bottom;
}

function prefersReducedMotion(): boolean {
  return window.matchMedia('(prefers-reduced-motion: reduce)').matches;
}
