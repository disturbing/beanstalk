/**
 * A job's log as the run page shows it: lines grouped under their steps, workflow commands
 * (`::error file=…,line=…::message`) read as annotations, search over the text without its
 * colours, and the plain-text download.
 */
import type { LogLine, Step } from './actions-contract';
import { stripAnsi } from './ansi';

export type StepLog = { readonly step: Step; readonly lines: readonly LogLine[] };

/** Every step with its lines, in step order (a step with no lines yet has none). */
export function groupByStep(steps: readonly Step[], lines: readonly LogLine[]): readonly StepLog[] {
  const byStep = new Map<number, LogLine[]>();
  for (const line of lines) {
    const list = byStep.get(line.step) ?? [];
    list.push(line);
    byStep.set(line.step, list);
  }
  return steps.map((step) => ({ step, lines: byStep.get(step.number) ?? [] }));
}

/** New lines appended to what a viewer has, by line number (a resent line is ignored). */
export function appendLines(
  current: readonly LogLine[],
  incoming: readonly LogLine[],
): readonly LogLine[] {
  const last = current.at(-1)?.n ?? 0;
  const fresh = incoming.filter((line) => line.n > last);
  return fresh.length === 0 ? current : [...current, ...fresh];
}

export type WorkflowCommand = {
  readonly level: 'error' | 'warning' | 'notice';
  readonly message: string;
  readonly path: string | null;
  readonly line: number | null;
};

/** A `::error …::` line as an annotation; null for any other line. */
export function workflowCommand(text: string): WorkflowCommand | null {
  const match = /^::(error|warning|notice)(?:\s+([^:]*))?::(.*)$/.exec(stripAnsi(text).trim());
  if (match === null) return null;
  const level = match[1] === 'error' || match[1] === 'warning' ? match[1] : 'notice';
  const props = new Map<string, string>();
  for (const pair of (match[2] ?? '').split(',')) {
    const equals = pair.indexOf('=');
    if (equals > 0) props.set(pair.slice(0, equals).trim(), pair.slice(equals + 1).trim());
  }
  const line = Number(props.get('line'));
  return {
    level,
    message: match[3] ?? '',
    path: props.get('file') ?? null,
    line: Number.isInteger(line) && line > 0 ? line : null,
  };
}

/** Line numbers whose text (without colours) contains the query, case-insensitively. */
export function searchLines(lines: readonly LogLine[], query: string): readonly number[] {
  const needle = query.trim().toLowerCase();
  if (needle === '') return [];
  return lines
    .filter((line) => stripAnsi(line.text).toLowerCase().includes(needle))
    .map((line) => line.n);
}

/** The whole log as plain text, each step under a `##[group]` line as GitHub's raw log has. */
export function plainLog(steps: readonly Step[], lines: readonly LogLine[]): string {
  return groupByStep(steps, lines)
    .filter((group) => group.lines.length > 0)
    .map(
      (group) =>
        `##[group]${group.step.name}\n${group.lines.map((line) => stripAnsi(line.text)).join('\n')}\n##[endgroup]`,
    )
    .join('\n');
}
