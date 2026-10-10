/**
 * The `remote:` lines of a push to `refs/wait/any|all`: which beans it waits for, each verdict
 * as it arrives (the same lines `-o wait` prints), where every bean stands at the end, and what
 * to do next.
 */
import type { WaitMode, WatchedBean } from './bean-wait';
import { isActionable, isChecking } from './bean-wait';
import { REMOTE_PREFIX as P, waitCommand } from './push-messages';

export function waitHeaderLines(
  mode: WaitMode,
  beans: readonly WatchedBean[],
  unknown: readonly string[],
): string[] {
  const lines = unknown.map((name) => `${P} no pushed bean named ${name}; not waiting for it`);
  if (beans.length === 0)
    return [...lines, `${P} nothing to wait for: no bean of yours is in flight`];
  const what = mode === 'any' ? 'the first verdict' : 'every verdict';
  return [...lines, `${P} waiting for ${what} of ${standings(beans)}`];
}

/** A bean that already waits for its author's push when the wait starts. */
export function actionableLines(bean: WatchedBean): string[] {
  return [`${P} ${bean.bean} is ${bean.phase} and waits for your push:`, ...(bean.verdict ?? [])];
}

/** A verdict that arrived during the wait. */
export function arrivedLines(bean: WatchedBean): string[] {
  return [
    `${P} verdict for ${bean.bean}: ${bean.verdictPhase ?? bean.phase}`,
    ...(bean.verdict ?? []),
  ];
}

export function keepaliveLine(waitedMs: number, beans: readonly WatchedBean[]): string {
  const checking = beans.filter((bean) => isChecking(bean.phase)).map((bean) => bean.bean);
  return `${P} still waiting (${seconds(waitedMs)} s): ${checking.join(', ')} checking`;
}

/** Where the beans stand when the wait ends, and the next step. */
export function waitEndLines(
  mode: WaitMode,
  beans: readonly WatchedBean[],
  timedOutMs: number | null,
): string[] {
  if (beans.length === 0) return [];
  const checking = beans.filter((bean) => isChecking(bean.phase)).map((bean) => bean.bean);
  const actionable = beans.filter((bean) => isActionable(bean.phase)).map((bean) => bean.bean);
  const lines = [`${P} your beans: ${standings(beans)}`];
  if (timedOutMs !== null)
    lines.push(
      `${P} no verdict after ${seconds(timedOutMs)} s; ${checking.join(', ')} still checking`,
    );
  if (actionable.length > 0)
    lines.push(
      `${P}   next: fix ${actionable.join(', ')} (rebase on origin/sprout, fix, git push -f to the bean)`,
    );
  if (checking.length > 0)
    lines.push(`${P}   then take your next task, or wait again: ${waitCommand(checking, mode)}`);
  return lines;
}

function standings(beans: readonly WatchedBean[]): string {
  return beans.map((bean) => `${bean.bean} (${bean.phase})`).join(', ');
}

function seconds(ms: number): number {
  return Math.round(ms / 1000);
}
