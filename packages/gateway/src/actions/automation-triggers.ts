/**
 * Which automations a repository event starts (doc 25 §7.2). Each `repo-events` event maps to
 * one Beanstalk event name; an automation fires when its `on:` names that event and its
 * `beans:` and `authors:` filters (GitHub's glob rules) select the event's bean and pusher. An
 * automation never fires on its own beans, so a fix it pushes cannot loop back into it.
 */
import type { BeanstalkEvent, WorkflowTrigger } from '@gitstalk/shared-race/actions';
import type { RepoEvent } from '@gitstalk/shared-race/repo-events';

import { assertNever } from '../engine/errors';
import type { RepoFacts } from './event-payload';
import { repositoryPayload } from './event-payload';
import { selectedBy } from './filter-pattern';

/** A repository event as automations see it. */
export type Occurrence = {
  readonly event: BeanstalkEvent;
  readonly seq: number;
  readonly at: string;
  /** The bean it is about, when there is one. */
  readonly bean: string | null;
  /** Who pushed that bean (or answered the card), when known. */
  readonly actor: string | null;
  /** The commit it names (a landing, a stalk head, a red sprout), when there is one. */
  readonly sha: string | null;
  /** The event as the engine sent it, for the run's payload. */
  readonly detail: RepoEvent;
};

/** The Beanstalk event a repository event is, with its bean, actor and commit. */
export function occurrenceOf(event: RepoEvent): Occurrence {
  const base = { seq: event.seq, at: event.at, detail: event };
  switch (event.kind) {
    case 'bean.opened':
      return { ...base, event: 'bean_opened', bean: event.bean, actor: event.actor, sha: null };
    case 'bean.landed':
      return {
        ...base,
        event: 'bean_landed',
        bean: event.bean,
        actor: event.actor,
        sha: event.sha,
      };
    case 'bean.rework':
      return { ...base, event: 'bean_red', bean: event.bean, actor: null, sha: null };
    case 'bean.ended':
      return {
        ...base,
        event: event.outcome === 'parked' ? 'bean_parked' : 'bean_dropped',
        bean: event.bean,
        actor: null,
        sha: null,
      };
    case 'bean.reverted':
      return { ...base, event: 'bean_reverted', bean: event.bean, actor: null, sha: event.sha };
    case 'stalk.promoted':
      return { ...base, event: 'stalk_moved', bean: null, actor: null, sha: event.sha };
    case 'stalk.demoted':
      return { ...base, event: 'stalk_reset', bean: null, actor: null, sha: event.sha };
    case 'sprout.red':
      return { ...base, event: 'validation_red', bean: null, actor: null, sha: event.sha };
    case 'decision.asked':
      return { ...base, event: 'decision_opened', bean: event.bean, actor: null, sha: null };
    case 'decision.made':
      return {
        ...base,
        event: 'decision_decided',
        bean: event.winner,
        actor: event.by.startsWith('human:') ? event.by.slice('human:'.length) : null,
        sha: null,
      };
    default:
      return assertNever(event);
  }
}

/** Whether an automation with `triggers`, acting as `actor`, fires for `occurrence`. */
export function automationFires(
  triggers: readonly WorkflowTrigger[],
  occurrence: Occurrence,
  actor: string,
): boolean {
  if (occurrence.actor === actor) return false;
  return triggers.some(
    (trigger) =>
      trigger.kind === 'beanstalk' &&
      trigger.event === occurrence.event &&
      (trigger.beans.length === 0 ||
        (occurrence.bean !== null && selectedBy(trigger.beans, occurrence.bean))) &&
      (trigger.authors.length === 0 ||
        (occurrence.actor !== null && selectedBy(trigger.authors, occurrence.actor))),
  );
}

/**
 * The run's event payload (`$GITHUB_EVENT_PATH`): the Beanstalk event, its bean, actor and
 * commit, and the repository in GitHub's shape. All of it is untrusted data (doc 25 §7.6).
 */
export function occurrencePayload(input: {
  readonly repo: RepoFacts;
  readonly publicUrl: string;
  readonly occurrence: Occurrence;
}): Readonly<Record<string, unknown>> {
  const { repo, occurrence } = input;
  const detail = Object.fromEntries(
    Object.entries(occurrence.detail).filter(([key]) => key !== 'seq'),
  );
  return {
    action: occurrence.event,
    beanstalk: {
      event: occurrence.event,
      at: occurrence.at,
      bean: occurrence.bean,
      bean_ref: occurrence.bean === null ? null : `refs/heads/bean/${occurrence.bean}`,
      actor: occurrence.actor,
      sha: occurrence.sha,
      detail,
    },
    repository: repositoryPayload(repo, input.publicUrl),
    sender: { login: occurrence.actor ?? 'beanstalk' },
  };
}
