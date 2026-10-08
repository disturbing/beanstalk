/**
 * Automations → Actions: the workflows in a rail (each with its last run's state), the
 * selected one's triggers, compatibility notes, "View file" and "Run workflow", then its runs
 * (or every workflow's) with filters by workflow, status and line, newest first.
 */
import Link from 'next/link';

import type {
  RunFilter,
  RunPage,
  RunSummary,
  Workflow,
  WorkflowTrigger,
} from '../../src/actions/actions-contract';
import { STATUS_FILTER_WORDS, STATUS_FILTERS, filterHref } from '../../src/actions/run-filters';
import {
  actorLabel,
  dispatchOf,
  elapsedMs,
  eventWord,
  formatDuration,
  runTitle,
  stateOf,
  triggerLabel,
} from '../../src/actions/run-view';
import { timeAgo } from '../../src/repositories/when';
import type { ActionsAccess } from '../../src/server/actions-page';
import { AutoSubmitSelect } from '../explorer/auto-submit-select';
import styles from './actions.module.css';
import { RunWorkflow } from './run-workflow';
import { StateMark } from './state-mark';

export function WorkflowsView(props: {
  readonly base: string;
  readonly workflows: readonly Workflow[];
  readonly runs: RunPage | null;
  readonly runsError: string | null;
  readonly filter: RunFilter;
  readonly access: ActionsAccess | null;
  readonly nowMs: number;
}) {
  const path = `${props.base}/actions`;
  const selected =
    props.workflows.find((workflow) => workflow.id === props.filter.workflow) ?? null;
  return (
    <div className={styles.layout}>
      <WorkflowRail path={path} workflows={props.workflows} filter={props.filter} />
      <section className={styles.box} aria-labelledby="workflow-title">
        {selected === null ? (
          <AllWorkflowsHead count={props.workflows.length} />
        ) : (
          <WorkflowHead base={props.base} workflow={selected} access={props.access} />
        )}
        <Filters path={path} filter={props.filter} />
        <RunList
          base={props.base}
          path={path}
          runs={props.runs}
          error={props.runsError}
          filter={props.filter}
          nowMs={props.nowMs}
        />
      </section>
    </div>
  );
}

function WorkflowRail(props: {
  readonly path: string;
  readonly workflows: readonly Workflow[];
  readonly filter: RunFilter;
}) {
  const withNotes = props.workflows.filter((workflow) => workflow.notes.length > 0).length;
  return (
    <aside className={styles.rail} aria-label="Workflows">
      <h2>Workflows</h2>
      <ul className={styles.workflows}>
        <li>
          <Link
            href={filterHref(props.path, props.filter, { workflow: null })}
            aria-current={props.filter.workflow === undefined ? 'page' : undefined}
          >
            <span />
            <span className={styles.workflowName}>All workflows</span>
          </Link>
        </li>
        {props.workflows.map((workflow) => (
          <li key={workflow.id}>
            <Link
              href={filterHref(props.path, props.filter, { workflow: workflow.id })}
              aria-current={props.filter.workflow === workflow.id ? 'page' : undefined}
              title={workflow.path}
            >
              {workflow.lastRun === null ? (
                <span />
              ) : (
                <StateMark state={stateOf(workflow.lastRun)} />
              )}
              <span className={styles.workflowName}>{workflow.name}</span>
            </Link>
          </li>
        ))}
      </ul>
      {withNotes === 0 ? null : (
        <p className={styles.railNote}>
          <b>Compatibility:</b> {withNotes} {withNotes === 1 ? 'workflow has' : 'workflows have'}{' '}
          notes on what runs differently here.
        </p>
      )}
    </aside>
  );
}

function AllWorkflowsHead({ count }: { readonly count: number }) {
  return (
    <div className={styles.workflowHead}>
      <div>
        <h2 id="workflow-title">All workflows</h2>
        <p className={styles.workflowPath}>
          {count} {count === 1 ? 'workflow' : 'workflows'} in .github/workflows, run when the stalk
          moves, on schedule or by hand
        </p>
      </div>
    </div>
  );
}

