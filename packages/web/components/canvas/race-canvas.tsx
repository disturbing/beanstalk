'use client';

import { useEffect, useMemo, useRef, useState } from 'react';

import { codeMap, mapFiles } from '../../src/race/code-map';
import { raceCounters } from '@gitstalk/shared-ask/race/race-counters';
import type { RaceEvent } from '@gitstalk/shared-ask/race/race-events';
import type { FeedLine } from '../../src/race/race-feed';
import { recentFeed } from '../../src/race/race-feed';
import { raceMoments } from '../../src/race/race-moments';
import type { RaceOptions, RaceState } from '@gitstalk/shared-ask/race/race-state';
import { reduceRace } from '@gitstalk/shared-ask/race/reduce-race';
import styles from './canvas.module.css';
import { CodeMapView } from './code-map-view';
import { Counters } from './counters';
import type { DecisionAccess } from './decision-panel';
import { DecisionPanel } from './decision-panel';
import { EventFeed } from './event-feed';
import { Lanes } from './lanes';
import { ReplayBar } from './replay-bar';
import type { LiveStatus } from './use-live-events';
import { useLiveEvents } from './use-live-events';
import { useLiveNow } from './use-live-now';
import type { Speed } from './use-replay-clock';
import { useReplayClock } from './use-replay-clock';
import { Vine } from './vine';

export type RaceCanvasProps = {
  readonly run: string;
  readonly label: string;
  readonly mode: 'replay' | 'live';
  readonly events: readonly RaceEvent[];
  readonly titles: Readonly<Record<string, string>>;
  /** The repo's files, so the code map's layout is fixed from the start. */
  readonly files: readonly string[];
  readonly initialT: number | null;
  readonly initialSpeed: Speed;
  readonly access: DecisionAccess;
  /** The engine's knobs no event states (v2.2's agent release). */
  readonly options: RaceOptions;
};

/** Feed lines kept on screen. */
const FEED_LINES = 40;

/**
 * The race canvas: counters, the sprout and the stalk, agent lanes, the code map, decision
 * cards and the event feed, all derived from the events up to the playhead (a replay) or as
 * they arrive (a live run).
 */
export function RaceCanvas(props: RaceCanvasProps) {
  const live = useLiveEvents(props.run, props.events, props.mode === 'live');
  const events = props.mode === 'live' ? live.events : props.events;
  const end = raceEnd(events);
  const clock = useReplayClock({ end, initial: props.initialT ?? end, speed: props.initialSpeed });
  const settled = useMemo(() => reduceRace(events, props.options), [events, props.options]);
  const liveNow = useLiveNow(settled.epochMs, settled.endedAt, settled.clock);
  const now = props.mode === 'replay' ? clock.now : liveNow;
  const count = props.mode === 'replay' ? countUpTo(events, now) : events.length;
  const visible = useMemo(() => events.slice(0, count), [events, count]);
  const state = useMemo(
    () => (count === events.length ? settled : reduceRace(visible, props.options)),
    [count, events.length, settled, visible, props.options],
  );
  const files = useMemo(() => mapFiles(props.files, events), [props.files, events]);
  const map = useMemo(
    () => codeMap({ files, state, events: visible, now }),
    [files, state, visible, now],
  );
  const feed = useMemo(() => recentFeed(visible, FEED_LINES), [visible]);
  const moments = useMemo(() => raceMoments(events), [events]);
  const hasOpenCard = state.cards.some((card) => card.status === 'open');
  useUrlTime(props.mode === 'replay' && !clock.playing ? clock.now : null, clock.speed);
  return (
    <div className={styles.canvas}>
      <Counters
        counters={raceCounters(state)}
        policy={state.meta?.policy ?? 'beanstalk'}
        budgetUsd={state.meta?.budgetUsd ?? null}
      />
      <section className={styles.panel} aria-labelledby="vine-title">
        <div className={styles.panelHead}>
          <h2 id="vine-title" className={styles.panelTitle}>
            {state.meta?.policy === 'queue' ? 'The stalk' : 'The sprout and the stalk'}
          </h2>
          <span className={styles.panelNote}>{vineNote(state.meta?.policy)}</span>
        </div>
        <Vine run={props.run} state={state} titles={props.titles} />
        <VineLegend isQueue={state.meta?.policy === 'queue'} />
      </section>
      <div className={styles.grid}>
        <div className={styles.mainColumn}>
          {hasOpenCard ? (
            <DecisionSection
              run={props.run}
              state={state}
              titles={props.titles}
              access={props.access}
            />
          ) : null}
          <section className={styles.panel} aria-labelledby="lanes-title">
            <div className={styles.panelHead}>
              <h2 id="lanes-title" className={styles.panelTitle}>
                Agent lanes
              </h2>
              <span className={styles.panelNote}>
                Blue: writing or reworking. Hatched: holding a bean while it is checked or queued.
              </span>
            </div>
            <Lanes state={state} now={now} titles={props.titles} />
          </section>
          <section className={styles.panel} aria-labelledby="map-title">
            <div className={styles.panelHead}>
              <h2 id="map-title" className={styles.panelTitle}>
                Code map
              </h2>
              <span className={styles.panelNote}>What the beans in flight are touching now.</span>
            </div>
            <CodeMapView run={props.run} map={map} />
          </section>
        </div>
        <div className={styles.sideColumn}>
          {hasOpenCard ? null : (
            <DecisionSection
              run={props.run}
              state={state}
              titles={props.titles}
              access={props.access}
            />
          )}
          <section className={styles.panel} aria-labelledby="feed-title">
            <div className={styles.panelHead}>
              <h2 id="feed-title" className={styles.panelTitle}>
                Events
              </h2>
              <span className={styles.panelNote}>
                {visible.length} of {events.length}
              </span>
            </div>
            <EventFeed lines={feed} />
          </section>
        </div>
      </div>
      {props.mode === 'replay' ? (
        <ReplayBar clock={clock} moments={moments} label={props.label} />
      ) : (
        <LiveBar status={live.status} now={now} ended={settled.endedAt !== null} />
      )}
      {props.mode === 'live' ? <Announcer lines={feed} /> : null}
    </div>
  );
}

