/**
 * Small shared marks of the repository home: a bean's chip (where it sits on the line), file
 * and folder icons, and diffs. Plain components, usable on the server and the client.
 */
import type { LeafStatus } from '@beanstalk/shared-ask/home/stalk';
import type { FileDiff } from '@beanstalk/shared-ask/repo/repo-types';
import styles from './home.module.css';

export function BeanChip(props: {
  readonly task: string | null;
  readonly idx: number | null;
  readonly status: LeafStatus;
  readonly title?: string | undefined;
}) {
  const tone = props.status === 'red' ? 'red' : props.status;
  return (
    <span className={styles.chip} data-tone={tone} title={props.title}>
      <i className={styles.mleaf} />
      {props.task ?? 'line'}
      {props.idx === null ? '' : ` #${props.idx}`}
    </span>
  );
}

export function BaseChip() {
  return (
    <span className={styles.chip} data-tone="base">
      base
    </span>
  );
}

export function InFlightChip(props: { readonly count: number; readonly title: string }) {
  return (
    <span className={styles.chip} data-tone="fly" title={props.title}>
      <i className={styles.mdot} />
      {props.count} in flight
    </span>
  );
}

export function FileIcon({ dir }: { readonly dir: boolean }) {
  return dir ? (
    <svg
      className={styles.ficon}
      data-dir=""
      width="16"
      height="16"
      viewBox="0 0 16 16"
      fill="currentColor"
      aria-hidden="true"
    >
      <path d="M1.75 1A1.75 1.75 0 0 0 0 2.75v10.5C0 14.216.784 15 1.75 15h12.5A1.75 1.75 0 0 0 16 13.25v-8.5A1.75 1.75 0 0 0 14.25 3H7.5a.25.25 0 0 1-.2-.1l-.9-1.2C6.07 1.26 5.55 1 5 1H1.75Z" />
    </svg>
  ) : (
    <svg
      className={styles.ficon}
      width="16"
      height="16"
      viewBox="0 0 16 16"
      fill="currentColor"
      aria-hidden="true"
    >
      <path d="M2 1.75C2 .784 2.784 0 3.75 0h6.586c.464 0 .909.184 1.237.513l2.914 2.914c.329.328.513.773.513 1.237v9.586A1.75 1.75 0 0 1 13.25 16h-9.5A1.75 1.75 0 0 1 2 14.25Zm1.75-.25a.25.25 0 0 0-.25.25v12.5c0 .138.112.25.25.25h9.5a.25.25 0 0 0 .25-.25V6h-2.75A1.75 1.75 0 0 1 9 4.25V1.5Zm6.75.062V4.25c0 .138.112.25.25.25h2.688l-.011-.013-2.914-2.914-.013-.011Z" />
    </svg>
  );
}

/** Foldable per-file diffs, the first `open` ones unfolded, each cut to `lines` lines. */
export function DiffFiles(props: {
  readonly files: readonly FileDiff[];
  readonly open?: number;
  readonly lines?: number;
}) {
  const open = props.open ?? 2;
  const limit = props.lines ?? 40;
  return (
    <div className={styles.diff}>
      {props.files.map((file, index) => {
        return (
          <details key={file.path} open={index < open}>
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
            <HunkLines file={file} lines={limit} />
          </details>
        );
      })}
    </div>
  );
}

/** A file's hunks as unified diff lines, cut to `lines`. */
export function HunkLines(props: { readonly file: FileDiff; readonly lines: number }) {
  const lines = props.file.hunks.flatMap((hunk) => [
    {
      kind: 'h' as const,
      text: `@@ -${hunk.oldStart},${hunk.oldLines} +${hunk.newStart},${hunk.newLines} @@`,
    },
    ...hunk.lines.map((line) => ({
      kind: lineClass(line.kind),
      text: `${linePrefix(line.kind)}${line.text}`,
    })),
  ]);
  const shown = lines.slice(0, props.lines);
  return (
    <div className={styles.hunk}>
      {shown.map((line, lineIndex) => (
        <div key={lineIndex} className={line.kind === '' ? undefined : styles[line.kind]}>
          {line.text}
        </div>
      ))}
      {lines.length > shown.length ? (
        <div className={styles.h}>… {lines.length - shown.length} more lines</div>
      ) : null}
    </div>
  );
}

function lineClass(kind: 'context' | 'add' | 'del'): 'a' | 'd' | '' {
  if (kind === 'add') return 'a';
  return kind === 'del' ? 'd' : '';
}

function linePrefix(kind: 'context' | 'add' | 'del'): string {
  if (kind === 'add') return '+';
  return kind === 'del' ? '-' : ' ';
}
