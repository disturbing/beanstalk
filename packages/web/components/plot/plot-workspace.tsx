'use client';

import Link from 'next/link';
import type { ReactNode } from 'react';
import { useEffect, useMemo, useState } from 'react';

import type { LeadFact, Suggestion } from '@beanstalk/shared-ask/pick/lead';
import { isFinished, leadDecision, leadFacts, leadKey } from '@beanstalk/shared-ask/pick/lead';
import type { PickReceipt } from '@beanstalk/shared-ask/pick/picker';
import type { PlotFocus } from '@beanstalk/shared-ask/plot/plot-model';
import { plotModel } from '@beanstalk/shared-ask/plot/plot-model';
import type { RaceEvent } from '@beanstalk/shared-ask/race/race-events';
import type { RaceOptions } from '@beanstalk/shared-ask/race/race-state';
import { reduceRace } from '@beanstalk/shared-ask/race/reduce-race';
import type { FileStat } from '@beanstalk/shared-ask/repo/repo-types';
import { pickLead } from '../../src/server/plot-actions';
import { useLiveEvents } from '../canvas/use-live-events';
import { useLiveNow } from '../canvas/use-live-now';
import { useReplayClock } from '../canvas/use-replay-clock';
import { AskShortcut } from '../explorer/ask-shortcut';
import { RunTabs } from '../explorer/run-header';
import { PickTag, PicksDrawer } from './pick-receipts';
import { PlotGrid } from './plot-grid';
import { PlotOverview } from './plot-overview';
import { PlotScrubber } from './plot-scrubber';
import styles from './plot.module.css';
import type { PlotState } from './plot-url';
import { askPlotHref, plotHref } from './plot-url';

export type PlotAnswerView = {
  readonly headline: string;
  readonly focus: PlotFocus;
  /** The parts of the question that can be removed (files show as columns instead). */
  readonly chips: readonly { readonly id: string; readonly label: string }[];
  readonly routeReceipt: PickReceipt | null;
  readonly filesReceipt: PickReceipt | null;
};

export type PlotWorkspaceProps = {
  readonly run: string;
  readonly label: string;
  readonly mode: 'replay' | 'live';
  readonly events: readonly RaceEvent[];
  readonly options: RaceOptions;
  readonly titles: Readonly<Record<string, string>>;
  readonly beds: readonly string[];
  readonly stats: Readonly<Record<string, readonly FileStat[]>>;
  readonly url: PlotState;
  readonly initialT: number | null;
  readonly answer: PlotAnswerView | null;
  readonly suggestions: readonly Suggestion[];
  /** Picks the server made for this page: the suggestions and the answer's. */
  readonly receipts: readonly PickReceipt[];
  /** The headline pick for the first moment shown, keyed by its set of facts. */
  readonly initialLead: { readonly key: string; readonly receipt: PickReceipt } | null;
  readonly picker: 'jev' | 'rules';
  /** The server-rendered reading pane for a question, a bean or a file. */
  readonly children?: ReactNode;
};

/**
 * The repository's home: the headline, the Plot at the playhead and the reading pane. A
 * recorded run replays; a live run follows its events as they arrive.
 */
