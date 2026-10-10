/**
 * One bean: what it is for and who brought it, its journey (each push, check and verdict,
 * with the failing tests and the landed beans it collided with, then landing, validation and
 * any decision), the engine's last word to the pusher, and its diff.
 */
import Link from 'next/link';

import type { RepoDiff } from '@gitstalk/shared-ask/repo/repo-types';
import { DiffView } from '../explorer/diff-view';
import type { Change } from '../../src/changes/changes';
import { authorText, groupCounts } from '../../src/changes/changes';
import { codeHref } from '../../src/code/tree';
import type { RepositoryTab } from '../../src/server/repository-tab';
import { timeAgo } from '../../src/repositories/when';
import { liveFeedPath, stateText } from './changes-tab';
import { Glyph } from './glyph';
import { LiveRefresh } from './live-refresh';
import { glyphOfState } from './ref-switcher';
import styles from './repo-tabs.module.css';
import { RepositoryShell } from './repository-shell';

const at = (ms: number): string => new Date(ms).toISOString();

export function ChangeDetail(props: {
  readonly tab: RepositoryTab;
  readonly change: Change;
  readonly changes: readonly Change[];
  /** The engine's verdict lines as the push printed them. */
  readonly verdict: readonly string[];
  readonly diff: RepoDiff | null;
  readonly lastSeq: number;
  readonly nowMs: number;
}) {
  const { tab, change } = props;
  const base = tab.base;
  return (
    <RepositoryShell page={tab} tab="changes" openChanges={groupCounts(props.changes).open}>
      <div className={styles.bar}>
        <Link href={`${base}/changes?show=${change.group}`} className={styles.back}>
          All changes
        </Link>
        <LiveRefresh
          path={liveFeedPath(base)}
          after={props.lastSeq}
          enabled={change.group === 'open'}
        />
      </div>
      <header className={styles.changeHead}>
        <h2>{change.title}</h2>
        <p>
          <Glyph kind={glyphOfState(change.state)} live={change.state === 'checking'} />
          <span className={styles.state} data-state={change.state}>
            {stateText(change)}
          </span>
          <span className={styles.beanName}>bean/{change.bean}</span>
          <span>
            by <span className={styles.person}>{authorText(change.author)}</span>
          </span>
          {change.head === null ? null : (
            <Link href={codeHref(base, 'tree', '', { kind: 'bean', name: change.bean })}>
              Browse its files
            </Link>
          )}
        </p>
      </header>
      <div className={styles.split}>
        <div>
          <section className={styles.box} aria-label="Journey">
            <div className={styles.boxHead}>
              <span className={styles.headTitle}>Journey</span>
              <span className={styles.headMeta}>
                {change.pushes} {change.pushes === 1 ? 'push' : 'pushes'}
              </span>
            </div>
            {change.journey.length === 0 ? (
              <p className={styles.empty}>Nothing has happened to this bean yet.</p>
            ) : (
              <ol className={styles.journey}>
                {change.journey.map((entry, index) => (
                  <li key={`${entry.at}-${index}`}>
                    <span className={styles.dot} data-tone={entry.tone} aria-hidden="true" />
                    <div className={styles.stepText}>
                      {entry.text}
                      <time dateTime={at(entry.at)}>{timeAgo(at(entry.at), props.nowMs)}</time>
                      {entry.lines.length === 0 ? null : (
                        <ul className={styles.stepLines}>
                          {entry.lines.map((line) => (
                            <li key={line}>{line}</li>
                          ))}
                        </ul>
                      )}
                      {entry.beans.length === 0 ? null : (
                        <div className={styles.stepBeans}>
                          {entry.beans.map((bean) => (
                            <Link key={bean} href={`${base}/changes/${encodeURIComponent(bean)}`}>
                              bean/{bean}
                            </Link>
                          ))}
                        </div>
                      )}
                    </div>
                  </li>
                ))}
              </ol>
            )}
          </section>
          <section className={styles.section} aria-label="Diff">
            <h3>Changes in this bean</h3>
            {props.diff === null || props.diff.files.length === 0 ? (
              <div className={styles.box}>
                <p className={styles.empty}>No diff to show yet.</p>
              </div>
            ) : (
              <DiffView files={props.diff.files} />
            )}
          </section>
        </div>
        <aside className={styles.aside} aria-label="What the push was told">
          <section>
            <h2>What the push was told</h2>
            {props.verdict.length === 0 ? (
              <p>{change.reason === '' ? 'No verdict yet.' : change.reason}</p>
            ) : (
              <div className={styles.box}>
                <pre className={styles.verdict}>{props.verdict.join('\n')}</pre>
              </div>
            )}
          </section>
        </aside>
      </div>
    </RepositoryShell>
  );
}
