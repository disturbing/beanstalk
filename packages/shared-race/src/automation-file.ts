/**
 * An automation file (doc 25 §7.1): `.beanstalk/automations/<id>.yml` (or `.md` with YAML front
 * matter, the body being the prompt). It names the triggers (Beanstalk events, `schedule`,
 * `workflow_dispatch`), the harness that runs the agent, its prompt, its permissions and the
 * secrets it may use. Pure: problems are in the answer, with a line when one is known.
 */
import type { AutomationInfo, BeanstalkEvent, WorkflowProblem, WorkflowTrigger } from './actions';
import { BEANSTALK_EVENTS, SecretName, automationIdOf } from './actions';
import { LineCounter, isMap, isNode, parseDocument } from 'yaml';
import type { Document } from 'yaml';
import { z } from 'zod';

import { DEFAULT_AUTOMATION_MODEL, isAutomationModel } from './automation-models';
import { parseCron } from './cron';

/** What an automation may run for at most, and by default (minutes). */
export type AutomationLimits = { readonly maxTimeoutMinutes: number };

export const DEFAULT_TIMEOUT_MINUTES = 30;
export const DEFAULT_MAX_TURNS = 40;
export const DEFAULT_MAX_COST_USD = 0.5;
/** A run's model spend may not be set higher than this (USD). */
export const MAX_COST_USD = 5;

export type AutomationFile = {
  readonly path: string;
  readonly name: string;
  /** Null when the file has problems. */
  readonly info: AutomationInfo | null;
  readonly triggers: readonly WorkflowTrigger[];
  readonly problems: readonly WorkflowProblem[];
  /** Things that run, but not as written (a timeout capped). */
  readonly notes: readonly string[];
};

const Globs = z.array(z.string().min(1).max(200)).max(50);
const EventFilter = z.strictObject({ beans: Globs.optional(), authors: Globs.optional() });
const KNOWN_KEYS = [
  'name',
  'on',
  'harness',
  'model',
  'prompt',
  'run',
  'permissions',
  'secrets',
  'timeout-minutes',
  'max-turns',
  'max-cost-usd',
  'memory',
] as const;

const Body = z.strictObject({
  name: z.string().min(1).max(200).optional(),
  on: z.unknown(),
  harness: z.enum(['agent', 'shell']).default('agent'),
  model: z
    .string()
    .refine(isAutomationModel, 'not a model automations may use (doc 25 §7.5 lists them)')
    .optional(),
  prompt: z.string().min(1).max(32_000).optional(),
  run: z.string().min(1).max(32_000).optional(),
  permissions: z
    .strictObject({ beans: z.enum(['read', 'write']).default('read') })
    .default({ beans: 'read' }),
  secrets: z.array(SecretName).max(20).default([]),
  'timeout-minutes': z.number().int().min(1).max(1440).default(DEFAULT_TIMEOUT_MINUTES),
  'max-turns': z.number().int().min(1).max(500).default(DEFAULT_MAX_TURNS),
  'max-cost-usd': z.number().positive().max(MAX_COST_USD).default(DEFAULT_MAX_COST_USD),
  memory: z.boolean().default(true),
});

/** Reads one automation file. Never throws. */
export function readAutomationFile(
  path: string,
  source: string,
  limits: AutomationLimits,
): AutomationFile {
  const id = automationIdOf(path);
  const fallbackName = id;
  const split = path.endsWith('.md') ? splitFrontMatter(source) : { yaml: source, body: null };
  if (split === null)
    return invalid(path, fallbackName, [problem('a .md automation starts with --- front matter')]);
  const counter = new LineCounter();
  const document = parseDocument(split.yaml, { lineCounter: counter, prettyErrors: false });
  const syntax = document.errors.map((error) =>
    problem(error.message.split('\n')[0] ?? error.message, counter.linePos(error.pos[0])),
  );
  if (syntax.length > 0) return invalid(path, fallbackName, syntax);
  const raw: unknown = document.toJS();
  const withBody =
    split.body === null || !isRecord(raw) ? raw : { ...raw, prompt: raw['prompt'] ?? split.body };
  const parsed = Body.safeParse(withBody);
  if (!parsed.success)
    return invalid(path, fallbackName, issuesOf(parsed.error, document, counter));
  const body = parsed.data;
  const name = body.name ?? fallbackName;
  const triggers = triggersOf(body.on);
  const problems = [...triggers.problems, ...harnessProblems(body)].map((message) =>
    problem(message, lineOfKey(document, counter, message.split(':')[0] ?? '')),
  );
  if (problems.length > 0) return invalid(path, name, problems);
  const timeoutMinutes = Math.min(body['timeout-minutes'], limits.maxTimeoutMinutes);
  return {
    path,
    name,
    triggers: triggers.triggers,
    problems: [],
    notes:
      timeoutMinutes < body['timeout-minutes']
        ? [`timeout-minutes is capped at ${limits.maxTimeoutMinutes}`]
        : [],
    info: {
      id,
      harness: body.harness,
      model: body.harness === 'shell' ? null : (body.model ?? DEFAULT_AUTOMATION_MODEL),
      prompt: (body.harness === 'shell' ? body.run : body.prompt) ?? '',
      permissions: { beans: body.permissions.beans },
      secrets: [...new Set(body.secrets)].toSorted(),
      timeoutMinutes,
      maxTurns: body['max-turns'],
      maxCostUsd: body['max-cost-usd'],
      memoryRef: body.memory ? memoryRefOf(id) : null,
      actor: automationActor(id),
    },
  };
}

/** The ref an automation's memory is kept at (doc 25 §7.3). */
export function memoryRefOf(id: string): string {
  return `refs/automations/${id}/memory`;
}