/**
 * Decision cards: a card waiting for a person takes the full width above the lanes, where
 * both specs and both diffs fit side by side; decided cards sit in the side column.
 */
function DecisionSection(props: {
  readonly run: string;
  readonly state: RaceState;
  readonly titles: Readonly<Record<string, string>>;
  readonly access: DecisionAccess;
}) {
  return (
    <section className={styles.panel} aria-labelledby="cards-title">
      <div className={styles.panelHead}>
        <h2 id="cards-title" className={styles.panelTitle}>
          Decision cards
        </h2>
      </div>
      <DecisionPanel
        run={props.run}
        cards={props.state.cards}
        titles={props.titles}
        access={props.access}
      />
    </section>
  );
}

/** The race's last second: its end, or the newest event of a race still running. */
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

function vineNote(policy: 'queue' | 'beanstalk' | undefined): string {
  if (policy === 'queue')
    return 'The queue lands only verified batches, straight on the stalk; red batches hang below.';
  return 'Beans land on the sprout after their pre-land check; the stalk follows once a validation passes.';
}

function VineLegend({ isQueue }: { readonly isQueue: boolean }) {
  return (
    <div className={styles.legend} aria-hidden="true">
      <LegendBead className={styles.beadGreen} text="on the stalk" />
      {isQueue ? null : (
        <LegendBead className={styles.beadPending} text="on the sprout, not validated yet" />
      )}
      {isQueue ? null : <LegendBead className={styles.beadValidating} text="validating" />}
      <LegendBead
        className={styles.beadRed}
        text={isQueue ? 'red batch' : 'validation red'}
        cross
      />
      {isQueue ? null : <LegendBead className={styles.beadReverted} text="reverted" />}
    </div>
  );
}

function LegendBead(props: {
  readonly className: string | undefined;
  readonly text: string;
  readonly cross?: boolean;
}) {
  return (
    <span className={styles.legendItem}>
      <svg width="16" height="16" viewBox="0 0 16 16">
        <circle cx="8" cy="8" r="6" className={props.className} />
        {props.cross === true ? (
          <path d="M5.5 5.5l5 5m0-5-5 5" className={styles.beadGlyph} />
        ) : null}
      </svg>
      {props.text}
    </span>
  );
}

function LiveBar(props: {
  readonly status: LiveStatus;
  readonly now: number;
  readonly ended: boolean;
}) {
  return (
    <div className={styles.bar} role="status">
      {props.ended ? <span>The race is over.</span> : null}
      {!props.ended && props.status === 'live' ? (
        <span className={styles.liveDot}>Live</span>
      ) : null}
      {!props.ended && props.status !== 'live' ? (
        <span className={styles.offline}>{liveStatusText(props.status)}</span>
      ) : null}
      <span />
      <span />
      <span className={styles.clock}>{formatNow(props.now)}</span>
    </div>
  );
}

function liveStatusText(status: LiveStatus): string {
  if (status === 'connecting') return 'Connecting to the live feed…';
  if (status === 'reconnecting') return 'Live feed interrupted, reconnecting…';
  return 'Live feed closed.';
}

function formatNow(seconds: number): string {
  const whole = Math.max(0, Math.floor(seconds));
  return `${Math.floor(whole / 60)}:${String(whole % 60).padStart(2, '0')}`;
}

/** Major lines read out once, as they arrive, in live mode only. */
function Announcer({ lines }: { readonly lines: readonly FeedLine[] }) {
  const [message, setMessage] = useState('');
  const lastSeq = useRef(lines[0]?.seq ?? 0);
  useEffect(() => {
    const fresh = lines.find((line) => line.seq > lastSeq.current && line.major);
    lastSeq.current = Math.max(lastSeq.current, lines[0]?.seq ?? 0);
    if (fresh !== undefined) setMessage(fresh.text);
  }, [lines]);
  return (
    <p className="visually-hidden" role="status" aria-live="polite">
      {message}
    </p>
  );
}

/** Keeps `?t=` and `?speed=` in the address bar while paused, so a moment can be shared. */
function useUrlTime(t: number | null, speed: Speed): void {
  useEffect(() => {
    if (t === null) return undefined;
    const timer = window.setTimeout(() => {
      const url = new URL(window.location.href);
      url.searchParams.set('t', String(Math.round(t)));
      url.searchParams.set('speed', String(speed));
      window.history.replaceState(window.history.state, '', url);
    }, 300);
    return () => window.clearTimeout(timer);
  }, [t, speed]);
}