export function PlotWorkspace(props: PlotWorkspaceProps) {
  const live = useLiveEvents(props.run, props.events, props.mode === 'live');
  const events = props.mode === 'live' ? live.events : props.events;
  const end = raceEnd(events);
  const clock = useReplayClock({ end, initial: props.initialT ?? end, speed: 10 });
  const settled = useMemo(() => reduceRace(events, props.options), [events, props.options]);
  const liveNow = useLiveNow(settled.epochMs, settled.endedAt, settled.clock);
  const now = props.mode === 'replay' ? clock.now : liveNow;
  const count = props.mode === 'replay' ? countUpTo(events, now) : events.length;
  const visible = useMemo(() => events.slice(0, count), [events, count]);
  const state = useMemo(
    () => (count === events.length ? settled : reduceRace(visible, props.options)),
    [count, events.length, settled, visible, props.options],
  );
  const finished = isFinished(state, now);
  const model = useMemo(
    () =>
      plotModel({
        state,
        events: visible,
        now,
        beds: props.beds,
        stats: props.stats,
        titles: props.titles,
        focus: props.answer?.focus ?? null,
      }),
    [state, visible, now, props.beds, props.stats, props.titles, props.answer],
  );
  const facts = useMemo(() => leadFacts(state, now), [state, now]);
  const lead = useLeadPick({
    run: props.run,
    facts,
    finished,
    now,
    settled: !clock.playing,
    seed: props.initialLead,
  });
  const url = useMemo(
    (): PlotState => ({
      ...props.url,
      t: finished || props.mode === 'live' ? null : Math.round(now),
    }),
    [props.url, finished, props.mode, now],
  );
  useUrlTime(props.mode === 'replay' && !clock.playing && !finished ? now : null);
  const receipts = useMemo(
    () => [...props.receipts, ...lead.history],
    [props.receipts, lead.history],
  );
  return (
    <div className={styles.workspace}>
      <section className={styles.main} aria-label="The Plot">
        <TopLine
          run={props.run}
          label={props.label}
          url={url}
          receipts={receipts}
          picker={props.picker}
        />
        <Lead run={props.run} url={url} answer={props.answer} facts={facts} lead={lead} />
        <Chips run={props.run} url={url} answer={props.answer} fileCount={props.beds.length} />
        <PlotGrid
          run={props.run}
          model={model}
          url={url}
          now={now}
          finished={finished}
          base={state.meta?.base ?? null}
          focused={props.answer?.focus.layout ?? null}
        />
        <PlotScrubber
          clock={clock}
          events={events}
          mode={props.mode}
          liveStatus={live.status}
          now={now}
        />
      </section>
      <aside className={styles.pane} aria-label="Reading pane">
        <div className={styles.paneInner}>
          {props.children ?? (
            <PlotOverview
              run={props.run}
              url={url}
              state={state}
              now={now}
              finished={finished}
              buds={model.buds}
              suggestions={props.suggestions}
              suggestReceipt={
                props.receipts.find((receipt) => receipt.decision === 'suggest') ?? null
              }
              titles={props.titles}
            />
          )}
        </div>
      </aside>
    </div>
  );
}

function TopLine(props: {
  readonly run: string;
  readonly label: string;
  readonly url: PlotState;
  readonly receipts: readonly PickReceipt[];
  readonly picker: 'jev' | 'rules';
}) {
  return (
    <div className={styles.topline}>
      <div className={styles.runName}>
        <strong>{props.label}</strong>
        <span>race-{props.run}</span>
      </div>
      <form action={`/runs/${props.run}`} method="get" className={styles.ask} role="search">
        <label htmlFor="plot-ask" className="visually-hidden">
          Ask about this repository
        </label>
        <input
          id="plot-ask"
          name="q"
          defaultValue={props.url.q}
          placeholder="Ask about this repository"
          autoComplete="off"
        />
        {props.url.t === null ? null : <input type="hidden" name="t" value={props.url.t} />}
        <kbd>/</kbd>
      </form>
      <AskShortcut target="plot-ask" />
      <RunTabs run={props.run} current="plot" />
      <PicksDrawer receipts={props.receipts} picker={props.picker} />
    </div>
  );
}

function Lead(props: {
  readonly run: string;
  readonly url: PlotState;
  readonly answer: PlotAnswerView | null;
  readonly facts: readonly LeadFact[];
  readonly lead: LeadPick;
}) {
  if (props.answer !== null) {
    return (
      <div className={styles.lead}>
        <h2>
          {props.answer.headline}
          {props.answer.routeReceipt === null ? null : (
            <PickTag receipt={props.answer.routeReceipt} label="routed" />
          )}
        </h2>
        <p>
          You asked “{props.url.q}”.{' '}
          {props.answer.focus.layout === 'files'
            ? 'The Plot keeps the files and beans this is about and folds the rest away.'
            : 'The Plot keeps every area and marks the beans this is about.'}
          <Link
            className={styles.textLink}
            href={plotHref(props.run, props.url, { q: '', removed: [], bean: null, file: null })}
          >
            Show the whole repository
          </Link>
        </p>
      </div>
    );
  }
  const byId = new Map<string, LeadFact>(props.facts.map((fact) => [fact.id, fact]));
  const [first, ...rest] = props.lead.order.flatMap((id) => {
    const fact = byId.get(id);
    return fact === undefined ? [] : [fact];
  });
  if (first === undefined) return null;
  return (
    <div className={styles.lead}>
      <h2>
        {first.sentence}
        {props.lead.receipt === null ? null : (
          <PickTag receipt={props.lead.receipt} label="picked" />
        )}
      </h2>
      {rest.slice(0, 2).map((fact) => (
        <p key={fact.id}>
          {fact.sentence}
          <FactLink run={props.run} url={props.url} fact={fact} />
        </p>
      ))}
    </div>
  );
}

function FactLink(props: {
  readonly run: string;
  readonly url: PlotState;
  readonly fact: LeadFact;
}) {
  const { action } = props.fact;
  if (action === null) return null;
  const href =
    action.kind === 'ask'
      ? askPlotHref(props.run, props.url, action.question)
      : plotHref(props.run, props.url, { bean: action.bean, file: null });
  return (
    <Link className={styles.textLink} href={href}>
      {action.label}
    </Link>
  );
}

