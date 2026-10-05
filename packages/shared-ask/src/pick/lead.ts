/**
 * The Plot's headline and its suggested questions. Code computes every fact and its
 * sentence from the race state; the picker only orders which facts lead
 * (`docs/claude-opus/14` §5, decisions `lead` and `suggest`).
 */
import type { TaskId } from '@beanstalk/shared-race/ids';

import { isInFlight } from '../race/race-counters';
import type { RaceState } from '../race/race-state';
import { bedOf } from '../home/areas';
import type { PickCandidate, PickDecision } from './picker';

export type LeadFactId =
  | 'growth'
  | 'swarm'
  | 'red'
  | 'red-history'
  | 'decision-open'
  | 'decision'
  | 'drops'
  | 'pending';

/** Where a lead fact's link goes: a question to ask, or a bean to follow. */
export type LeadAction =
  | { readonly kind: 'ask'; readonly label: string; readonly question: string }
  | { readonly kind: 'bean'; readonly label: string; readonly bean: TaskId };

export type LeadFact = PickCandidate & {
  readonly id: LeadFactId;
  readonly sentence: string;
  readonly action: LeadAction | null;
};

export type Suggestion = PickCandidate & { readonly question: string };

/** Lead facts in the rule's order of importance, for a live run and for a finished one. */
const LIVE_ORDER: readonly LeadFactId[] = [
  'red',
  'decision-open',
  'swarm',
  'pending',
  'growth',
  'drops',
  'decision',
  'red-history',
];
const DONE_ORDER: readonly LeadFactId[] = [
  'growth',
  'decision-open',
  'decision',
  'drops',
  'red-history',
  'red',
];

/** Every lead fact the state supports at `now`, each with its computed sentence. */
export function leadFacts(state: RaceState, now: number): readonly LeadFact[] {
  return [
    growthFact(state, now),
    swarmFact(state),
    ...redFacts(state, now),
    decisionFact(state),
    dropsFact(state),
    pendingFact(state, now),
  ].filter((fact): fact is LeadFact => fact !== null);
}

/** Identifies a set of lead facts, so a pick is asked for once per set. */
export function leadKey(facts: readonly LeadFact[], finished: boolean): string {
  return `${finished ? 'done' : 'live'}:${facts.map((fact) => fact.id).join(',')}`;
}

export function isFinished(state: RaceState, now: number): boolean {
  return state.endedAt !== null && now >= state.endedAt;
}

export function leadDecision(facts: readonly LeadFact[], finished: boolean): PickDecision {
  const order = finished ? DONE_ORDER : LIVE_ORDER;
  return {
    id: 'lead',
    title: 'Lead the page',
    ask: 'A person opens this repository. Which fact should they read first?',
    state: { run: finished ? 'finished' : 'running' },
    candidates: facts.map(({ id, description, label }) => ({ id, description, label })),
    slots: 3,
    rule: () => ({
      chosen: order.filter((id) => facts.some((fact) => fact.id === id)),
      why: finished
        ? 'Rule: a finished run leads with how far it grew, then decisions, then what fell off.'
        : 'Rule: a running race leads with anything red, then waiting decisions, then the swarm.',
    }),
  };
}

/** Questions worth asking now, filled with this run's own areas, files and agents. */
export function suggestions(state: RaceState, now: number): readonly Suggestion[] {
  const inFlight = Object.values(state.beans).filter((bean) => isInFlight(bean.phase));
  const busiest = busiestBed(state);
  const hasRed = state.ci.some((run) => run.purpose === 'validate' && run.green === false);
  const candidates: (Suggestion | null)[] = [
    busiest === null
      ? null
      : suggestion(
          'area',
          `what changed recently in ${busiest}?`,
          'recent changes in the busiest area',
        ),
    inFlight.length > 0
      ? suggestion('swarm', "what's being worked on right now?", 'where agents are working now')
      : null,
    hasRed
      ? suggestion('red', 'why did the sprout go red?', 'the red validation and its culprit')
      : null,
    state.cards.length > 0
      ? suggestion('decision', 'what did we decide?', 'decisions between specs that disagreed')
      : null,
    unpromoted(state, now) > 0
      ? suggestion('pending', "what's on sprout but not on stalk?", 'beans waiting for validation')
      : null,
    busiestAgent(state) === null
      ? null
      : suggestion('agent', `what has ${busiestAgent(state)} done?`, "one agent's work"),
  ];
  return candidates.filter((item): item is Suggestion => item !== null);
}

