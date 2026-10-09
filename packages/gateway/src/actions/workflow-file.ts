/**
 * A `.github/workflows/*.yml` file read with GitHub's own parser (`@actions/workflow-parser`,
 * MIT): schema errors with line and column, the triggers Beanstalk runs, each job's plan, and
 * the compatibility report (doc 25 §1.1). Pure: the index and the run DO both call it.
 */
import type {
  CompatibilityNote,
  DispatchInputSpec,
  JobStepSpec,
  WorkflowProblem,
  WorkflowTrigger,
} from '@beanstalk/shared-race/actions';
import {
  NoOperationTraceWriter,
  convertWorkflowTemplate,
  parseWorkflow,
} from '@actions/workflow-parser';
import type { WorkflowTemplate } from '@actions/workflow-parser';

import { parseCron } from '@beanstalk/shared-race/cron';
import type { MatrixLeg, MatrixPlan } from './matrix';
import { planMatrix } from './matrix';
import type { PlainValue } from './plain';
import { isPlainObject, plainOf, stringsOf } from './plain';

/** One job of a workflow, as the run DO plans it. */
export type JobPlan = {
  readonly key: string;
  /** `name:` as written (may hold `${{ matrix.x }}`), or null. */
  readonly nameTemplate: string | null;
  readonly needs: readonly string[];
  /** The normalized condition (`success()` when none is written). */
  readonly condition: string;
  /** The container image label `runs-on` maps to; null when Beanstalk cannot run it. */
  readonly image: string | null;
  readonly timeoutMinutes: number | null;
  readonly matrix: MatrixPlan;
  readonly outputs: Readonly<Record<string, string>>;
  readonly steps: readonly JobStepSpec[];
  /** Secrets the job's text names (`secrets.X`), upper case; never `GITHUB_TOKEN`. */
  readonly secretNames: readonly string[];
  /** `permissions` give `contents: write`: the job token may push `bean/*`. */
  readonly contentsWrite: boolean;
  /** `permissions` give `id-token: write`: the job may ask for an OIDC token. */
  readonly idTokenWrite: boolean;
};

export type WorkflowFile = {
  readonly path: string;
  readonly name: string;
  readonly triggers: readonly WorkflowTrigger[];
  readonly unsupportedEvents: readonly string[];
  readonly jobs: readonly JobPlan[];
  readonly problems: readonly WorkflowProblem[];
  readonly compatibility: readonly CompatibilityNote[];
};

export type { MatrixLeg };

/** What the repository allows: matrix legs per job, and minutes per job (longer is capped). */
export type WorkflowLimits = { readonly maxMatrixLegs: number; readonly maxTimeoutMinutes: number };

/** `runs-on` labels Beanstalk runs, and the image each maps to. */
const IMAGES: Readonly<Record<string, string>> = {
  'ubuntu-latest': 'ubuntu-24.04',
  'ubuntu-24.04': 'ubuntu-24.04',
  'ubuntu-22.04': 'ubuntu-24.04',
};
const SUPPORTED_EVENTS = new Set(['push', 'workflow_dispatch', 'schedule']);
const LATER_EVENTS = new Set([
  'pull_request',
  'merge_group',
  'repository_dispatch',
  'workflow_run',
  'workflow_call',
]);
const SECRET_REFERENCE =
  /secrets\s*\.\s*([A-Za-z_][A-Za-z0-9_]*)|secrets\s*\[\s*'([A-Za-z_][A-Za-z0-9_]*)'\s*\]/g;

/** Reads one workflow file. Never throws: problems are in the answer. */
export async function readWorkflowFile(
  path: string,
  source: string,
  limits: WorkflowLimits,
): Promise<WorkflowFile> {
  const fallbackName = path.split('/').at(-1) ?? path;
  const parsed = parseWorkflow({ name: path, content: source }, new NoOperationTraceWriter());
  const template =
    parsed.value === undefined ? null : await convertWorkflowTemplate(parsed.context, parsed.value);
  const problems = problemsOf(parsed.context.errors.getErrors());
  const root = parsed.value === undefined ? null : plainOf(parsed.value);
  if (template === null || root === null || !isPlainObject(root) || problems.length > 0) {
    return emptyWorkflow(path, fallbackName, problems);
  }
  const name = typeof root['name'] === 'string' ? root['name'] : fallbackName;
  const events = eventsOf(template);
  const jobs = jobsOf(template, root, limits);
  const jobProblems = jobs.flatMap((job) =>
    job.matrix.kind === 'invalid'
      ? [{ message: `job ${job.key}: ${job.matrix.reason}`, line: null, column: null }]
      : [],
  );
  return {
    path,
    name,
    triggers: events.triggers,
    unsupportedEvents: events.unsupported,
    jobs,
    problems: jobProblems,
    compatibility: [
      ...compatibilityOf({ root, jobs, events, template }),
      ...jobs.flatMap((job): CompatibilityNote[] =>
        job.timeoutMinutes !== null && job.timeoutMinutes > limits.maxTimeoutMinutes
          ? [
              {
                feature: `jobs.${job.key}.timeout-minutes`,
                verdict: 'runs-differently',
                detail: `capped at ${limits.maxTimeoutMinutes} minutes`,
              },
            ]
          : [],
      ),
    ],
  };
}

