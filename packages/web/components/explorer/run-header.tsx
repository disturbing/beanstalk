import Link from 'next/link';

import styles from './explorer.module.css';

export type RunHeaderProps = {
  readonly run: string;
  readonly label: string;
  readonly detail: string;
  readonly current: 'repository' | 'race';
};

/** A run's title with its two views: the repository (Ask) and the race canvas. */
export function RunHeader({ run, label, detail, current }: RunHeaderProps) {
  return (
    <div className={styles.runHeader}>
      <div>
        <h1 className={styles.runTitle}>{label}</h1>
        <p className={styles.runMeta}>
          <code>race-{run}</code> {detail}
        </p>
      </div>
      <nav aria-label="Run views" className={styles.tabs}>
        <Link
          href={`/runs/${run}`}
          className={styles.tab}
          aria-current={current === 'repository' ? 'page' : undefined}
        >
          Repository
        </Link>
        <Link
          href={`/runs/${run}/race`}
          className={styles.tab}
          aria-current={current === 'race' ? 'page' : undefined}
        >
          Race canvas
        </Link>
      </nav>
    </div>
  );
}
