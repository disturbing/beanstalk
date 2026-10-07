/**
 * The History tab: the stalk's commits, newest first, each with its bean, the person who
 * pushed it and when; above them, the sprout's commits that are not validated yet, marked as
 * such, since they are landed but not yet on the stalk.
 */
import Link from 'next/link';

import { groupCounts } from '../../src/changes/changes';
import type { Change } from '../../src/changes/changes';
import type { History, HistoryRow } from '../../src/history/history';
import type { RepositoryTab } from '../../src/server/repository-tab';
import { timeAgo } from '../../src/repositories/when';
import type { GlyphKind } from './glyph';
import { Glyph } from './glyph';
import styles from './repo-tabs.module.css';
import { RepositoryShell } from './repository-shell';

export function HistoryTab(props: {
  readonly tab: RepositoryTab;
  readonly history: History;
  readonly changes: readonly Change[];
  readonly nowMs: number;
}) {
  const { tab, history } = props;
  return (
    <RepositoryShell page={tab} tab="history" openChanges={groupCounts(props.changes).open}>
      {history.pending.length === 0 ? null : (
        <section className={`${styles.box} ${styles.pendingBox}`} aria-labelledby="pending-title">
          <div className={styles.boxHead}>
            <Glyph kind="sprout" />
            <h2 id="pending-title" className={styles.headTitle}>
              On the sprout, not validated yet
            </h2>
            <span className={styles.headMeta}>
              {history.pending.length} {history.pending.length === 1 ? 'commit' : 'commits'}
            </span>
          </div>
          <Commits rows={history.pending} glyph="sprout" base={tab.base} nowMs={props.nowMs} />
        </section>
      )}
      <section className={styles.box} aria-labelledby="stalk-title">
        <div className={styles.boxHead}>
          <Glyph kind="stalk" />
          <h2 id="stalk-title" className={styles.headTitle}>
            The stalk
          </h2>
          <span className={styles.headMeta}>
            {history.stalk.length} {history.stalk.length === 1 ? 'commit' : 'commits'}
          </span>
        </div>
        {history.stalk.length === 0 ? (
          <p className={styles.empty}>Nothing is on the stalk yet.</p>
        ) : (
          <Commits rows={history.stalk} glyph="stalk" base={tab.base} nowMs={props.nowMs} />
        )}
      </section>
    </RepositoryShell>
  );
}

function Commits(props: {
  readonly rows: readonly HistoryRow[];
  readonly glyph: GlyphKind;
  readonly base: string;
  readonly nowMs: number;
}) {
  return (
    <ol className={styles.commits}>
      {props.rows.map((row) => (
        <li key={row.sha}>
          <Glyph kind={row.root ? 'seed' : props.glyph} />
          <span className={styles.commitTitle}>
            {row.bean === null ? (
              row.title
            ) : (
              <Link href={`${props.base}/changes/${encodeURIComponent(row.bean)}`}>
                {row.title}
              </Link>
            )}
          </span>
          <Link
            href={`${props.base}/tree?ref=${encodeURIComponent(row.sha)}`}
            className={styles.sha}
            title="Browse the files at this commit"
          >
            {row.sha.slice(0, 7)}
          </Link>
          <span className={styles.commitMeta}>
            {row.root ? (
              <span>
                Fertilized by{' '}
                {row.by.kind === 'person' ? `@${row.by.name}` : props.base.split('/')[1]}
              </span>
            ) : (
              <span className={styles.person}>
                {row.by.kind === 'person' ? `@${row.by.name}` : row.by.name}
              </span>
            )}
            {row.bean === null ? null : <span className={styles.beanName}>bean/{row.bean}</span>}
            {row.at === null ? null : (
              <time dateTime={new Date(row.at).toISOString()}>
                {timeAgo(new Date(row.at).toISOString(), props.nowMs)}
              </time>
            )}
          </span>
        </li>
      ))}
    </ol>
  );
}
