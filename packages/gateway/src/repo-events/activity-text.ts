/**
 * The activity line a repository event becomes: its kind, a sentence for a person, and the
 * bean and commit it names. Home and the Stalk tab print these as they are.
 */
import type { ActivityKind } from '@beanstalk/shared-race/repos';
import type { RepoEvent } from '@beanstalk/shared-race/repo-events';

import { assertNever } from '../engine/errors';

export type ActivityLine = {
  readonly kind: ActivityKind;
  readonly text: string;
  readonly bean: string | null;
  readonly sha: string | null;
};

/** Beans named in one line before "and N more". */
const NAMED = 3;

export function activityLine(event: RepoEvent): ActivityLine {
  switch (event.kind) {
    case 'bean.opened':
      return {
        kind: 'opened',
        text: `${by(event.actor)}pushed bean ${event.bean}${event.title === '' ? '' : `: ${event.title}`}.`,
        bean: event.bean,
        sha: null,
      };
    case 'bean.landed':
      return {
        kind: 'landed',
        text: `${event.bean} landed on the sprout at ${short(event.sha)}, green on the merged tree (${plural(event.files, 'file')}).`,
        bean: event.bean,
        sha: event.sha,
      };
    case 'bean.rework':
      return {
        kind: 'rework',
        text: `${event.bean} went back to its author${event.reason === '' ? '' : `: ${event.reason}`}.`,
        bean: event.bean,
        sha: null,
      };
    case 'bean.ended':
      return endedLine(event);
    case 'bean.reverted':
      return {
        kind: 'reverted',
        text: `${event.bean ?? short(event.reverted)} was taken off the sprout (revert ${short(event.sha)}) after a red validation.`,
        bean: event.bean,
        sha: event.sha,
      };
    case 'stalk.promoted':
      return {
        kind: 'promoted',
        text: `The stalk moved to ${short(event.sha)}: ${beanList(event.beans)} validated.`,
        bean: event.beans.length === 1 ? (event.beans[0] ?? null) : null,
        sha: event.sha,
      };
    case 'stalk.demoted':
      return {
        kind: 'demoted',
        text: `The stalk went back to ${short(event.sha)}: an audit found ${plural(event.failing.length, 'failing test')}; ${beanList(event.beans)} land again.`,
        bean: null,
        sha: event.sha,
      };
    case 'sprout.red':
      return {
        kind: 'red',
        text: `Validation of the sprout at ${short(event.sha)} went red (${plural(event.failing.length, 'failing test')}).`,
        bean: null,
        sha: event.sha,
      };
    case 'decision.asked':
      return {
        kind: 'decision',
        text: `A decision is waiting: ${event.bean} against ${beanList(event.against)}.`,
        bean: event.bean,
        sha: null,
      };
    case 'decision.made':
      return {
        kind: 'decided',
        text: `Decided: ${event.winner} over ${event.loser}, ${deciderOf(event.by)}.`,
        bean: event.winner,
        sha: null,
      };
    default:
      return assertNever(event);
  }
}

/** The UTC day (`YYYY-MM-DD`) of an ISO time. */
export function dayOf(at: string): string {
  return at.slice(0, 10);
}

function endedLine(event: Extract<RepoEvent, { kind: 'bean.ended' }>): ActivityLine {
  const why = event.reason === '' ? '' : `: ${event.reason}`;
  return event.outcome === 'dropped'
    ? { kind: 'dropped', text: `${event.bean} fell off${why}.`, bean: event.bean, sha: null }
    : {
        kind: 'parked',
        text: `${event.bean} is waiting for a person${why}.`,
        bean: event.bean,
        sha: null,
      };
}

function by(actor: string | null): string {
  return actor === null ? 'Someone ' : `@${actor} `;
}

function deciderOf(oracle: string): string {
  if (oracle.startsWith('human:')) return `by @${oracle.slice('human:'.length)}`;
  if (oracle.startsWith('timeout:')) return 'by the rule after nobody answered';
  return 'by the rule';
}

function beanList(beans: readonly string[]): string {
  if (beans.length === 0) return 'no beans';
  const named = beans.slice(0, NAMED).join(', ');
  return beans.length <= NAMED ? named : `${named} and ${beans.length - NAMED} more`;
}

function plural(count: number, noun: string): string {
  return `${count} ${noun}${count === 1 ? '' : 's'}`;
}

function short(sha: string): string {
  return sha.slice(0, 7);
}
