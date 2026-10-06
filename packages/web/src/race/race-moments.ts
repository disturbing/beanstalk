/** Moments of a race worth travelling to: landings, reds, decisions, every five minutes. */
import type { RaceEvent } from '@beanstalk/shared-ask/race/race-events';
import { formatClock } from './race-format';

export type RaceMoment = { readonly t: number; readonly label: string };

/** Minutes between the evenly spaced moments. */
const STEP_MINUTES = 5;

export function raceMoments(events: readonly RaceEvent[]): readonly RaceMoment[] {
  const end = events.findLast((event) => event.type === 'race.end')?.t ?? events.at(-1)?.t ?? 0;
  const moments: RaceMoment[] = [];
  const firstLand = events.find((event) => event.type === 'land');
  if (firstLand !== undefined) moments.push({ t: firstLand.t, label: 'First landing' });
  const firstGreen = events.find((event) => event.type === 'green.promote');
  if (firstGreen !== undefined) moments.push({ t: firstGreen.t, label: 'First bean on the stalk' });
  for (const event of events) {
    if (
      event.type === 'ci.end' &&
      event.green === false &&
      (event.purpose === 'validate' || event.purpose === 'batch')
    ) {
      const subject =
        event.trunk_idx === undefined ? (event.batch ?? 'a batch') : `sprout #${event.trunk_idx}`;
      moments.push({ t: event.t, label: `${subject} went red` });
    }
    if (event.type === 'decision.request') {
      const start = event.trigger === 'start' ? ' (a start card)' : '';
      moments.push({ t: event.t, label: `Decision ${event.card} opened${start}` });
    }
  }
  for (let minute = STEP_MINUTES; minute * 60 < end; minute += STEP_MINUTES) {
    moments.push({ t: minute * 60, label: `Minute ${minute}` });
  }
  return moments
    .toSorted((a, b) => a.t - b.t)
    .map((moment) => ({ t: moment.t, label: `${formatClock(moment.t)}  ${moment.label}` }));
}