export function suggestDecision(items: readonly Suggestion[], live: boolean): PickDecision {
  const order = live
    ? ['swarm', 'red', 'pending', 'decision', 'area', 'agent']
    : ['area', 'decision', 'red', 'agent', 'swarm', 'pending'];
  return {
    id: 'suggest',
    title: 'Suggest questions',
    ask: 'Which question would help most to understand this repository right now?',
    state: { run: live ? 'running' : 'finished' },
    candidates: items.map(({ id, description, label }) => ({ id, description, label })),
    slots: 4,
    rule: () => ({
      chosen: order.filter((id) => items.some((item) => item.id === id)),
      why: live
        ? 'Rule: a running race suggests what is happening now.'
        : 'Rule: a finished run suggests what happened, by area first.',
    }),
  };
}

function suggestion(id: string, question: string, description: string): Suggestion {
  return { id, question, description, label: question };
}

function growthFact(state: RaceState, now: number): LeadFact {
  const total = state.meta?.tasks.length ?? state.order.length;
  const green = Object.values(state.beans).filter((bean) => bean.phase === 'green').length;
  const started = state.meta?.startedAt ?? 0;
  const sentence = isFinished(state, now)
    ? `${green} of ${total} beans reached the stalk in ${spokenDuration(now - started)}.`
    : `${green} of ${total} beans are on the stalk so far.`;
  return {
    id: 'growth',
    label: 'How far the stalk grew',
    description: 'how many beans reached the stalk',
    sentence,
    action: null,
  };
}

function swarmFact(state: RaceState): LeadFact | null {
  const inFlight = Object.values(state.beans).filter(
    (bean) => isInFlight(bean.phase) && bean.startedAt !== null,
  );
  if (inFlight.length === 0) return null;
  const bed = busiestBed(state);
  return {
    id: 'swarm',
    label: 'Where the swarm is working',
    description: 'agents at work now and the busiest area',
    sentence: `${count(inFlight.length, 'agent')} ${inFlight.length === 1 ? 'is' : 'are'} working${bed === null ? '' : `; ${bed} is the busiest area`}.`,
    action: { kind: 'ask', label: 'See the swarm', question: "what's being worked on right now?" },
  };
}

function redFacts(state: RaceState, now: number): readonly LeadFact[] {
  const validations = state.ci.filter(
    (run) => run.purpose === 'validate' && run.endedAt !== null && run.endedAt <= now,
  );
  const last = validations.at(-1);
  const firstRed = validations.find((run) => run.green === false);
  if (firstRed === undefined) return [];
  const action: LeadAction = {
    kind: 'ask',
    label: 'What broke',
    question: 'why did the sprout go red?',
  };
  if (last?.green === false) {
    return [
      {
        id: 'red',
        label: 'The sprout is red',
        description: 'a validation of the sprout is failing now',
        sentence: `The sprout is red: ${shortPath(last.failingFiles[0] ?? 'a test')} fails.`,
        action,
      },
    ];
  }
  const culprit = state.tickets.find((ticket) => ticket.culprit !== null)?.culprit ?? null;
  return [
    {
      id: 'red-history',
      label: 'A red validation, traced and cleared',
      description: 'a past red validation and its culprit',
      sentence: `The sprout went red once${culprit === null ? '' : `; read sets traced it to ${culprit}`}, and it is green again.`,
      action,
    },
  ];
}