function WorkflowHead(props: {
  readonly base: string;
  readonly workflow: Workflow;
  readonly access: ActionsAccess | null;
}) {
  const { workflow } = props;
  const dispatch = dispatchOf(workflow);
  return (
    <div className={styles.workflowHead}>
      <div>
        <h2 id="workflow-title">{workflow.name}</h2>
        <p className={styles.workflowPath}>
          <Link
            href={`${props.base}/blob/${workflow.path.split('/').map(encodeURIComponent).join('/')}`}
          >
            {workflow.path}
          </Link>
        </p>
      </div>
      <div className={styles.workflowTools}>
        <Link
          className={styles.button}
          href={`${props.base}/blob/${workflow.path.split('/').map(encodeURIComponent).join('/')}`}
        >
          View file
        </Link>
        <span
          className={styles.button}
          aria-disabled="true"
          title="Editing in the browser lands as a bean; coming"
        >
          Edit <span className={styles.soon}>coming</span>
        </span>
        {dispatch !== null && props.access !== null && workflow.error === null ? (
          <RunWorkflow
            workflowId={workflow.id}
            workflowName={workflow.name}
            inputs={dispatch.inputs}
            access={props.access}
          />
        ) : null}
      </div>
      <ul className={styles.triggers} aria-label="Triggers">
        {workflow.triggers.map((trigger, index) => (
          <li
            key={index}
            className={styles.trigger}
            data-support={trigger.event === 'other' ? trigger.support : 'runs'}
            title={trigger.event === 'other' ? trigger.reason : undefined}
          >
            {triggerLabel(trigger)}
            {supportSuffix(trigger)}
          </li>
        ))}
      </ul>
      {workflow.error === null ? null : <p className={styles.parseError}>{workflow.error}</p>}
      {workflow.notes.length === 0 ? null : (
        <ul className={styles.notes} aria-label="Compatibility notes">
          {workflow.notes.map((note) => (
            <li key={note.text} data-level={note.level}>
              {note.text}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

/** What follows a trigger that does not run yet, or never will here. */
function supportSuffix(trigger: WorkflowTrigger): string {
  if (trigger.event !== 'other') return '';
  return trigger.support === 'never' ? ': never here' : ': soon';
}

function Filters(props: { readonly path: string; readonly filter: RunFilter }) {
  const { filter } = props;
  const filtered = filter.status !== undefined || filter.branch !== undefined;
  return (
    <form method="get" action={props.path} className={styles.filters}>
      {filter.workflow === undefined ? null : (
        <input type="hidden" name="workflow" value={filter.workflow} />
      )}
      <label htmlFor="run-status">
        Status
        <AutoSubmitSelect
          id="run-status"
          name="status"
          defaultValue={filter.status ?? ''}
          className={styles.select}
        >
          <option value="">any</option>
          {STATUS_FILTERS.map((status) => (
            <option key={status} value={status}>
              {STATUS_FILTER_WORDS[status]}
            </option>
          ))}
        </AutoSubmitSelect>
      </label>
      <label htmlFor="run-branch">
        Line
        <AutoSubmitSelect
          id="run-branch"
          name="branch"
          defaultValue={filter.branch ?? ''}
          className={styles.select}
        >
          <option value="">any</option>
          <option value="stalk">stalk (main)</option>
          <option value="sprout">sprout</option>
        </AutoSubmitSelect>
      </label>
      <noscript>
        <button type="submit" className={styles.filterGo}>
          Filter
        </button>
      </noscript>
      {filtered ? (
        <Link
          className={styles.clear}
          href={filterHref(props.path, filter, { status: null, branch: null })}
        >
          Clear filters
        </Link>
      ) : null}
    </form>
  );
}

function RunList(props: {
  readonly base: string;
  readonly path: string;
  readonly runs: RunPage | null;
  readonly error: string | null;
  readonly filter: RunFilter;
  readonly nowMs: number;
}) {
  if (props.runs === null)
    return <p className={styles.empty}>Runs could not be read: {props.error ?? 'no answer'}.</p>;
  if (props.runs.runs.length === 0)
    return (
      <p className={styles.empty}>
        {props.filter.status === undefined && props.filter.branch === undefined
          ? 'No runs yet. A workflow runs when the stalk moves, on its schedule, or by hand.'
          : 'No runs match these filters.'}
      </p>
    );
  const next = props.runs.next;
  return (
    <>
      <ol className={styles.runs} aria-label="Runs">
        {props.runs.runs.map((run) => (
          <li key={run.id}>
            <RunRow run={run} base={props.base} nowMs={props.nowMs} />
          </li>
        ))}
      </ol>
      {next === null ? null : (
        <Link className={styles.more} href={filterHref(props.path, props.filter, { before: next })}>
          Older runs
        </Link>
      )}
    </>
  );
}

function RunRow(props: {
  readonly run: RunSummary;
  readonly base: string;
  readonly nowMs: number;
}) {
  const { run } = props;
  const state = stateOf(run);
  return (
    <div className={styles.run}>
      <StateMark state={state} />
      <span className={styles.runTitle}>
        <Link href={`${props.base}/actions/runs/${encodeURIComponent(run.id)}`}>
          {runTitle(run)}
        </Link>
      </span>
      <span className={styles.runMeta}>
        <b>
          {run.workflowName} #{run.number}
        </b>
        <span>{eventWord(run.event)}</span>
        <Link
          className={styles.sha}
          href={`${props.base}/tree?ref=${encodeURIComponent(run.sha)}`}
          title="Browse the files at this commit"
        >
          {run.sha.slice(0, 7)}
        </Link>
        {run.bean === null ? null : (
          <Link
            className={styles.bean}
            href={`${props.base}/changes/${encodeURIComponent(run.bean)}`}
          >
            bean/{run.bean}
          </Link>
        )}
        <span>{actorLabel(run.actor)}</span>
      </span>
      <span className={styles.runTimes}>
        <time dateTime={run.createdAt}>{timeAgo(run.createdAt, props.nowMs)}</time>
        <span title="Wall time">{formatDuration(elapsedMs(run, props.nowMs)) || 'waiting'}</span>
        <span title="Minutes billed: each job rounded up">{run.billedMinutes} min billed</span>
      </span>
    </div>
  );
}
