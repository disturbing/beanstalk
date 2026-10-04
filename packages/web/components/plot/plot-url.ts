/**
 * The Plot's state lives in its URL, so every view is shareable: the question, removed
 * chips, the bean or file being read, and the moment of the race.
 */
export type PlotState = {
  readonly q: string;
  readonly removed: readonly string[];
  readonly bean: string | null;
  readonly file: string | null;
  /** Race second of the playhead; null is the end (or now, live). */
  readonly t: number | null;
};

type SearchParams = Readonly<Record<string, string | readonly string[] | undefined>>;

export function readPlotState(params: SearchParams): PlotState {
  const one = (key: string): string | undefined => {
    const value = params[key];
    return typeof value === 'string' ? value : value?.[0];
  };
  const removed = params['x'];
  const t = Number(one('t'));
  return {
    q: (one('q') ?? '').slice(0, 300),
    removed: (typeof removed === 'string' ? [removed] : (removed ?? [])).slice(0, 40),
    bean: one('bean') ?? null,
    file: one('file') ?? null,
    t: one('t') !== undefined && Number.isFinite(t) && t >= 0 ? t : null,
  };
}

export function plotHref(run: string, state: PlotState, change: Partial<PlotState> = {}): string {
  const next = { ...state, ...change };
  const params = new URLSearchParams();
  if (next.q !== '') params.set('q', next.q);
  for (const removed of next.removed) params.append('x', removed);
  if (next.bean !== null) params.set('bean', next.bean);
  if (next.file !== null) params.set('file', next.file);
  if (next.t !== null) params.set('t', String(Math.round(next.t)));
  const query = params.toString();
  return `/runs/${run}${query === '' ? '' : `?${query}`}`;
}

/** A fresh question: keeps the moment, drops removals and the selection. */
export function askPlotHref(run: string, state: PlotState, q: string): string {
  return plotHref(run, state, { q, removed: [], bean: null, file: null });
}
