import Link from 'next/link';

import type { BeanDetail, BeanRecord } from '../../src/forge/forge-source';
import type { BeanStep } from '../../src/race/race-state';
import { formatClock, formatUsd, plural } from '../../src/race/race-format';
import type { RepoDiff } from '../../src/repo/repo-types';
import { StatusPill, beadClass } from './bean-status';
import { DiffView } from './diff-view';
import styles from './explorer.module.css';
import type { ExplorerState } from './explorer-url';
import { explorerHref } from './explorer-url';

/** One bean: what it is for, who carried it, what happened to it, and its own diff. */
export function BeanView(props: {
  readonly run: string;
  readonly state: ExplorerState;
  readonly bean: BeanDetail;
  readonly diff: RepoDiff | null;
  /** False when the rail already tells the bean's history. */
  readonly showSteps: boolean;
}) {
  const { bean } = props;
  return (
    <>
      <div className={styles.beanHead}>
        <h2 className={styles.beanTitle}>
          {bean.id} <span className={styles.beanTitleText}>{bean.title}</span>
        </h2>
        <div className={styles.beanFacts}>
          <StatusPill status={bean.status} />
          {bean.agent === null ? null : <span>agent {bean.agent}</span>}
          {bean.landedIdx === null ? null : <span>sprout #{bean.landedIdx}</span>}
          <span>{plural(bean.reworks, 'rework')}</span>
          <span>
            {plural(bean.checks, 'pre-land check')}
            {bean.redChecks > 0 ? `, ${bean.redChecks} red` : ''}
          </span>
          <span>{formatUsd(bean.costUsd)} agent spend</span>
          {bean.card === null ? null : <span>decision {bean.card}</span>}
        </div>
        {bean.intent === '' ? null : <p className={styles.intent}>{bean.intent}</p>}
        {bean.dropReason === null ? null : (
          <p className={styles.intent}>Dropped: {bean.dropReason}.</p>
        )}
        {bean.lastMessage === '' ? null : (
          <blockquote className={styles.said} aria-label="What the agent reported">
            {bean.lastMessage}
          </blockquote>
        )}
      </div>
      <div className={styles.mainBody}>
        {props.showSteps ? <BeanSteps steps={bean.steps} /> : null}
        {props.diff === null || props.diff.files.length === 0 ? (
          <p className={styles.note}>This bean has no change to show yet.</p>
        ) : (
          <DiffView files={props.diff.files} />
        )}
      </div>
    </>
  );
}

const STEP_LABEL: Readonly<Record<BeanStep['kind'], string>> = {
  started: 'Started',
  committed: 'Committed',
  'check-green': 'Pre-land check green',
  'check-red': 'Pre-land check red',
  recheck: 'Re-checked on a moved sprout',
  optimistic: 'Landed without a re-check',
  conflict: 'Merge conflict',
  rework: 'Back to its author',
  enqueued: 'Joined the queue',
  batched: 'In a CI batch',
  ejected: 'Ejected from the queue',
  decision: 'Decision',
  landed: 'Landed',
  green: 'On the stalk',
  reverted: 'Reverted',
  dropped: 'Dropped',
};

/** A bean's history as beads on a stem. */
export function BeanSteps({ steps }: { readonly steps: readonly BeanStep[] }) {
  if (steps.length === 0)
    return <p className={styles.note}>Nothing has happened to this bean yet.</p>;
  return (
    <ol className={styles.timeline} aria-label="What happened to this bean">
      {steps.map((step, index) => (
        <li key={`${step.t}-${index}`} className={styles.timelineItem}>
          <span className={stepBead(step.kind)} aria-hidden="true" />
          <div className={styles.timelineTop}>
            <strong>{STEP_LABEL[step.kind]}</strong>
            <span className={styles.timelineTime}>{formatClock(step.t)}</span>
          </div>
          {step.detail === '' ? null : <div className={styles.timelineSub}>{step.detail}</div>}
        </li>
      ))}
    </ol>
  );
}

function stepBead(kind: BeanStep['kind']): string {
  if (kind === 'green' || kind === 'check-green') return beadClass('green');
  if (kind === 'landed' || kind === 'optimistic') return beadClass('landed');
  if (kind === 'check-red' || kind === 'conflict' || kind === 'ejected' || kind === 'reverted') {
    return `${beadClass('dropped')} ${styles.beadRed ?? ''}`;
  }
  if (kind === 'decision') return `${beadClass('dropped')} ${styles.beadHuman ?? ''}`;
  if (kind === 'dropped') return beadClass('dropped');
  return beadClass('in-flight');
}

/** Beans as a list: id, title, status, agent; each opens its bean view. */
export function BeanList(props: {
  readonly run: string;
  readonly state: ExplorerState;
  readonly beans: readonly BeanRecord[];
}) {
  return (
    <ul className={styles.beanList}>
      {props.beans.map((bean) => (
        <li key={bean.id} className={styles.beanItem}>
          <Link
            className={styles.beanId}
            href={explorerHref(props.run, props.state, { bean: bean.id, file: null, view: null })}
          >
            {bean.id}
          </Link>
          <span className={styles.beanName}>{bean.title}</span>
          <StatusPill status={bean.status} />
          <span className={styles.beanSub}>
            {bean.agent === null ? 'no agent yet' : `agent ${bean.agent}`},{' '}
            {plural(bean.files.length, 'file')}
            {bean.reworks > 0 ? `, ${plural(bean.reworks, 'rework')}` : ''}
          </span>
        </li>
      ))}
    </ul>
  );
}