function emptyWorkflow(
  path: string,
  name: string,
  problems: readonly WorkflowProblem[],
): WorkflowFile {
  return {
    path,
    name,
    triggers: [],
    unsupportedEvents: [],
    jobs: [],
    problems:
      problems.length > 0
        ? problems
        : [{ message: 'not a workflow file', line: null, column: null }],
    compatibility: [],
  };
}

function problemsOf(
  errors: readonly {
    readonly message: string;
    readonly range?:
      | { readonly start: { readonly line: number; readonly column: number } }
      | undefined;
  }[],
): WorkflowProblem[] {
  return errors.slice(0, 50).map((error) => ({
    message: error.message,
    line: error.range?.start.line ?? null,
    column: error.range?.start.column ?? null,
  }));
}

type Events = { readonly triggers: WorkflowTrigger[]; readonly unsupported: string[] };

function eventsOf(template: WorkflowTemplate): Events {
  const triggers: WorkflowTrigger[] = [];
  const unsupported: string[] = [];
  const { events } = template;
  for (const event of Object.keys(events))
    if (!SUPPORTED_EVENTS.has(event)) unsupported.push(event);
  const push = events.push;
  if (push !== undefined) {
    const isTagsOnly =
      (push.tags !== undefined || push['tags-ignore'] !== undefined) &&
      push.branches === undefined &&
      push['branches-ignore'] === undefined;
    if (isTagsOnly) unsupported.push('push (tags)');
    else
      triggers.push({
        kind: 'push',
        branches: push.branches ?? [],
        branchesIgnore: push['branches-ignore'] ?? [],
        paths: push.paths ?? [],
        pathsIgnore: push['paths-ignore'] ?? [],
      });
  }
  if (events.workflow_dispatch !== undefined)
    triggers.push({
      kind: 'workflow_dispatch',
      inputs: dispatchInputs(events.workflow_dispatch.inputs),
    });
  if (events.schedule !== undefined && events.schedule.length > 0)
    triggers.push({ kind: 'schedule', crons: events.schedule.map((entry) => entry.cron) });
  return { triggers, unsupported };
}

function dispatchInputs(
  inputs:
    | Readonly<
        Record<
          string,
          {
            type: string;
            description?: string;
            required?: boolean;
            default?: string | boolean | number;
            options?: string[];
          }
        >
      >
    | undefined,
): DispatchInputSpec[] {
  return Object.entries(inputs ?? {}).map(([name, input]) => ({
    name,
    description: input.description ?? null,
    type: inputType(input.type),
    required: input.required === true,
    default: input.default === undefined ? null : String(input.default),
    options: input.options ?? [],
  }));
}

function inputType(type: string): DispatchInputSpec['type'] {
  switch (type) {
    case 'boolean':
    case 'number':
    case 'choice':
    case 'environment':
      return type;
    default:
      return 'string';
  }
}

function jobsOf(
  template: WorkflowTemplate,
  root: Readonly<Record<string, PlainValue>>,
  limits: WorkflowLimits,
): JobPlan[] {
  const rawJobs = isPlainObject(root['jobs']) ? root['jobs'] : {};
  const workflowWrite = contentsWrite(root['permissions']) ?? false;
  return template.jobs.map((job) => {
    const key = job.id.value;
    const raw = rawJobs[key];
    const plain = isPlainObject(raw) ? raw : {};
    return {
      key,
      nameTemplate: typeof plain['name'] === 'string' ? plain['name'] : null,
      needs: (job.needs ?? []).map((need) => need.value),
      condition: job.if.expression,
      image: imageOf(plain['runs-on']),
      timeoutMinutes:
        typeof plain['timeout-minutes'] === 'number' ? plain['timeout-minutes'] : null,
      matrix: planMatrix(
        isPlainObject(plain['strategy']) ? plain['strategy']['matrix'] : undefined,
        limits.maxMatrixLegs,
      ),
      outputs: stringRecord(plain['outputs']),
      steps: stepsOf(plain['steps']),
      secretNames: secretNamesIn(JSON.stringify([plain, root['env'] ?? null])),
      contentsWrite: contentsWrite(plain['permissions']) ?? workflowWrite,
      idTokenWrite: idTokenWrite(plain['permissions'] ?? root['permissions']),
    };
  });
}

function imageOf(runsOn: PlainValue | undefined): string | null {
  const labels = stringsOf(runsOn);
  const [label] = labels;
  if (labels.length !== 1 || label === undefined) return null;
  return IMAGES[label] ?? null;
}

function contentsWrite(permissions: PlainValue | undefined): boolean | null {
  if (permissions === 'write-all') return true;
  if (permissions === 'read-all') return false;
  if (!isPlainObject(permissions)) return null;
  return permissions['contents'] === 'write';
}

function idTokenWrite(permissions: PlainValue | undefined): boolean {
  return (
    permissions === 'write-all' ||
    (isPlainObject(permissions) && permissions['id-token'] === 'write')
  );
}