/** Who an automation acts as: its pushes, beans and memory commits name it. */
export function automationActor(id: string): string {
  return `${id}[automation]`;
}

// Triggers ----------------------------------------------------------------------------------

type Triggers = { readonly triggers: WorkflowTrigger[]; readonly problems: string[] };

function triggersOf(on: unknown): Triggers {
  const entries = onEntries(on);
  if (entries === null)
    return { triggers: [], problems: ['on: name at least one trigger (an event, schedule)'] };
  const triggers: WorkflowTrigger[] = [];
  const problems: string[] = [];
  for (const [event, value] of entries) {
    const read = triggerOf(event, value);
    if (typeof read === 'string') problems.push(`on: ${read}`);
    else triggers.push(read);
  }
  if (!triggers.some((trigger) => trigger.kind === 'workflow_dispatch'))
    triggers.push({ kind: 'workflow_dispatch', inputs: [] });
  return { triggers, problems };
}

/** `on:` as `[event, value]` pairs: a name, a list of names, or a mapping. */
function onEntries(on: unknown): [string, unknown][] | null {
  if (typeof on === 'string') return [[on, null]];
  if (Array.isArray(on) && on.every((item) => typeof item === 'string'))
    return on.length === 0 ? null : on.map((item: string): [string, unknown] => [item, null]);
  if (isRecord(on)) {
    const entries = Object.entries(on);
    return entries.length === 0 ? null : entries;
  }
  return null;
}

function triggerOf(event: string, value: unknown): WorkflowTrigger | string {
  if (event === 'workflow_dispatch') return { kind: 'workflow_dispatch', inputs: [] };
  if (event === 'schedule') return scheduleOf(value);
  const beanstalk = BEANSTALK_EVENTS.find((known) => known === event);
  if (beanstalk === undefined)
    return `${event} is not an automation trigger (use ${BEANSTALK_EVENTS.join(', ')}, schedule or workflow_dispatch)`;
  const filter = EventFilter.safeParse(value ?? {});
  if (!filter.success) return `${event} takes only beans: and authors: filters`;
  const onlyNegated = [filter.data.beans, filter.data.authors].some(
    (globs) => globs !== undefined && globs.every((glob) => glob.startsWith('!')),
  );
  if (onlyNegated)
    return `${event}: a filter of only ! patterns matches nothing; start it with '*'`;
  return beanstalkTrigger(beanstalk, filter.data);
}

function beanstalkTrigger(
  event: BeanstalkEvent,
  filter: z.infer<typeof EventFilter>,
): WorkflowTrigger {
  return { kind: 'beanstalk', event, beans: filter.beans ?? [], authors: filter.authors ?? [] };
}

function scheduleOf(value: unknown): WorkflowTrigger | string {
  const parsed = z
    .array(z.strictObject({ cron: z.string().min(1).max(100) }))
    .min(1)
    .max(10)
    .safeParse(value);
  if (!parsed.success) return 'schedule is a list of { cron: "…" }';
  const bad = parsed.data.find((entry) => parseCron(entry.cron) === null);
  if (bad !== undefined) return `schedule ${bad.cron} is not valid 5-field UTC cron`;
  return { kind: 'schedule', crons: parsed.data.map((entry) => entry.cron) };
}

// Harness -----------------------------------------------------------------------------------

function harnessProblems(body: z.infer<typeof Body>): string[] {
  if (body.harness === 'shell')
    return body.run === undefined ? ['run: a shell automation needs a run: script'] : [];
  const problems: string[] = [];
  if (body.prompt === undefined) problems.push('prompt: an agent automation needs a prompt');
  if (body.run !== undefined) problems.push('run: only harness: shell takes a run: script');
  return problems;
}

// Problems ----------------------------------------------------------------------------------

function invalid(path: string, name: string, problems: readonly WorkflowProblem[]): AutomationFile {
  return { path, name, info: null, triggers: [], problems, notes: [] };
}

function problem(
  message: string,
  at?: { readonly line: number; readonly col: number } | null,
): WorkflowProblem {
  return { message, line: at?.line ?? null, column: at?.col ?? null };
}

function issuesOf(error: z.ZodError, document: Document, counter: LineCounter): WorkflowProblem[] {
  return error.issues.slice(0, 20).map((issue) => {
    const key = issue.path.map(String).join('.');
    const unknown =
      issue.code === 'unrecognized_keys'
        ? `unknown key ${issue.keys.join(', ')} (known: ${KNOWN_KEYS.join(', ')})`
        : null;
    const message = `${key === '' ? '' : `${key}: `}${unknown ?? issue.message}`;
    const first = issue.code === 'unrecognized_keys' ? issue.keys[0] : issue.path[0];
    return problem(message, lineOfKey(document, counter, String(first ?? '')));
  });
}

/** The line and column of a top-level key, when the document has it. */
function lineOfKey(
  document: Document,
  counter: LineCounter,
  key: string,
): { readonly line: number; readonly col: number } | null {
  const { contents } = document;
  if (!isMap(contents)) return null;
  const pair = contents.items.find((item) => isNode(item.key) && String(item.key) === key);
  const range = pair !== undefined && isNode(pair.key) ? pair.key.range : undefined;
  return range === undefined || range === null ? null : counter.linePos(range[0]);
}

/** `---\n<yaml>\n---\n<body>`: the front matter and the body; null without front matter. */
function splitFrontMatter(
  source: string,
): { readonly yaml: string; readonly body: string | null } | null {
  const match = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?([\s\S]*)$/.exec(source);
  if (match === null) return null;
  const body = (match[2] ?? '').trim();
  return { yaml: match[1] ?? '', body: body === '' ? null : body };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
