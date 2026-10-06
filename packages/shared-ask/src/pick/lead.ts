/**
 * The Plot's suggested questions. Code computes which questions the race state supports;
 * the picker only orders them (`docs/claude-opus/14` §5, decision `suggest`).
 */
import { isInFlight } from '../race/race-counters';
import type { RaceState } from '../race/race-state';
import { bedOf } from '../home/areas';
import type { PickCandidate, PickDecision } from './picker';

export type Suggestion = PickCandidate & { readonly question: string };

export function isFinished(state: RaceState, now: number): boolean {
  return state.endedAt !== null && now >= state.endedAt;
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

function unpromoted(state: RaceState, now: number): number {
  return state.line.commits.filter((commit) => commit.t <= now && commit.idx > state.line.stalkIdx)
    .length;
}
