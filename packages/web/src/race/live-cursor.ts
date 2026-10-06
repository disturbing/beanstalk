/**
 * Where the feed resumes: the browser's `Last-Event-ID` on an automatic reconnect (the last
 * event it saw), else the page's `?after=` (the seq at page load). Anything else is 0.
 */
export function resumeCursor(request: Request): number {
  const fromHeader = request.headers.get('last-event-id');
  const raw = fromHeader ?? new URL(request.url).searchParams.get('after') ?? '0';
  const cursor = Number(raw);
  return Number.isInteger(cursor) && cursor >= 0 ? cursor : 0;
}
