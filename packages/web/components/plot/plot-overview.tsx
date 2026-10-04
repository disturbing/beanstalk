'use client';

import Link from 'next/link';

import type { Suggestion } from '@beanstalk/shared-ask/pick/lead';
import type { PickReceipt } from '@beanstalk/shared-ask/pick/picker';
import type { PlotBud } from '@beanstalk/shared-ask/plot/plot-model';
import type { Bean, DecisionCard, RaceState } from '@beanstalk/shared-ask/race/race-state';
import { formatClock, formatSpan, formatUsd } from '../../src/race/race-format';
import { PickTag } from './pick-receipts';
import styles from './plot.module.css';
import type { PlotState } from './plot-url';
import { askPlotHref, plotHref } from './plot-url';

export type PlotOverviewProps = {
  readonly run: string;
  readonly url: PlotState;
  readonly state: RaceState;
  readonly now: number;
  readonly finished: boolean;
  readonly buds: readonly PlotBud[];
  readonly suggestions: readonly Suggestion[];
  readonly suggestReceipt: PickReceipt | null;
  readonly titles: Readonly<Record<string, string>>;
};

/** The pane when nothing is selected: questions to ask, the swarm now, and what happened. */
export function PlotOverview(props: PlotOverviewProps) {
  const ordered = orderedSuggestions(props.suggestions, props.suggestReceipt);
  const card = props.state.cards.find((item) => item.status === 'open') ?? props.state.cards[0];
  const dropped = Object.values(props.state.beans).filter((bean) => bean.phase === 'dropped');
  return (
    <>
      <h2 className={styles.paneHeading}>
        Ask
        {props.suggestReceipt === null ? null : (
          <PickTag receipt={props.suggestReceipt} label="suggested" />
        )}
      </h2>
      <div className={styles.suggest}>
        {ordered.map((item) => (
          <Link key={item.id} href={askPlotHref(props.run, props.url, item.question)}>
            {sentenceCase(item.question)}
          </Link>
        ))}
      </div>
      {props.buds.length > 0 ? <RightNow {...props} /> : null}
      <h2 className={styles.paneHeading}>What happened</h2>
      {card === undefined ? null : <DecisionStory run={props.run} url={props.url} card={card} />}
      <RedStory {...props} />
      {dropped.length > 0 ? (
        <FellOff run={props.run} url={props.url} beans={dropped} titles={props.titles} />
      ) : null}
      {card === undefined && dropped.length === 0 ? (
        <p className={styles.proseSmall}>No decisions, reds or dropped beans so far.</p>
      ) : null}
      {props.finished ? <AgentTime state={props.state} /> : null}
    </>
  );
}

function RightNow(props: PlotOverviewProps) {
  return (
    <>
      <h2 className={styles.paneHeading}>Right now, {formatClock(props.now)}</h2>
      <ul className={styles.beans}>
        {props.buds.map((bud) => (
          <li key={bud.task}>
            <Link href={plotHref(props.run, props.url, { bean: bud.task, file: null })}>
              <i className={styles.mark} data-kind="flying" />
              <span className={styles.beanTitle}>{bud.title}</span>
              <span className={styles.beanMeta}>{bud.agent ?? ''}</span>
              <span className={styles.beanSub}>
                {bud.phase}, for {formatSpan(props.now - bud.since)}
                {bud.cells.some((cell) => cell.overlap) ? '; shares a file with another bean' : ''}
              </span>
            </Link>
          </li>
        ))}
      </ul>
    </>
  );
}

export function DecisionStory(props: {
  readonly run: string;
  readonly url: PlotState;
  readonly card: DecisionCard;
}) {
  const { card } = props;
  const against = card.against[0];
  return (
    <div className={styles.story} data-tone="decide">
      <div className={styles.storyTitle}>{card.card}: two specs could not both hold</div>
      <p>
        <b>{card.task}</b> “{card.specs[card.task] ?? card.task}”
      </p>
      {against === undefined ? null : (
        <p>
          <b>{against}</b> “{card.specs[against] ?? against}”
        </p>
      )}
      <p>
        {card.failing.length} test{card.failing.length === 1 ? '' : 's'} failed whichever way the
        agent tried ({card.attempts} attempt{card.attempts === 1 ? '' : 's'}).{' '}
        {card.status === 'decided'
          ? `Decided for ${card.winner ?? '?'}${card.oracle === null ? '' : ` (${card.oracle})`}; ${card.loser ?? 'the other'} was declined.`
          : 'Waiting for a person.'}
      </p>
      <div className={styles.acts}>
        <Link href={plotHref(props.run, props.url, { bean: card.task, file: null })}>
          Follow {card.task}
        </Link>
        {against === undefined ? null : (
          <Link href={plotHref(props.run, props.url, { bean: against, file: null })}>
            Follow {against}
          </Link>
        )}
      </div>
    </div>
  );
}

