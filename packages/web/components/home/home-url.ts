/**
 * The repository home's state lives in its URL, so every view is shareable: the question,
 * removed chips, the bean being read (and its selected step), and the moment of the run.
 */
export type HomeState = {
  readonly q: string;
  readonly removed: readonly string[];
  readonly bean: string | null;
  /** The journey step shown for the bean; null is "All changes". */
  readonly step: string | null;
  /** Race second of the playhead; null is the end (or now, live). */
  readonly t: number | null;
};

type SearchParams = Readonly<Record<string, string | readonly string[] | undefined>>;

export function readHomeState(params: SearchParams): HomeState {
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
    step: one('step') ?? null,
    t: one('t') !== undefined && Number.isFinite(t) && t >= 0 ? t : null,
  };
}

export function homeHref(run: string, state: HomeState, change: Partial<HomeState> = {}): string {
  const next = { ...state, ...change };
  const params = new URLSearchParams();
  if (next.q !== '') params.set('q', next.q);
  for (const removed of next.removed) params.append('x', removed);
  if (next.bean !== null) params.set('bean', next.bean);
  if (next.bean !== null && next.step !== null) params.set('step', next.step);
  if (next.t !== null) params.set('t', String(Math.round(next.t)));
  const query = params.toString();
  return `/runs/${run}${query === '' ? '' : `?${query}`}`;
}

/** A fresh question: keeps the moment, drops removals and the selection. */
export function askHomeHref(run: string, state: HomeState, q: string): string {
  return homeHref(run, state, { q, removed: [], bean: null, step: null });
}

/** A bean opened from anywhere: its journey, "All changes" first. */
export function beanHref(run: string, state: HomeState, bean: string): string {
  return homeHref(run, state, { bean, step: null });
}