function decisionFact(state: RaceState): LeadFact | null {
  const card = state.cards.find((item) => item.status === 'open') ?? state.cards[0];
  if (card === undefined) return null;
  if (card.status === 'open') {
    return {
      id: 'decision-open',
      label: 'A decision is waiting',
      description: 'a decision card waits for a person',
      sentence: `Decision ${card.card} is waiting: two specs disagree.`,
      action: { kind: 'bean', label: 'Read the decision', bean: card.task },
    };
  }
  const winner = card.winner === null ? '' : (card.specs[card.winner] ?? card.winner);
  const loser = card.loser === null ? '' : (card.specs[card.loser] ?? card.loser);
  return {
    id: 'decision',
    label: 'A spec clash that was settled',
    description: 'two specs disagreed and one was kept',
    sentence: `Two specs clashed and one was kept: “${winner}” over “${loser}”.`,
    action: { kind: 'bean', label: 'Read the decision', bean: card.task },
  };
}

function dropsFact(state: RaceState): LeadFact | null {
  const dropped = Object.values(state.beans).filter((bean) => bean.phase === 'dropped');
  if (dropped.length === 0) return null;
  const reasons = new Map<string, number>();
  for (const bean of dropped) {
    const reason = dropKind(bean.dropReason ?? '');
    reasons.set(reason, (reasons.get(reason) ?? 0) + 1);
  }
  const listed = [...reasons]
    .map(([reason, n]) => `${n} ${n === 1 ? reason : pluralReason(reason)}`)
    .join(', ');
  return {
    id: 'drops',
    label: 'Beans that fell off',
    description: 'beans dropped before they landed, and why',
    sentence: `${count(dropped.length, 'bean')} fell off: ${listed}.`,
    action: null,
  };
}

function pendingFact(state: RaceState, now: number): LeadFact | null {
  const waiting = unpromoted(state, now);
  if (waiting === 0 || isFinished(state, now)) return null;
  return {
    id: 'pending',
    label: 'Waiting for validation',
    description: 'beans on the sprout not yet validated',
    sentence: `${count(waiting, 'bean')} on the sprout ${waiting === 1 ? 'waits' : 'wait'} for validation.`,
    action: { kind: 'ask', label: 'Show them', question: "what's on sprout but not on stalk?" },
  };
}

function pluralReason(reason: string): string {
  return reason === 'unresolved conflict' ? 'unresolved conflicts' : reason;
}

function unpromoted(state: RaceState, now: number): number {
  return state.line.commits.filter((commit) => commit.t <= now && commit.idx > state.line.stalkIdx)
    .length;
}

function dropKind(reason: string): string {
  if (/conflict/.test(reason)) return 'unresolved conflict';
  if (/decision|declined/.test(reason)) return 'declined by a decision';
  if (/red/.test(reason)) return 'still red after rework';
  return 'other';
}

/** The area with the most beans in flight, or with the most landings when none fly. */
function busiestBed(state: RaceState): string | null {
  const counts = new Map<string, number>();
  const flying = Object.values(state.beans).filter((bean) => isInFlight(bean.phase));
  const paths =
    flying.length > 0
      ? flying.flatMap((bean) => bean.files)
      : state.line.commits.flatMap((commit) => commit.files);
  for (const path of paths) counts.set(bedOf(path), (counts.get(bedOf(path)) ?? 0) + 1);
  counts.delete('core');
  const best = [...counts].toSorted((a, b) => b[1] - a[1])[0];
  return best === undefined ? null : best[0];
}

function busiestAgent(state: RaceState): string | null {
  const counts = new Map<string, number>();
  for (const bean of Object.values(state.beans))
    if (bean.agent !== null) counts.set(bean.agent, (counts.get(bean.agent) ?? 0) + 1);
  const best = [...counts].toSorted((a, b) => b[1] - a[1])[0];
  return best === undefined ? null : best[0];
}

function spokenDuration(seconds: number): string {
  const whole = Math.max(0, Math.round(seconds));
  const minutes = Math.floor(whole / 60);
  const rest = whole % 60;
  if (minutes === 0) return count(rest, 'second');
  return rest === 0
    ? count(minutes, 'minute')
    : `${count(minutes, 'minute')} ${count(rest, 'second')}`;
}

function shortPath(path: string): string {
  return path.split('/').at(-1) ?? path;
}

function count(value: number, noun: string): string {
  return `${value} ${noun}${value === 1 ? '' : 's'}`;
}
