'use client';

/**
 * One job's steps and log. While the job runs, new lines arrive over Server-Sent Events and
 * the box follows the end, the way the streaming diff follows an agent's edit: scroll up and
 * it stops following (and says so) until you return to the end or press "Follow". Steps
 * fold; the running and failed ones start open. Search finds text without its colours and
 * steps through the matches; the raw log downloads as plain text.
 */
import type { FormEvent, UIEvent } from 'react';
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';

import type { Job, LogLine, Step } from '../../src/actions/actions-contract';
import { Job as JobSchema, LogLine as LogLineSchema } from '../../src/actions/actions-contract';
import { appendLines, groupByStep, searchLines } from '../../src/actions/log-view';
import {
  elapsedMs,
  formatDuration,
  isLive,
  stateOf,
  STATE_WORDS,
} from '../../src/actions/run-view';
import { AnsiText } from './ansi-text';
import styles from './actions.module.css';
import { StateMark } from './state-mark';

/** Within this many pixels of the end, the reader is "at the end" and the box follows. */
const END_SLACK_PX = 48;

type Connection = 'idle' | 'connecting' | 'live' | 'reconnecting' | 'done';

export function JobLog(props: {
  readonly job: Job;
  readonly lines: readonly LogLine[];
  /** The log route for this job (`…/jobs/<job>/log`). */
  readonly logPath: string;
  readonly nowMs: number;
}) {
  const live = useLiveLog(props.job, props.lines, props.logPath);
  const [query, setQuery] = useState('');
  const [current, setCurrent] = useState(0);
  const matches = useMemo(() => searchLines(live.lines, query), [live.lines, query]);
  const matchSet = useMemo(() => new Set(matches), [matches]);
  const currentLine = matches.length === 0 ? null : (matches[current % matches.length] ?? null);
  const groups = groupByStep(live.job.steps, live.lines);
  const box = useFollow(live.lines.length, currentLine);
  const folds = useFolds(live.job.steps);
  const stepOfCurrent = live.lines.find((line) => line.n === currentLine)?.step ?? null;
  const onSearch = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (matches.length > 0) setCurrent((index) => (index + 1) % matches.length);
  };
  const state = stateOf(live.job);
  return (
    <section className={styles.box} aria-labelledby="job-title">
      <div className={styles.jobHead}>
        <StateMark state={state} />
        <h2 id="job-title">
          {live.job.name}{' '}
          <span className={styles.muted}>
            {STATE_WORDS[state]} {formatDuration(elapsedMs(live.job, props.nowMs))}
          </span>
        </h2>
        <form className={styles.search} role="search" onSubmit={onSearch}>
          <label htmlFor="log-search" className="visually-hidden">
            Search this job&rsquo;s log
          </label>
          <input
            id="log-search"
            type="search"
            placeholder="Search log"
            value={query}
            onChange={(event) => {
              setQuery(event.target.value);
              setCurrent(0);
            }}
          />
          {query.trim() === '' ? null : (
            <span aria-live="polite">
              {matches.length === 0
                ? 'no matches'
                : `${(current % matches.length) + 1} of ${matches.length}`}
            </span>
          )}
          {matches.length > 1 ? (
            <button type="submit" className={styles.iconButton} aria-label="Next match">
              next
            </button>
          ) : null}
        </form>
        <a className={styles.iconButton} href={`${props.logPath}?download=1`} download>
          Download log
        </a>
      </div>
      <div
        className={styles.logBox}
        ref={box.ref}
        onScroll={box.onScroll}
        tabIndex={0}
        aria-label="Job log"
      >
        {groups.map((group) => (
          <StepFold
            key={group.step.number}
            step={group.step}
            lines={group.lines}
            open={folds.isOpen(group.step, box.following, stepOfCurrent)}
            onToggle={(open) => folds.set(group.step.number, open)}
            matches={matchSet}
            currentLine={currentLine}
            nowMs={props.nowMs}
          />
        ))}
      </div>
      <div className={styles.tail}>
        {live.connection === 'live' || live.connection === 'connecting' ? (
          <>
            <i className={styles.caret} aria-hidden="true" />
            <span role="status">{box.following ? 'following' : 'paused: you scrolled up'}</span>
          </>
        ) : (
          <span role="status">{tailWords(live.connection, live.lines.length)}</span>
        )}
        {box.following ? null : (
          <button
            type="button"
            className={`${styles.iconButton} ${styles.followButton}`}
            onClick={box.follow}
          >
            Follow
          </button>
        )}
      </div>
    </section>
  );
}

function tailWords(connection: Connection, lines: number): string {
  if (connection === 'reconnecting') return 'reconnecting…';
  return `${lines} ${lines === 1 ? 'line' : 'lines'}`;
}

