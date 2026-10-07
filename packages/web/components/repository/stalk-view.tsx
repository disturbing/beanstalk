/**
 * The Stalk tab (backlog 2.7, `docs/claude-opus/20-repositories.md` §6): what is on the
 * stalk (validated and promoted, with the commits), what landed on the sprout and is still
 * being validated, what is growing and what was taken off, from the repo-events index.
 */
import Link from 'next/link';

import type { IndexedBean, RepoDay, RepositoryStalk } from '../../src/repositories/index-client';
import { timeAgo } from '../../src/repositories/when';
import styles from './stalk.module.css';

export function StalkView(props: {
  readonly base: string;
  readonly stalk: RepositoryStalk;
  readonly nowMs: number;
  /** How long the index read took, for the page's small print. */
  readonly readMs: number;
}) {
  const { stalk, base, nowMs } = props;
  const promotions = stalk.promotions;
  return (
    <div className={styles.page}>
      <Lines stalk={stalk} />
      <Week days={stalk.days} />
      <div className={styles.grid}>
        <div className={styles.column}>
          <section className={styles.panel} aria-labelledby="validating-title">
            <Head
              id="validating-title"
              title="Landed, validating on the sprout"
              count={stalk.validating.length}
            />
            <p className={styles.explain}>
              Green on the exact merged tree, so they are on the sprout. The stalk moves to them
              once a validation run of the sprout is green.
            </p>
            <BeanRows
              beans={stalk.validating}
              base={base}
              nowMs={nowMs}
              when="landed"
              empty="Nothing waiting: every landed bean is on the stalk."
            />
          </section>
          <section className={styles.panel} aria-labelledby="promoted-title">
            <Head id="promoted-title" title="On the stalk" count={promotions.length} />
            {promotions.length === 0 ? (
              <p className={styles.empty}>The stalk has not moved past its first commit yet.</p>
            ) : (
              <ol className={styles.moves}>
                {promotions.map((move) => (
                  <li key={`${move.sha}-${move.at}`} className={styles.move} data-kind={move.kind}>
                    <div className={styles.moveHead}>
                      <code className={styles.sha} title={move.sha}>
                        {move.sha.slice(0, 7)}
                      </code>
                      <span>{move.text}</span>
                      <time dateTime={move.at}>{timeAgo(move.at, nowMs)}</time>
                    </div>
                    {move.beans.length === 0 ? null : (
                      <BeanRows
                        beans={move.beans}
                        base={base}
                        nowMs={nowMs}
                        when="landed"
                        empty=""
                      />
                    )}
                  </li>
                ))}
              </ol>
            )}
          </section>
        </div>
        <div className={styles.column}>
          <section className={styles.panel} aria-labelledby="growing-title">
            <Head id="growing-title" title="Growing" count={stalk.growing.length} />
            <BeanRows
              beans={stalk.growing}
              base={base}
              nowMs={nowMs}
              when="opened"
              empty="No bean in its checks or with its author."
            />
          </section>
          <section className={styles.panel} aria-labelledby="off-title">
            <Head id="off-title" title="Taken off or waiting" count={stalk.off.length} />
            <BeanRows
              beans={stalk.off}
              base={base}
              nowMs={nowMs}
              when="updated"
              empty="Nothing reverted, dropped or parked."
            />
          </section>
          <section className={styles.panel} aria-labelledby="stalk-activity-title">
            <Head id="stalk-activity-title" title="What happened" count={stalk.activity.length} />
            {stalk.activity.length === 0 ? (
              <p className={styles.empty}>Nothing yet.</p>
            ) : (
              <ul className={styles.activity}>
                {stalk.activity.map((line, index) => (
                  <li key={`${line.at}-${index}`} data-kind={line.kind}>
                    <span>
                      {line.text}
                      <time dateTime={line.at}>{timeAgo(line.at, nowMs)}</time>
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </section>
        </div>
      </div>
      <p className={styles.smallPrint}>
        Read from the repository index in {Math.round(props.readMs)} ms; it follows the engine
        within a few seconds.
      </p>
    </div>
  );
}

function Lines({ stalk }: { readonly stalk: RepositoryStalk }) {
  const lines = stalk.lines;
  return (
    <div className={styles.lines}>
      <Head2
        label="Stalk"
        sha={lines?.stalk_sha ?? null}
        idx={lines?.stalk_idx ?? null}
        tone="stalk"
        note="validated: every check green"
      />
      <Head2
        label="Sprout"
        sha={lines?.sprout_sha ?? null}
        idx={lines?.sprout_idx ?? null}
        tone="sprout"
        note="landed: green on the merged tree"
      />
    </div>
  );
}

function Head2(props: {
  readonly label: string;
  readonly sha: string | null;
  readonly idx: number | null;
  readonly tone: 'stalk' | 'sprout';
  readonly note: string;
}) {
  return (
    <div className={styles.line} data-tone={props.tone}>
      <span className={styles.lineLabel}>{props.label}</span>
      <code className={styles.lineSha} title={props.sha ?? undefined}>
        {props.sha === null ? 'at its first commit' : props.sha.slice(0, 7)}
      </code>
      {props.idx === null ? null : <span className={styles.muted}>#{props.idx}</span>}
      <span className={styles.muted}>{props.note}</span>
    </div>
  );
}

const WEEK_COUNTS: readonly (readonly [keyof Omit<RepoDay, 'day'>, string])[] = [
  ['landed', 'landed'],
  ['promoted', 'stalk moves'],
  ['red_validations', 'red validations'],
  ['reverted', 'reverts'],
  ['reworks', 'reworks'],
  ['decisions', 'decisions'],
];

function Week({ days }: { readonly days: readonly RepoDay[] }) {
  const total = (key: keyof Omit<RepoDay, 'day'>) => days.reduce((sum, day) => sum + day[key], 0);
  return (
    <dl className={styles.week} aria-label="The last 7 days">
      {WEEK_COUNTS.map(([key, label]) => (
        <div key={key} className={styles.stat}>
          <dt>{label}</dt>
          <dd>{total(key)}</dd>
        </div>
      ))}
    </dl>
  );
}

function Head(props: { readonly id: string; readonly title: string; readonly count: number }) {
  return (
    <div className={styles.panelHead}>
      <h2 id={props.id}>{props.title}</h2>
      <span className={styles.muted}>{props.count === 0 ? '' : props.count}</span>
    </div>
  );
}

function BeanRows(props: {
  readonly beans: readonly IndexedBean[];
  readonly base: string;
  readonly nowMs: number;
  readonly when: 'opened' | 'landed' | 'updated';
  readonly empty: string;
}) {
  if (props.beans.length === 0)
    return props.empty === '' ? null : <p className={styles.empty}>{props.empty}</p>;
  return (
    <ul className={styles.beans}>
      {props.beans.map((bean) => (
        <li key={bean.bean} className={styles.bean}>
          <Link
            href={`${props.base}?bean=${encodeURIComponent(bean.bean)}`}
            className={styles.beanName}
          >
            {bean.bean}
          </Link>
          <span className={styles.beanTitle}>
            {bean.title === '' ? null : <>{bean.title} </>}
            <span className={styles.muted}>
              {bean.actor === null ? '' : `@${bean.actor}`}
              {bean.reworks > 0 ? ` · ${bean.reworks} rework${bean.reworks === 1 ? '' : 's'}` : ''}
            </span>
            {bean.reason === '' || props.when !== 'updated' ? null : (
              <span className={styles.reason}>
                {bean.state}: {bean.reason}
              </span>
            )}
          </span>
          <span className={styles.beanMeta}>
            {bean.landed_sha === null ? null : (
              <code className={styles.sha} title={bean.landed_sha}>
                {bean.landed_sha.slice(0, 7)}
              </code>
            )}
            <WhenOf bean={bean} when={props.when} nowMs={props.nowMs} />
          </span>
        </li>
      ))}
    </ul>
  );
}

function WhenOf(props: {
  readonly bean: IndexedBean;
  readonly when: 'opened' | 'landed' | 'updated';
  readonly nowMs: number;
}) {
  const at = {
    opened: props.bean.opened_at,
    landed: props.bean.landed_at,
    updated: props.bean.updated_at,
  }[props.when];
  return at === null ? null : <time dateTime={at}>{timeAgo(at, props.nowMs)}</time>;
}