function RedStory(props: PlotOverviewProps) {
  const first = props.state.ci.find((run) => run.purpose === 'validate' && run.green === false);
  if (first === undefined) return null;
  const ticket = props.state.tickets[0];
  const culprit = ticket?.culprit ?? null;
  const greenAgain = props.state.ci.find(
    (run) => run.purpose === 'validate' && run.green === true && run.startedAt > first.startedAt,
  );
  const inherited = Object.values(props.state.beans).reduce(
    (sum, bean) =>
      sum +
      bean.steps.filter(
        (step) =>
          step.kind === 'rework' &&
          step.detail.startsWith('preland-red') &&
          step.t >= (first.endedAt ?? 0) &&
          (greenAgain?.endedAt === undefined ||
            greenAgain.endedAt === null ||
            step.t <= greenAgain.endedAt),
      ).length,
    0,
  );
  return (
    <div className={styles.story} data-tone="bad">
      <div className={styles.storyTitle}>
        Red validation{ticket === undefined ? '' : ` ${ticket.ticket}`} at{' '}
        {formatClock(first.endedAt ?? first.startedAt)}
      </div>
      <p>
        <span className={styles.mono}>{shortPath(first.failingFiles[0] ?? 'a test')}</span> failed
        on the sprout
        {first.trunkIdx === null ? '' : ` at #${first.trunkIdx}`}.
        {culprit === null
          ? ''
          : ` Bisecting the beans whose read sets covered it named ${culprit}.`}
      </p>
      <p>
        {inherited > 0
          ? `${inherited} pre-land check${inherited === 1 ? '' : 's'} inherited the red. `
          : ''}
        {greenAgain?.endedAt === undefined || greenAgain.endedAt === null
          ? 'The sprout is still red.'
          : `Green again at ${formatClock(greenAgain.endedAt)}, ${formatSpan(greenAgain.endedAt - (first.endedAt ?? first.startedAt))} later.`}
      </p>
      <div className={styles.acts}>
        {culprit === null ? null : (
          <Link href={plotHref(props.run, props.url, { bean: culprit, file: null })}>
            Follow {culprit}
          </Link>
        )}
        <Link href={askPlotHref(props.run, props.url, 'why did the sprout go red?')}>
          What broke
        </Link>
      </div>
    </div>
  );
}

function FellOff(props: {
  readonly run: string;
  readonly url: PlotState;
  readonly beans: readonly Bean[];
  readonly titles: Readonly<Record<string, string>>;
}) {
  return (
    <div className={styles.story}>
      <div className={styles.storyTitle}>
        {props.beans.length} bean{props.beans.length === 1 ? '' : 's'} fell off
      </div>
      <ul className={styles.beans}>
        {props.beans.map((bean) => (
          <li key={bean.id}>
            <Link href={plotHref(props.run, props.url, { bean: bean.id, file: null })}>
              <i className={styles.mark} data-kind="fell" />
              <span className={styles.beanTitle}>{props.titles[bean.id] ?? bean.id}</span>
              <span className={styles.beanMeta}>{formatClock(bean.since)}</span>
              <span className={styles.beanSub}>
                {bean.id}, {bean.agent ?? 'no agent'}:{' '}
                {(bean.dropReason ?? 'dropped').replace('--max-rework', 'the maximum')}
              </span>
            </Link>
          </li>
        ))}
      </ul>
    </div>
  );
}

function AgentTime({ state }: { readonly state: RaceState }) {
  const totals = state.lanes.reduce(
    (sum, lane) => ({
      busy: sum.busy + lane.totals.busy,
      blocked: sum.blocked + lane.totals.blocked,
      idle: sum.idle + lane.totals.idle,
    }),
    { busy: 0, blocked: 0, idle: 0 },
  );
  const all = totals.busy + totals.blocked + totals.idle;
  if (all === 0) return null;
  const share = (value: number) => `${(value / all) * 100}%`;
  const green = Object.values(state.beans).filter((bean) => bean.phase === 'green').length;
  const hours = (state.endedAt ?? state.clock) / 3600;
  return (
    <>
      <h2 className={styles.paneHeading}>Where the agents’ time went</h2>
      <div
        className={styles.bar}
        role="img"
        aria-label="Agent time: writing, holding a bean while it is checked, idle"
      >
        <i style={{ width: share(totals.busy), background: 'var(--bean)' }} />
        <i style={{ width: share(totals.blocked), background: 'var(--pollen)' }} />
        <i style={{ width: share(totals.idle), background: 'var(--rule-strong)' }} />
      </div>
      <div className={styles.barKey}>
        <span>
          <i style={{ background: 'var(--bean)' }} />
          writing {Math.round(totals.busy / 60)} min
        </span>
        <span>
          <i style={{ background: 'var(--pollen)' }} />
          holding a bean while it is checked {Math.round(totals.blocked / 60)} min
        </span>
        <span>
          <i style={{ background: 'var(--rule-strong)' }} />
          idle {Math.round(totals.idle / 60)} min
        </span>
      </div>
      <div className={styles.facts}>
        <div>
          <b>{formatUsd(state.totals.costUsd)}</b>
          <span>agent spend</span>
        </div>
        <div>
          <b>{hours > 0 ? Math.round(green / hours) : 0}</b>
          <span>beans to the stalk an hour</span>
        </div>
        <div>
          <b>{state.totals.redValidations}</b>
          <span>red validations</span>
        </div>
      </div>
    </>
  );
}

function orderedSuggestions(
  items: readonly Suggestion[],
  receipt: PickReceipt | null,
): readonly Suggestion[] {
  if (receipt === null) return items.slice(0, 4);
  return receipt.chosen.flatMap((id) => items.filter((item) => item.id === id));
}

function sentenceCase(text: string): string {
  return text.charAt(0).toUpperCase() + text.slice(1);
}

function shortPath(path: string): string {
  return path.split('/').at(-1) ?? path;
}
