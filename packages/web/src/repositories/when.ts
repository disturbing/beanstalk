/** "just now", "5 minutes ago", "3 days ago", then the date: for lists of recent things. */
export function timeAgo(iso: string, nowMs: number): string {
  const seconds = Math.max(0, Math.round((nowMs - Date.parse(iso)) / 1000));
  if (!Number.isFinite(seconds)) return '';
  if (seconds < 60) return 'just now';
  const units: readonly (readonly [number, string])[] = [
    [86400, 'day'],
    [3600, 'hour'],
    [60, 'minute'],
  ];
  const days = seconds / 86400;
  if (days >= 30) return `on ${iso.slice(0, 10)}`;
  for (const [size, name] of units) {
    const count = Math.floor(seconds / size);
    if (count >= 1) return `${count} ${name}${count === 1 ? '' : 's'} ago`;
  }
  return 'just now';
}