/** The job and its lines, following the log route while the job can still change. */
function useLiveLog(job: Job, lines: readonly LogLine[], logPath: string) {
  const [state, setState] = useState({ job, lines });
  const [connection, setConnection] = useState<Connection>(
    isLive(stateOf(job)) ? 'connecting' : 'idle',
  );
  // The first line to ask for is fixed at mount: refreshes of the page must not reconnect.
  const [after] = useState(lines.at(-1)?.n ?? 0);
  const live = isLive(stateOf(job));
  useEffect(() => {
    if (!live) return undefined;
    const source = new EventSource(`${logPath}?after=${after}`);
    source.addEventListener('open', () => setConnection('live'));
    source.addEventListener('error', () => setConnection('reconnecting'));
    source.addEventListener('lines', (event) => {
      const parsed = LogLineSchema.array().safeParse(parseData(event.data)?.['lines']);
      if (parsed.success)
        setState((now) => ({ ...now, lines: appendLines(now.lines, parsed.data) }));
    });
    source.addEventListener('job', (event) => {
      const parsed = JobSchema.safeParse(parseData(event.data));
      if (parsed.success) setState((now) => ({ ...now, job: parsed.data }));
    });
    source.addEventListener('end', () => {
      setConnection('done');
      source.close();
    });
    return () => source.close();
  }, [live, logPath, after]);
  return { job: state.job, lines: state.lines, connection };
}

function parseData(data: unknown): Record<string, unknown> | null {
  if (typeof data !== 'string') return null;
  try {
    const value: unknown = JSON.parse(data);
    return typeof value === 'object' && value !== null ? { ...value } : null;
  } catch {
    return null;
  }
}

/** Keeps the box at its end while following; a reader's scroll away pauses it. */
function useFollow(lineCount: number, currentLine: number | null) {
  const ref = useRef<HTMLDivElement>(null);
  const [following, setFollowing] = useState(true);
  const [jump, setJump] = useState(0);
  useLayoutEffect(() => {
    const element = ref.current;
    if (element === null || !following || currentLine !== null) return;
    element.scrollTop = element.scrollHeight;
  }, [lineCount, following, jump, currentLine]);
  useLayoutEffect(() => {
    if (currentLine === null) return;
    const target = ref.current?.querySelector(`[data-n="${currentLine}"]`);
    if (target instanceof HTMLElement) target.scrollIntoView({ block: 'center' });
  }, [currentLine]);
  return {
    ref,
    following,
    onScroll: (event: UIEvent<HTMLDivElement>) => {
      const element = event.currentTarget;
      const atEnd = element.scrollHeight - element.scrollTop - element.clientHeight < END_SLACK_PX;
      if (atEnd !== following) setFollowing(atEnd);
    },
    follow: () => {
      setFollowing(true);
      setJump((count) => count + 1);
    },
  };
}

/** Which steps are open: the reader's choice, else open while running or failed. */
function useFolds(steps: readonly Step[]) {
  const [chosen, setChosen] = useState<ReadonlyMap<number, boolean>>(new Map());
  const lastRunning = steps.findLast((step) => stateOf(step) === 'running')?.number ?? null;
  return {
    isOpen: (step: Step, following: boolean, stepOfMatch: number | null) => {
      if (step.number === stepOfMatch) return true;
      if (following && step.number === lastRunning) return true;
      const choice = chosen.get(step.number);
      if (choice !== undefined) return choice;
      const state = stateOf(step);
      return state === 'running' || state === 'failure';
    },
    set: (number: number, open: boolean) => setChosen((now) => new Map([...now, [number, open]])),
  };
}

function StepFold(props: {
  readonly step: Step;
  readonly lines: readonly LogLine[];
  readonly open: boolean;
  readonly onToggle: (open: boolean) => void;
  readonly matches: ReadonlySet<number>;
  readonly currentLine: number | null;
  readonly nowMs: number;
}) {
  const { step } = props;
  const state = stateOf(step);
  return (
    <details
      className={styles.step}
      data-state={state}
      open={props.open}
      onToggle={(event) => {
        if (event.currentTarget.open !== props.open) props.onToggle(event.currentTarget.open);
      }}
    >
      <summary>
        <StateMark state={state} size={14} />
        <span className={styles.stepName}>{step.name}</span>
        <span className={styles.stepTime}>{formatDuration(elapsedMs(step, props.nowMs))}</span>
      </summary>
      {props.open && props.lines.length > 0 ? (
        <div className={styles.lines}>
          {props.lines.map((line) => (
            <div
              key={line.n}
              className={styles.line}
              data-n={line.n}
              data-match={props.matches.has(line.n) ? '' : undefined}
              data-current={props.currentLine === line.n ? '' : undefined}
              id={`L${line.n}`}
            >
              <a className={styles.ln} href={`#L${line.n}`}>
                {line.n}
              </a>
              <AnsiText text={line.text} />
            </div>
          ))}
        </div>
      ) : null}
    </details>
  );
}
