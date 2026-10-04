import type { DiffHunk, FileDiff } from '@beanstalk/shared-ask/repo/repo-types';
import styles from './explorer.module.css';

/** Files whose diffs open by default; later ones stay folded to keep long answers readable. */
const OPEN_FILES = 6;

/** A combined diff: one foldable section per file, unified hunks with both line numbers. */
export function DiffView({ files }: { readonly files: readonly FileDiff[] }) {
  return (
    <>
      {files.map((file, index) => (
        <details key={file.path} className={styles.fileDiff} open={index < OPEN_FILES}>
          <summary>
            <span className={styles.diffPath}>{file.path}</span>
            {file.status === 'modified' ? null : (
              <span className={styles.status}>{file.status}</span>
            )}
            <span className={styles.diffStat}>
              <span className={styles.add}>+{file.additions}</span>{' '}
              <span className={styles.del}>−{file.deletions}</span>
            </span>
          </summary>
          <div className={styles.code}>
            {file.hunks.length === 0 ? (
              <p className={styles.note}>
                No line changes to show (the patch was truncated or the file is binary).
              </p>
            ) : (
              <table className={styles.codeTable}>
                <tbody>
                  {file.hunks.map((hunk) => (
                    <Hunk key={`${hunk.oldStart}-${hunk.newStart}`} hunk={hunk} />
                  ))}
                </tbody>
              </table>
            )}
          </div>
        </details>
      ))}
    </>
  );
}

function Hunk({ hunk }: { readonly hunk: DiffHunk }) {
  return (
    <>
      <tr className={styles.hunkHead}>
        <td className={styles.lineNo} />
        <td className={styles.lineNo} />
        <td>
          @@ −{hunk.oldStart},{hunk.oldLines} +{hunk.newStart},{hunk.newLines} @@
        </td>
      </tr>
      {hunk.lines.map((line, index) => (
        <tr key={index} className={rowClass(line.kind)}>
          <td className={styles.lineNo}>{line.oldNo ?? ''}</td>
          <td className={styles.lineNo}>{line.newNo ?? ''}</td>
          <td className={styles.text}>
            {line.kind === 'add' ? <span className="visually-hidden">added: </span> : null}
            {line.kind === 'del' ? <span className="visually-hidden">removed: </span> : null}
            {line.text}
          </td>
        </tr>
      ))}
    </>
  );
}

function rowClass(kind: 'context' | 'add' | 'del'): string | undefined {
  if (kind === 'add') return styles.lineAdd;
  if (kind === 'del') return styles.lineDel;
  return styles.lineCtx;
}
