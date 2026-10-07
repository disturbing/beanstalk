/**
 * The Changes tab: the repository's beans in three lists, open (in check, red or waiting),
 * landed (on the sprout or validated on the stalk) and parked (or fallen off), each with who
 * brought it, its intent, where it stands and, when red, the tests that failed. While a bean
 * is in check the page follows the engine and refreshes itself.
 */
import Link from 'next/link';

import type { Change, ChangeGroup } from '../../src/changes/changes';
import { authorText, groupCounts, inGroup } from '../../src/changes/changes';
import type { RepositoryTab } from '../../src/server/repository-tab';
import { timeAgo } from '../../src/repositories/when';
import { Glyph } from './glyph';
import { LiveRefresh } from './live-refresh';
import { glyphOfState } from './ref-switcher';
import styles from './repo-tabs.module.css';
import { RepositoryShell } from './repository-shell';

const GROUPS: readonly {
  readonly group: ChangeGroup;
  readonly name: string;
  readonly empty: string;
}[] = [
  {
    group: 'open',
    name: 'Open',
    empty: 'Nothing is growing. Push a bean/<name> branch, or ask your agent for a change.',
  },
  { group: 'landed', name: 'Landed', empty: 'No bean has landed yet.' },
  { group: 'parked', name: 'Parked', empty: 'No bean is parked or fell off.' },
];

/** `?show=` as a group; without one, open when anything is, else landed. */
export function shownGroup(value: unknown, changes: readonly Change[]): ChangeGroup {
  if (value === 'open' || value === 'landed' || value === 'parked') return value;
  return inGroup(changes, 'open').length > 0 ? 'open' : 'landed';
}

export function ChangesTab(props: {
  readonly tab: RepositoryTab;
  readonly changes: readonly Change[];
  readonly show: ChangeGroup;
  /** The newest event seen, where the live feed resumes. */
  readonly lastSeq: number;
  readonly nowMs: number;
}) {
  const { tab, changes } = props;
  const counts = groupCounts(changes);
  const shown = inGroup(changes, props.show);
  const empty = GROUPS.find((entry) => entry.group === props.show)?.empty ?? '';
  return (
    <RepositoryShell page={tab} tab="changes" openChanges={counts.open}>
      <div className={styles.bar}>
        <nav className={styles.filters} aria-label="Which beans">
          {GROUPS.map((entry) => (
            <Link
              key={entry.group}
              href={`${tab.base}/changes?show=${entry.group}`}
              className={styles.filter}
              aria-current={props.show === entry.group ? 'page' : undefined}
            >
              {entry.name}
              <span className={styles.count}>{counts[entry.group]}</span>
            </Link>
          ))}
        </nav>
        <LiveRefresh path={liveFeedPath(tab.base)} after={props.lastSeq} enabled />
      </div>
      <section className={styles.box} aria-label={`${props.show} beans`}>
        {shown.length === 0 ? (
          <p className={styles.empty}>{empty}</p>
        ) : (
          <ul className={styles.changes}>
            {shown.map((change) => (
              <li key={change.bean}>
                <ChangeRow base={tab.base} change={change} nowMs={props.nowMs} />
              </li>
            ))}
          </ul>
        )}
      </section>
    </RepositoryShell>
  );
}

function ChangeRow(props: {
  readonly base: string;
  readonly change: Change;
  readonly nowMs: number;
}) {
  const { change } = props;
  const href = `${props.base}/changes/${encodeURIComponent(change.bean)}`;
  return (
    <div className={styles.change}>
      <Glyph kind={glyphOfState(change.state)} live={change.state === 'checking'} />
      <Link href={href} className={styles.changeTitle}>
        {change.title}
      </Link>
      <span className={styles.state} data-state={change.state}>
        {stateText(change)}
      </span>
      <div className={styles.changeMeta}>
        <span className={styles.beanName}>bean/{change.bean}</span>
        <span>
          by <span className={styles.person}>{authorText(change.author)}</span>
        </span>
        {change.pushes > 1 ? <span>{change.pushes} pushes</span> : null}
        {change.updatedAt === null ? null : (
          <time dateTime={new Date(change.updatedAt).toISOString()}>
            {timeAgo(new Date(change.updatedAt).toISOString(), props.nowMs)}
          </time>
        )}
      </div>
      {change.failing.length === 0 && change.collided.length === 0 ? null : (
        <ul className={styles.failing} aria-label="Why it is red">
          {change.failing.slice(0, 3).map((test) => (
            <li key={test}>✗ {test}</li>
          ))}
          {change.failing.length > 3 ? <li>and {change.failing.length - 3} more</li> : null}
          {change.collided.length === 0 ? null : (
            <li>collided with {change.collided.join(', ')}</li>
          )}
        </ul>
      )}
    </div>
  );
}

/** The state as a person reads it. */
export function stateText(change: Change): string {
  switch (change.state) {
    case 'checking':
      return 'in check';
    case 'waiting':
      return 'waiting';
    case 'red':
      return 'red';
    case 'conflict':
      return 'conflict';
    case 'landed':
      return 'on the sprout';
    case 'validated':
      return 'on the stalk';
    case 'parked':
      return 'parked';
    case 'fell-off':
      return 'fell off';
    default:
      return change.state;
  }
}

/** The live feed of a repository, access-checked like its pages. */
export function liveFeedPath(base: string): string {
  return `/api/repos${base}/live`;
}
