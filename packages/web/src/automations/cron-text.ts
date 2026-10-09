/**
 * A cron line in words and its next run times, for the schedule builder. Validity and the
 * times come from the shared parser the gateway schedules with (`@beanstalk/shared-race/cron`).
 */
import { nextFireMs, parseCron } from '@beanstalk/shared-race/cron';

const DAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

/** A preset the builder offers, as people say it. */
export type CronPreset = { readonly label: string; readonly cron: string };

export const CRON_PRESETS: readonly CronPreset[] = [
  { label: 'Every hour', cron: '0 * * * *' },
  { label: 'Every day at 09:00', cron: '0 9 * * *' },
  { label: 'Weekdays at 09:00', cron: '0 9 * * 1-5' },
  { label: 'Mondays at 06:00', cron: '0 6 * * 1' },
  { label: 'Every 15 minutes', cron: '*/15 * * * *' },
];

/** The line in words ("Every Monday at 06:00 UTC"), or null when it is not valid cron. */
export function describeCron(line: string): string | null {
  if (parseCron(line) === null) return null;
  const [minute = '', hour = '', day = '', month = '', weekday = ''] = line.trim().split(/\s+/);
  const time = clockOf(minute, hour);
  const isEveryDay = day === '*' && month === '*';
  if (isEveryDay && weekday === '*') {
    if (time !== null) return `Every day at ${time} UTC`;
    if (hour === '*' && /^\d+$/.test(minute)) return `Every hour at :${minute.padStart(2, '0')}`;
    const step = /^\*\/(\d+)$/.exec(minute);
    if (step !== null && hour === '*') return `Every ${step[1]} minutes`;
  }
  if (isEveryDay && time !== null) {
    if (weekday === '1-5') return `Weekdays at ${time} UTC`;
    const named = /^\d$/.test(weekday) ? DAYS[Number(weekday) % 7] : undefined;
    if (named !== undefined) return `Every ${named} at ${time} UTC`;
  }
  if (month === '*' && weekday === '*' && /^\d+$/.test(day) && time !== null)
    return `Day ${day} of every month at ${time} UTC`;
  return `Custom: ${line.trim()} (UTC)`;
}

/** The next `count` times the line fires after `afterMs`, as ISO strings (empty if invalid). */
export function nextRuns(line: string, afterMs: number, count: number): readonly string[] {
  const schedule = parseCron(line);
  if (schedule === null) return [];
  const runs: string[] = [];
  let at = afterMs;
  while (runs.length < count) {
    const next = nextFireMs(schedule, at);
    if (next === null) break;
    runs.push(new Date(next).toISOString());
    at = next;
  }
  return runs;
}

function clockOf(minute: string, hour: string): string | null {
  if (!/^\d+$/.test(minute) || !/^\d+$/.test(hour)) return null;
  return `${hour.padStart(2, '0')}:${minute.padStart(2, '0')}`;
}