function Chips(props: {
  readonly run: string;
  readonly url: PlotState;
  readonly answer: PlotAnswerView | null;
  readonly fileCount: number;
}) {
  const legend = (
    <div className={styles.legend}>
      <span>
        <i style={{ background: 'var(--leaf)', borderRadius: '0 80% 0 80%' }} />
        on the stalk
      </span>
      <span>
        <i style={{ background: 'var(--sprout)', borderRadius: '0 80% 0 80%' }} />
        on the sprout
      </span>
      <span>
        <i style={{ background: 'var(--bean)', borderRadius: '50%' }} />
        in flight
      </span>
      <span>
        <i style={{ boxShadow: 'inset 0 0 0 2px var(--leaf)', borderRadius: '50%' }} />
        tests only
      </span>
      <span>
        <i style={{ background: 'var(--blight)', borderRadius: '0 80% 0 80%' }} />
        turned the sprout red
      </span>
    </div>
  );
  if (props.answer === null) {
    return (
      <div className={styles.chips}>
        <span className={`${styles.chip} ${styles.scope}`}>
          Whole repository, <b>{props.fileCount} areas</b>
        </span>
        {legend}
      </div>
    );
  }
  const { answer } = props;
  return (
    <div className={styles.chips}>
      {answer.chips.map((chip) => (
        <span key={chip.id} className={styles.chip}>
          {chip.label}
          <Link
            href={plotHref(props.run, props.url, { removed: [...props.url.removed, chip.id] })}
            aria-label={`Remove ${chip.label}`}
          >
            ×
          </Link>
        </span>
      ))}
      <span className={styles.chip}>
        <b>{answer.focus.files.length} files</b>
        {answer.filesReceipt === null ? null : (
          <PickTag receipt={answer.filesReceipt} label="ranked" />
        )}
      </span>
      <span className={styles.chip}>
        <b>{answer.focus.beans.length} beans</b>
      </span>
      {legend}
    </div>
  );
}

type LeadPick = {
  readonly order: readonly string[];
  readonly receipt: PickReceipt | null;
  readonly history: readonly PickReceipt[];
};

/**
 * The headline's order: the rule at once, then the server's pick for this set of facts
 * (asked only while the playhead rests, and once per set).
 */
function useLeadPick(input: {
  readonly run: string;
  readonly facts: readonly LeadFact[];
  readonly finished: boolean;
  readonly now: number;
  readonly settled: boolean;
  readonly seed: PlotWorkspaceProps['initialLead'];
}): LeadPick {
  const key = leadKey(input.facts, input.finished);
  const [picked, setPicked] = useState<ReadonlyMap<string, PickReceipt>>(
    () => new Map(input.seed === null ? [] : [[input.seed.key, input.seed.receipt]]),
  );
  const known = picked.get(key);
  const { run, now, settled } = input;
  useEffect(() => {
    if (known !== undefined || !settled) return undefined;
    let cancelled = false;
    const ask = async (): Promise<void> => {
      // A failed pick leaves the rule's order on screen; the next set of facts asks again.
      const receipt = await pickLead(run, now).catch(() => null);
      if (!cancelled && receipt !== null)
        setPicked((current) => new Map(current).set(key, receipt));
    };
    const timer = window.setTimeout(() => void ask(), 400);
    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [known, settled, run, now, key]);
  const rule = leadDecision(input.facts, input.finished).rule().chosen;
  return { order: known?.chosen ?? rule, receipt: known ?? null, history: [...picked.values()] };
}

function raceEnd(events: readonly RaceEvent[]): number {
  const ended = events.findLast((event) => event.type === 'race.end');
  return ended?.t ?? events.at(-1)?.t ?? 0;
}

/** How many events happened by race second `t` (events are in time order). */
function countUpTo(events: readonly RaceEvent[], t: number): number {
  let low = 0;
  let high = events.length;
  while (low < high) {
    const middle = (low + high) >> 1;
    if ((events[middle]?.t ?? Number.POSITIVE_INFINITY) <= t) low = middle + 1;
    else high = middle;
  }
  return low;
}

function useUrlTime(t: number | null): void {
  useEffect(() => {
    if (t === null) return undefined;
    const timer = window.setTimeout(() => {
      const next = new URL(window.location.href);
      next.searchParams.set('t', String(Math.round(t)));
      window.history.replaceState(window.history.state, '', next);
    }, 300);
    return () => window.clearTimeout(timer);
  }, [t]);
}
