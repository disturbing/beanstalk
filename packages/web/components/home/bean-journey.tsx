'use client';

import { useState } from 'react';

import type { FileDiff } from '@beanstalk/shared-ask/repo/repo-types';
import type { JourneyTone } from '@beanstalk/shared-ask/home/journey';
import { formatClock, formatSpan, plural } from '../../src/race/race-format';
import styles from './home.module.css';
import { DiffFiles } from './marks';

/** One step of a bean's journey as the card lists it. */
export type JourneyItem = {
  readonly id: string;
  readonly t: number;
  readonly tone: JourneyTone | 'all';
  readonly text: string;
  /** The step's facts (files, failing tests, a reason). */
  readonly detail: string;
  /** The step is happening now: a spinner instead of a dot. */
  readonly live: boolean;
  /** Its detail shows the bean's change. */
  readonly showsChange: boolean;
  /** The agent's own report, for the steps it wrote. */
  readonly report: string | null;
};

export type JourneyBean = {
  readonly id: string;
  readonly title: string;
  readonly intent: string;
  readonly status: { readonly word: string; readonly tone: string };
  readonly session: string;
  readonly landedIdx: number | null;
  readonly reworks: number;
};

/**
 * A bean's journey: its steps on the left ("All changes" first and selected), the selected
 * step's details or files on the right. A step in progress spins.
 */
export function BeanJourney(props: {
  readonly bean: JourneyBean;
  readonly steps: readonly JourneyItem[];
  readonly files: readonly FileDiff[];
  readonly now: number;
  readonly initialStep: string | null;
}) {
  const [selected, setSelected] = useState(
    props.steps.some((step) => step.id === props.initialStep)
      ? (props.initialStep ?? 'all')
      : 'all',
  );
  const choose = (id: string) => {
    setSelected(id);
    const url = new URL(window.location.href);
    if (id === 'all') url.searchParams.delete('step');
    else url.searchParams.set('step', id);
    window.history.replaceState(window.history.state, '', url);
  };
  const step = props.steps.find((item) => item.id === selected);
  const { bean } = props;
  return (
    <div className={styles.box}>
      <div className={styles.beanhead}>
        <h3>{bean.title}</h3>
        <div className={styles.meta}>
          <span className={styles.chip} data-tone={bean.status.tone}>
            {bean.status.word}
          </span>
          <span>{bean.id}</span>
          <span>{bean.session}</span>
          {bean.landedIdx === null ? null : <span>#{bean.landedIdx}</span>}
          {bean.reworks > 0 ? (
            <span className={styles.chip} data-tone="red">
              {plural(bean.reworks, 'rework')}
            </span>
          ) : null}
        </div>
        <p>{withCode(bean.intent.split('\n\n')[0] ?? '')}</p>
      </div>
      <div className={styles.jgrid}>
        <ol className={styles.journey} role="listbox" aria-label="Its journey">
          {props.steps.map((item) => (
            <li
              key={item.id}
              role="option"
              aria-selected={item.id === selected}
              data-tone={item.tone}
              data-live={item.live ? '' : undefined}
              tabIndex={0}
              onClick={() => choose(item.id)}
              onKeyDown={(event) => {
                if (event.key === 'Enter' || event.key === ' ') {
                  event.preventDefault();
                  choose(item.id);
                }
              }}
            >
              {item.tone === 'all' ? null : (
                <span className={styles.jt}>{formatClock(item.t)}</span>
              )}
              {item.text}
              {item.live ? <span className={styles.livetag}>live</span> : null}
            </li>
          ))}
        </ol>
        <div className={styles.jdetail}>
          <StepDetail
            step={step}
            files={props.files}
            now={props.now}
            landed={bean.landedIdx !== null}
          />
        </div>
      </div>
    </div>
  );
}

function StepDetail(props: {
  readonly step: JourneyItem | undefined;
  readonly files: readonly FileDiff[];
  readonly now: number;
  readonly landed: boolean;
}) {
  const { step, files } = props;
  if (step === undefined || step.tone === 'all') {
    if (files.length === 0) return <div className={styles.empty}>No change yet.</div>;
    return (
      <>
        <div className={styles.jnote}>
          {plural(files.length, 'file')}, its whole change{' '}
          {props.landed ? 'as it landed' : 'so far'}
        </div>
        <DiffFiles files={files} />
      </>
    );
  }
  return (
    <>
      <div className={styles.cardbody}>
        <p className={styles.stephead}>
          <span className={styles.jt}>{formatClock(step.t)}</span>
          {step.text}
        </p>
        {step.live && step.tone === 'plan' ? (
          <>
            <p>
              Running for {formatSpan(props.now - step.t)}: the change is merged onto the
              sprout&apos;s current head and the whole suite runs on that exact tree. Checks here
              take about 70 s.
            </p>
            <div className={styles.progress}>
              <i style={{ width: `${Math.min(96, ((props.now - step.t) / 70) * 100)}%` }} />
            </div>
          </>
        ) : null}
        {step.detail === '' ? null : <p>{step.detail}</p>}
        {step.report === null ? null : (
          <blockquote className={styles.report}>{step.report}</blockquote>
        )}
      </div>
      {step.showsChange && files.length > 0 ? (
        <DiffFiles files={files} open={1} lines={24} />
      ) : null}
    </>
  );
}

function withCode(text: string) {
  return text
    .split(/(`[^`]+`)/)
    .map((part, index) =>
      part.startsWith('`') && part.endsWith('`') ? (
        <code key={index}>{part.slice(1, -1)}</code>
      ) : (
        part
      ),
    );
}
