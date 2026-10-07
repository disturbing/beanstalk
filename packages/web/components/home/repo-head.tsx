import Link from 'next/link';

import type { Repository } from '../../src/people/repository';
import styles from './home.module.css';

export type RepoTab =
  | 'code'
  | 'files'
  | 'beans'
  | 'stalk'
  | 'decisions'
  | 'checks'
  | 'engine'
  | 'people'
  | 'settings';

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
  { tab: 'stalk', name: 'Stalk', keys: 'g t' },
  { tab: 'decisions', name: 'Decisions', keys: 'g d' },
  { tab: 'checks', name: 'Checks', keys: 'g k' },
  { tab: 'engine', name: 'Engine', keys: 'g e' },
  { tab: 'people', name: 'People', keys: 'g p' },
  { tab: 'settings', name: 'Settings', keys: 'g s' },
];

/** A race's repository has the engine canvas; a persistent repository has settings instead. */
const KIND_TABS: Readonly<Record<RepoKind, ReadonlySet<RepoTab>>> = {
  race: new Set(['code', 'files', 'beans', 'decisions', 'checks', 'engine']),
  repository: new Set([
    'code',
    'files',
    'beans',
    'stalk',
    'decisions',
    'checks',
    'people',
    'settings',
  ]),
};

export type RepoKind = 'race' | 'repository';

/**
 * The repository's header: owner and name once, then its views. Beans, Decisions and Checks
 * open the home explorer on their question; Engine is a race's canvas, for developers, and
 * Settings belongs to a persistent repository. `base` is `/runs/<run>` or `/<owner>/<repo>`.
 */
export function RepoHead(props: {
  readonly base: string;
  readonly repository: Repository;
  readonly current: RepoTab;
  readonly kind?: RepoKind;
  /** A persistent repository's visibility, shown beside its name. */
  readonly visibility?: 'public' | 'private';
  /** Where the owner's name links: their repositories, or the repository itself for a race. */
  readonly ownerHref?: string;
  /** A persistent repository its owner archived: read-only, said under the name. */
  readonly archived?: boolean;
}) {
  const tabs = KIND_TABS[props.kind ?? 'race'];
  return (
    <div className={styles.repohead}>
      <h1 className={styles.repotitle}>
        <Link href={props.ownerHref ?? props.base}>{props.repository.owner}</Link>
        <span>/</span>
        <Link href={props.base}>{props.repository.name}</Link>
        {props.visibility === undefined ? null : (
          <small className={styles.visibility}>{props.visibility}</small>
        )}
        {props.archived === true ? <small className={styles.visibility}>archived</small> : null}
      </h1>
      {props.archived === true ? (
        <p className={styles.archivedNote} role="note">
          Archived by its owner: read-only. It still clones and fetches; pushes are refused.
        </p>
      ) : null}
      <nav className={styles.tabs} aria-label="Repository views">
        {TABS.filter((item) => tabs.has(item.tab)).map((item) => (
          <Link
            key={item.tab}
            href={hrefOf(props.base, item.tab)}
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

function hrefOf(base: string, tab: RepoTab): string {
  if (tab === 'files') return `${base}/files`;
  if (tab === 'stalk') return `${base}/stalk`;
  if (tab === 'engine') return `${base}/race`;
  if (tab === 'settings') return `${base}/settings`;
  if (tab === 'people') return `${base}/people`;
  const question = TAB_QUESTIONS[tab];
  return question === undefined ? base : `${base}?q=${encodeURIComponent(question)}`;
}
