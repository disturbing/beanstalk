/**
 * From the runner's lines and result to the control plane's: log lines keyed by step number
 * (GitHub's `##[group]`, `##[error]` markers for groups and annotations), step views built
 * from act's step starts and ends, and the job's conclusion in GitHub's vocabulary.
 */
import type { JobConclusion, JobStepSpec, LogLine, StepView } from '../contract';
import type { RunnerLine, RunnerResult } from './runner-wire';

/** The sink's limit on one line. */
const MAX_LINE_CHARS = 64 * 1024;

/** Tracks the job's steps as their lines go by. */
export class StepTracker {
  readonly #specSteps: readonly JobStepSpec[];
  readonly #steps = new Map<number, StepView>();

  constructor(specSteps: readonly JobStepSpec[], known: readonly StepView[] = []) {
    this.#specSteps = specSteps;
    for (const step of known) this.#steps.set(step.number, step);
  }

  /** The lines in the control plane's shape, and the steps they changed. */
  translate(lines: readonly RunnerLine[]): {
    readonly lines: LogLine[];
    readonly changed: StepView[];
  } {
    const changed = new Map<number, StepView>();
    const out: LogLine[] = [];
    for (const line of lines) {
      const number = this.stepNumber(line.stepId);
      const update = number === null ? null : this.#update(number, line);
      if (update !== null) changed.set(update.number, update);
      const text = textOf(line);
      if (text !== null) out.push({ step: number, at: isoOf(line.at), text: clip(text) });
    }
    return { lines: out, changed: [...changed.values()] };
  }

  /** Every step seen, in order. */
  steps(): StepView[] {
    return [...this.#steps.values()].toSorted((a, b) => a.number - b.number);
  }

  /** Marks steps still running as ended with the job (a cancel, a timeout, a lost container). */
  closeOpenSteps(conclusion: JobConclusion, atMs: number): StepView[] {
    const closed: StepView[] = [];
    for (const step of this.#steps.values()) {
      if (step.status === 'completed') continue;
      const done: StepView = {
        ...step,
        status: 'completed',
        conclusion: conclusion === 'success' ? 'success' : conclusion,
        completedAt: isoOf(atMs),
      };
      this.#steps.set(step.number, done);
      closed.push(done);
    }
    return closed;
  }

  /**
   * act's step id (the step's `id:`, or its index from 0 when it has none; `--setup-job` and
   * `--complete-job` are the job's own) to the workflow's step number (from 1).
   */
  stepNumber(stepId: string | undefined): number | null {
    if (stepId === undefined || stepId.startsWith('--')) return null;
    const outer = stepId.split('/')[0] ?? stepId;
    const byId = this.#specSteps.find((step) => step.id === outer);
    if (byId !== undefined) return byId.number;
    if (!/^\d+$/.test(outer)) return null;
    const index = Number(outer);
    return this.#specSteps[index]?.number ?? index + 1;
  }

  #update(number: number, line: RunnerLine): StepView | null {
    if (line.stage !== 'Main') return null;
    const name = this.#specSteps.find((step) => step.number === number)?.name ?? line.step ?? '';
    const known = this.#steps.get(number);
    if (line.kind === 'step-start') {
      const started: StepView = {
        number,
        name,
        status: 'in_progress',
        conclusion: null,
        startedAt: isoOf(line.at),
        completedAt: null,
      };
      this.#steps.set(number, started);
      return started;
    }
    if (line.kind !== 'step-end') return null;
    const ended: StepView = {
      number,
      name,
      status: 'completed',
      conclusion: stepConclusion(line.result),
      startedAt: known?.startedAt ?? isoOf(line.at - (line.durationMs ?? 0)),
      completedAt: isoOf(line.at),
    };
    this.#steps.set(number, ended);
    return ended;
  }
}

/** The job's conclusion from the runner's, in the control plane's vocabulary. */
export function jobConclusion(result: RunnerResult): JobConclusion {
  switch (result.reason) {
    case 'timeout':
      return 'timed_out';
    case 'cancelled':
      return 'cancelled';
    case 'runner':
      return 'infrastructure_failure';
    case 'steps':
    case 'workflow':
    case 'unsupported':
      return 'failure';
    case undefined:
      return result.conclusion === 'failure' ? 'failure' : 'success';
  }
}

/**
 * Minutes as GitHub bills them: per job, rounded up, at least one. Measured from the container
 * start request to the verified destroy, so a cold start is billed like GitHub's runner setup.
 */
export function minutesBilled(containerMs: number): number {
  return Math.max(1, Math.ceil(containerMs / 60_000));
}

function textOf(line: RunnerLine): string | null {
  switch (line.kind) {
    case 'output':
    case 'runner':
      return line.text;
    case 'step-start':
      return line.text.replace(/^Run Main /, 'Run ');
    case 'step-end':
      return line.text.replace(/ - Main /, ' - ');
    case 'group-start':
      return `##[group]${line.text}`;
    case 'group-end':
      return '##[endgroup]';
    case 'annotation':
      return annotationText(line);
    case 'summary':
      return line.text.trimEnd() === '' ? null : `##[summary]${line.text.trimEnd()}`;
    case 'debug':
      return null;
    default:
      return line.text;
  }
}

function annotationText(line: RunnerLine): string {
  const annotation = line.annotation;
  const level = annotation?.level ?? line.level;
  const where =
    annotation?.file === undefined
      ? ''
      : `${annotation.file}${annotation.line === undefined ? '' : `:${annotation.line}`}: `;
  const title = annotation?.title === undefined ? '' : `${annotation.title}: `;
  return `##[${level}]${where}${title}${annotation?.message ?? line.text}`;
}

function stepConclusion(result: string | undefined): StepView['conclusion'] {
  if (result === 'success' || result === 'skipped' || result === 'cancelled') return result;
  return 'failure';
}

function isoOf(ms: number): string {
  return new Date(ms).toISOString();
}

function clip(text: string): string {
  return text.length > MAX_LINE_CHARS ? `${text.slice(0, MAX_LINE_CHARS - 1)}…` : text;
}