function stringRecord(value: PlainValue | undefined): Readonly<Record<string, string>> {
  if (!isPlainObject(value)) return {};
  return Object.fromEntries(
    Object.entries(value).flatMap(([key, entry]) =>
      typeof entry === 'string' || typeof entry === 'number' || typeof entry === 'boolean'
        ? [[key, String(entry)]]
        : [],
    ),
  );
}

function stepsOf(value: PlainValue | undefined): JobStepSpec[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((step, index): JobStepSpec[] => {
    if (!isPlainObject(step)) return [];
    const uses = typeof step['uses'] === 'string' ? step['uses'] : null;
    const run = typeof step['run'] === 'string' ? step['run'] : null;
    const firstLine = run?.split('\n')[0] ?? '';
    const fallback = uses === null ? `Run ${firstLine}` : `Run ${uses}`;
    return [
      {
        number: index + 1,
        id: typeof step['id'] === 'string' ? step['id'] : null,
        name: typeof step['name'] === 'string' ? step['name'] : fallback,
        uses,
        run,
      },
    ];
  });
}

/** Upper-cased secret names a text refers to, without `GITHUB_TOKEN` (the job token). */
export function secretNamesIn(text: string): string[] {
  const names = new Set<string>();
  for (const match of text.matchAll(SECRET_REFERENCE)) {
    const name = (match[1] ?? match[2] ?? '').toUpperCase();
    if (name !== '' && name !== 'GITHUB_TOKEN') names.add(name);
  }
  return [...names].toSorted();
}

function compatibilityOf(input: {
  readonly root: Readonly<Record<string, PlainValue>>;
  readonly jobs: readonly JobPlan[];
  readonly events: Events;
  readonly template: WorkflowTemplate;
}): CompatibilityNote[] {
  const notes: CompatibilityNote[] = [];
  for (const event of input.events.unsupported) {
    notes.push(
      LATER_EVENTS.has(event) || event === 'push (tags)'
        ? {
            feature: `on: ${event}`,
            verdict: 'after-mvp',
            detail: 'parsed, but Beanstalk does not start runs for it yet',
          }
        : {
            feature: `on: ${event}`,
            verdict: 'never-runs',
            detail: 'Beanstalk has no such object',
          },
    );
  }
  for (const trigger of input.events.triggers) {
    if (trigger.kind === 'schedule')
      for (const cron of trigger.crons)
        if (parseCron(cron) === null)
          notes.push({
            feature: `schedule ${cron}`,
            verdict: 'never-runs',
            detail: 'not valid cron',
          });
    if (trigger.kind === 'push')
      notes.push({
        feature: 'on: push',
        verdict: 'runs-differently',
        detail: 'runs when the stalk moves; `main` and the base branch name the stalk',
      });
  }
  if (input.root['concurrency'] !== undefined)
    notes.push({
      feature: 'concurrency',
      verdict: 'runs-differently',
      detail: 'groups are not enforced yet; the repository runs at most 4 jobs at once',
    });
  const rawJobs = isPlainObject(input.root['jobs']) ? input.root['jobs'] : {};
  for (const job of input.jobs) notes.push(...jobNotes(job, rawJobs[job.key]));
  return notes;
}

function jobNotes(job: JobPlan, raw: PlainValue | undefined): CompatibilityNote[] {
  const plain = isPlainObject(raw) ? raw : {};
  const notes: CompatibilityNote[] = [];
  const at = (feature: string) => `jobs.${job.key}.${feature}`;
  if (typeof plain['uses'] === 'string')
    notes.push({
      feature: at('uses'),
      verdict: 'after-mvp',
      detail: 'reusable workflows are not run yet',
    });
  else if (job.image === null)
    notes.push({
      feature: at('runs-on'),
      verdict: 'never-runs',
      detail: 'only ubuntu-latest, ubuntu-24.04 and ubuntu-22.04 run here',
    });
  if (plain['container'] !== undefined || plain['services'] !== undefined)
    notes.push({
      feature: at(plain['container'] === undefined ? 'services' : 'container'),
      verdict: 'runs-differently',
      detail:
        'runs in Docker mode (dockerd inside the job container); never in host mode, where act would skip it',
    });
  if (plain['environment'] !== undefined)
    notes.push({
      feature: at('environment'),
      verdict: 'runs-differently',
      detail: 'environments and their approvals are ignored',
    });
  if (isPlainObject(plain['permissions']) && plain['permissions']['id-token'] === 'write')
    notes.push({
      feature: at('permissions.id-token'),
      verdict: 'never-runs',
      detail: 'OIDC comes later',
    });
  for (const step of job.steps)
    if (step.uses?.startsWith('docker://') === true)
      notes.push({
        feature: at(`steps[${step.number}]`),
        verdict: 'runs-differently',
        detail: 'Docker actions run in Docker mode (dockerd inside the job container)',
      });
  if (job.matrix.kind === 'invalid')
    notes.push({
      feature: at('strategy.matrix'),
      verdict: 'never-runs',
      detail: job.matrix.reason,
    });
  return notes;
}
