/**
 * One run (`docs/claude-opus/25` §5.2, §5.3): what started it and on which commit, its facts
 * (status, wall time, minutes billed, inputs), the job graph, annotations, the jobs' summary,
 * then the chosen job's steps and live log. Maintainers get Cancel and Re-run.
 */
import Link from 'next/link';

import type { Annotation, LogLine, RunDetail } from '../../src/actions/actions-contract';
import { annotationsFromLog } from '../../src/actions/log-view';
import {
  actorLabel,
  elapsedMs,
  eventWord,
  formatDuration,
  isLive,
  runTitle,
  stateOf,
  STATE_WORDS,
} from '../../src/actions/run-view';
import { timeAgo } from '../../src/repositories/when';
import type { ActionsAccess } from '../../src/server/actions-page';
import { MarkdownView } from '../repo-tabs/markdown-view';
import styles from './actions.module.css';
import { JobGraph } from './job-graph';
import { JobLog } from './job-log';
import { RunControls } from './run-controls';
import { RunRefresher } from './run-refresher';
import { StateMark } from './state-mark';

export function RunView(props: {
  readonly base: string;
  readonly apiBase: string;
  readonly run: RunDetail;
  readonly jobId: string | null;
  readonly lines: readonly LogLine[] | null;
  readonly access: ActionsAccess | null;
  readonly nowMs: number;
}) {
  const { run, base } = props;
  const state = stateOf(run);
  const runPath = `${base}/actions/runs/${encodeURIComponent(run.id)}`;
  const job = run.jobs.find((candidate) => candidate.id === props.jobId) ?? null;
  const annotations =
    run.annotations.length > 0 || job === null
      ? run.annotations
      : annotationsFromLog(job.id, props.lines ?? []);
  return (
    <>
      <RunRefresher live={isLive(state)} />
      <Link
        className={styles.crumb}
        href={`${base}/actions?workflow=${encodeURIComponent(run.workflowId)}`}
      >
        ← {run.workflowName} runs
      </Link>
      <header className={styles.runHead}>
        <StateMark state={state} size={20} />
        <h1>{runTitle(run)}</h1>
        <p className={styles.runFacts}>
          <b>
            {run.workflowName} #{run.number}
          </b>
          <span>{eventWord(run.event)}</span>
          <Link className={styles.sha} href={`${base}/tree?ref=${encodeURIComponent(run.sha)}`}>
            {run.sha.slice(0, 7)}
          </Link>
          {run.bean === null ? null : (
            <Link className={styles.bean} href={`${base}/changes/${encodeURIComponent(run.bean)}`}>
              bean/{run.bean}
            </Link>
          )}
          <span>{actorLabel(run.actor)}</span>
          <time dateTime={run.createdAt}>{timeAgo(run.createdAt, props.nowMs)}</time>
        </p>
        {props.access === null ? null : (
          <RunControls
            runId={run.id}
            live={isLive(state)}
            canRerun={run.canRerun}
            access={props.access}
          />
        )}
      </header>
      {run.reason === null ? null : (
        <p className={styles.reason} role="note">
          {run.reason}
        </p>
      )}
      <section className={styles.box} aria-label="Run">
        <dl className={styles.facts}>
          <div>
            <dt>Status</dt>
            <dd>{STATE_WORDS[state]}</dd>
          </div>
          <div>
            <dt>Wall time</dt>
            <dd>{formatDuration(elapsedMs(run, props.nowMs)) || 'waiting'}</dd>
          </div>
          <div>
            <dt>Minutes billed</dt>
            <dd>{run.billedMinutes}</dd>
          </div>
          <div>
            <dt>Line</dt>
            <dd>{run.branch}</dd>
          </div>
          {Object.entries(run.inputs).map(([name, value]) => (
            <div key={name}>
              <dt>{name}</dt>
              <dd>{value}</dd>
            </div>
          ))}
          <div>
            <dt>Workflow</dt>
            <dd>
              <Link
                href={`${base}/blob/${run.workflowPath.split('/').map(encodeURIComponent).join('/')}`}
              >
                {run.workflowPath.split('/').at(-1)}
              </Link>
            </dd>
          </div>
        </dl>
        <div className={styles.boxHead}>
          <h2>Jobs</h2>
          <span className={styles.muted}>
            {run.jobs.length} {run.jobs.length === 1 ? 'job' : 'jobs'}
            {(run.jobs[0]?.runsOn ?? '') === '' ? '' : ` · runs-on ${run.jobs[0]?.runsOn}`}
          </span>
        </div>
        {run.jobs.length === 0 ? (
          <p className={styles.empty}>This run has no jobs.</p>
        ) : (
          <JobGraph
            jobs={run.jobs}
            selected={job?.id ?? null}
            runPath={runPath}
            nowMs={props.nowMs}
          />
        )}
      </section>
      {annotations.length === 0 ? null : (
        <Annotations annotations={annotations} base={base} run={run} />
      )}
      {run.summary === null ? null : (
        <section className={styles.box} aria-labelledby="summary-title">
          <div className={styles.boxHead}>
            <h2 id="summary-title">Summary</h2>
          </div>
          <MarkdownView text={run.summary} resolve={(href) => href} />
        </section>
      )}
      {job === null || props.lines === null ? null : (
        <JobLog
          key={job.id}
          job={job}
          lines={props.lines}
          logPath={`${props.apiBase}/runs/${encodeURIComponent(run.id)}/jobs/${encodeURIComponent(job.id)}/log`}
          nowMs={props.nowMs}
        />
      )}
    </>
  );
}

function Annotations(props: {
  readonly annotations: readonly Annotation[];
  readonly base: string;
  readonly run: RunDetail;
}) {
  const errors = props.annotations.filter((annotation) => annotation.level === 'error').length;
  const warnings = props.annotations.filter((annotation) => annotation.level === 'warning').length;
  return (
    <section className={styles.box} aria-labelledby="annotations-title">
      <div className={styles.boxHead}>
        <h2 id="annotations-title">Annotations</h2>
        <span className={styles.muted}>
          {errors} {errors === 1 ? 'error' : 'errors'}, {warnings}{' '}
          {warnings === 1 ? 'warning' : 'warnings'}
        </span>
      </div>
      <ul className={styles.annotations}>
        {props.annotations.map((annotation, index) => (
          <li key={index}>
            <span
              className={styles.annotationIcon}
              data-level={annotation.level}
              role="img"
              aria-label={annotation.level}
            />
            <span>{annotation.message}</span>
            <small>
              {props.run.jobs.find((job) => job.id === annotation.jobId)?.name ?? annotation.jobId}
              {annotation.path === null ? null : (
                <>
                  {' · '}
                  <Link
                    href={`${props.base}/blob/${annotation.path.split('/').map(encodeURIComponent).join('/')}?ref=${encodeURIComponent(props.run.sha)}${annotation.line === null ? '' : `#L${annotation.line}`}`}
                  >
                    {annotation.path}
                    {annotation.line === null ? '' : `:${annotation.line}`}
                  </Link>
                </>
              )}
            </small>
          </li>
        ))}
      </ul>
    </section>
  );
}
