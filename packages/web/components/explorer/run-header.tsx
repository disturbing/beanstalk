import Link from 'next/link';

import styles from './explorer.module.css';

export type RunView = 'plot' | 'files' | 'race';

export type RunHeaderProps = {
  readonly run: string;
  readonly label: string;
  readonly detail: string;
  readonly current: RunView;
};

const VIEWS: readonly { readonly view: RunView; readonly path: string; readonly name: string }[] = [
  { view: 'plot', path: '', name: 'Plot' },
  { view: 'files', path: '/files', name: 'Files' },
  { view: 'race', path: '/race', name: 'Engine' },
];

/**
 * A run's title with its views: the Plot (the repository's home), the Files explorer, and
 * the engine's race canvas for developers.
 */
export function RunHeader({ run, label, detail, current }: RunHeaderProps) {
  return (
    <div className={styles.runHeader}>
      <div>
        <h1 className={styles.runTitle}>{label}</h1>
        <p className={styles.runMeta}>
          <code>race-{run}</code> {detail}
        </p>
      </div>
      <RunTabs run={run} current={current} />
    </div>
  );
}

export function RunTabs({ run, current }: { readonly run: string; readonly current: RunView }) {
  return (
    <nav aria-label="Run views" className={styles.tabs}>
      {VIEWS.map((item) => (
        <Link
          key={item.view}
          href={`/runs/${run}${item.path}`}
          className={styles.tab}
          aria-current={current === item.view ? 'page' : undefined}
          title={item.view === 'race' ? 'The engine’s race canvas, for developers' : undefined}
        >
          {item.name}
        </Link>
      ))}
    </nav>
  );
}
