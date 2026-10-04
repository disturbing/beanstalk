'use client';

import type { CodeMap, CodeMapFile } from '../../src/race/code-map';
import { AFTERGLOW_SECONDS } from '../../src/race/code-map';
import styles from './canvas.module.css';

/**
 * The code map: every module and file in a fixed grid. Heat is how many beans in flight
 * touch a file now; a ring marks an overlap (two or more at once) or a fresh conflict, a dot
 * a file that just landed. Overlaps are listed in words below the map.
 */
export function CodeMapView(props: { readonly run: string; readonly map: CodeMap }) {
  return (
    <>
      <div className={styles.map}>
        {props.map.modules.map((module) => {
          const hot = module.files.some((file) => file.beans.length > 0);
          return (
            <div key={module.name} className={`${styles.module} ${hot ? styles.moduleHot : ''}`}>
              <span className={styles.moduleName}>
                {module.name}
                <span className={styles.moduleCount}>{module.files.length}</span>
              </span>
              <span className={styles.cells}>
                {module.files.map((file) => (
                  <Cell key={file.path} file={file} run={props.run} />
                ))}
              </span>
            </div>
          );
        })}
      </div>
      {props.map.overlaps.length === 0 ? (
        <p className={styles.legend}>No two beans in flight touch the same file right now.</p>
      ) : (
        <ul className={styles.overlaps} aria-label="Overlaps now">
          {props.map.overlaps.map((overlap) => (
            <li key={overlap.path} className={styles.overlapItem}>
              <span className={styles.overlapPath}>{overlap.path}</span>
              <span>{overlap.beans.join(', ')} in flight on it</span>
            </li>
          ))}
        </ul>
      )}
      <div className={styles.legend} aria-hidden="true">
        <span className={styles.legendItem}>
          <span className={`${styles.swatch} ${styles.heat1}`} /> 1 bean in flight
        </span>
        <span className={styles.legendItem}>
          <span className={`${styles.swatch} ${styles.heat2}`} /> 2
        </span>
        <span className={styles.legendItem}>
          <span className={`${styles.swatch} ${styles.heat3}`} /> 3 or more
        </span>
        <span className={styles.legendItem}>
          <span className={`${styles.swatch} ${styles.overlap}`} /> overlap
        </span>
        <span className={styles.legendItem}>
          <span className={`${styles.swatch} ${styles.conflicted}`} /> conflict
        </span>
        <span className={styles.legendItem}>
          <span className={`${styles.cell} ${styles.landed}`} /> landed in the last{' '}
          {AFTERGLOW_SECONDS} s
        </span>
      </div>
    </>
  );
}

function Cell({ file, run }: { readonly file: CodeMapFile; readonly run: string }) {
  const classes = [
    styles.cell,
    heatClass(file.beans.length),
    ringClass(file),
    file.landedRecently ? styles.landed : undefined,
  ]
    .filter((name) => name !== undefined && name !== '')
    .join(' ');
  return (
    <a
      href={`/runs/${run}?file=${encodeURIComponent(file.path)}`}
      className={classes}
      aria-label={cellLabel(file)}
      title={cellLabel(file)}
    />
  );
}

function heatClass(count: number): string | undefined {
  if (count >= 3) return styles.heat3;
  if (count === 2) return styles.heat2;
  if (count === 1) return styles.heat1;
  return undefined;
}

function ringClass(file: CodeMapFile): string | undefined {
  if (file.conflictedRecently) return styles.conflicted;
  return file.beans.length > 1 ? styles.overlap : undefined;
}

function cellLabel(file: CodeMapFile): string {
  const parts = [file.path];
  if (file.beans.length > 0) parts.push(`in flight: ${file.beans.join(', ')}`);
  if (file.conflictedRecently) parts.push('just conflicted');
  if (file.landedRecently) parts.push('just landed');
  return parts.join('; ');
}
