/**
 * A race second with the most beans in flight: where "what is the swarm doing right now?"
 * lands on a run that has already finished. Of the moments that reach the most, the middle
 * one, so the line below already has landings.
 */
import type { RaceEvent } from '../race/race-events';

export function busiestMoment(events: readonly RaceEvent[]): number | null {
  const flying = new Set<string>();
  const counts: { readonly count: number; readonly t: number }[] = [];
  for (const event of events) {
    if (event.type === 'task.start') flying.add(event.task);
    if ((event.type === 'land' || event.type === 'task.drop') && event.task !== null)
      flying.delete(event.task);
    counts.push({ count: flying.size, t: event.t });
  }
  const most = Math.max(0, ...counts.map((moment) => moment.count));
  if (most === 0) return null;
  const busiest = counts.filter((moment) => moment.count === most);
  return busiest[Math.floor(busiest.length / 2)]?.t ?? null;
}
