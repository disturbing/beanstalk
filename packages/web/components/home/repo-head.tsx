import Link from 'next/link';

import type { Repository } from '../../src/people/repository';
import styles from './home.module.css';

export type RepoTab = 'code' | 'files' | 'beans' | 'decisions' | 'checks' | 'engine';

/** Tabs that are questions: the generated explorer is the page for them. */
export const TAB_QUESTIONS: Readonly<Partial<Record<RepoTab, string>>> = {
  beans: "what's being worked on right now?",
  decisions: 'what did we decide?',
  checks: 'why did the sprout go red?',
};

const TABS: readonly { readonly tab: RepoTab; readonly name: string; readonly keys: string }[] = [
  { tab: 'code', name: 'Code', keys: 'g c' },
  { tab: 'files', name: 'Files', keys: 'g f' },
  { tab: 'beans', name: 'Beans', keys: 'g b' },
  { tab: 'decisions', name: 'Decisions', keys: 'g d' },
  { tab: 'checks', name: 'Checks', keys: 'g k' },
  { tab: 'engine', name: 'Engine', keys: 'g e' },
];

/**
 * The repository's header: owner and name once, then its views. Beans, Decisions and Checks
 * open the home explorer on their question; Engine is the race canvas, for developers.
 */
export function RepoHead(props: {
  readonly run: string;
  readonly repository: Repository;
  readonly current: RepoTab;
}) {
  return (
    <div className={styles.repohead}>
      <h1 className={styles.repotitle}>
        <Link href={`/runs/${props.run}`}>{props.repository.owner}</Link>
        <span>/</span>
        <Link href={`/runs/${props.run}`}>{props.repository.name}</Link>
      </h1>
      <nav className={styles.tabs} aria-label="Repository views">
        {TABS.map((item) => (
          <Link
            key={item.tab}
            href={hrefOf(props.run, item.tab)}
            className={styles.tab}
            aria-current={props.current === item.tab ? 'page' : undefined}
            title={item.tab === 'engine' ? 'The engine’s race canvas, for developers' : undefined}
          >
            {item.name}
            <kbd className={styles.kh}>{item.keys}</kbd>
          </Link>
        ))}
      </nav>
    </div>
  );
}

/** Which tab a question belongs to, if it is one of the tabs' own questions. */
export function tabOf(q: string): RepoTab {
  const match = Object.entries(TAB_QUESTIONS).find(([, question]) => question === q);
  return match === undefined ? 'code' : (TABS.find((item) => item.tab === match[0])?.tab ?? 'code');
}

function hrefOf(run: string, tab: RepoTab): string {
  if (tab === 'files') return `/runs/${run}/files`;
  if (tab === 'engine') return `/runs/${run}/race`;
  const question = TAB_QUESTIONS[tab];
  return question === undefined ? `/runs/${run}` : `/runs/${run}?q=${encodeURIComponent(question)}`;
}
