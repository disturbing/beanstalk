/** How the canvas writes race numbers: clock times, minutes, money, counts. */

/** `8:41`, or `1:02:05` past an hour (race seconds). */
export function formatClock(seconds: number): string {
  const whole = Math.max(0, Math.floor(seconds));
  const hours = Math.floor(whole / 3600);
  const minutes = Math.floor((whole % 3600) / 60);
  const secs = String(whole % 60).padStart(2, '0');
  return hours > 0 ? `${hours}:${String(minutes).padStart(2, '0')}:${secs}` : `${minutes}:${secs}`;
}

/** `11.3 min`, as the research tables print minutes. */
export function formatMinutes(seconds: number): string {
  return `${(seconds / 60).toFixed(1)} min`;
}

/** A short duration for a lane: `42 s`, `3:05`. */
export function formatSpan(seconds: number): string {
  const whole = Math.max(0, Math.round(seconds));
  if (whole < 60) return `${whole} s`;
  return formatClock(whole);
}

export function formatUsd(value: number): string {
  return `$${value.toFixed(2)}`;
}

export function ordinal(value: number): string {
  const tens = value % 100;
  if (tens >= 11 && tens <= 13) return `${value}th`;
  switch (value % 10) {
    case 1:
      return `${value}st`;
    case 2:
      return `${value}nd`;
    case 3:
      return `${value}rd`;
    default:
      return `${value}th`;
  }
}

export function plural(count: number, noun: string): string {
  return `${count} ${noun}${count === 1 ? '' : 's'}`;
}
