/**
 * The explorer's state lives in its URL, so every answer is shareable and the back button
 * works: the question, removed chips, the line, the selection and (for recorded runs) the
 * moment of the race.
 */
export type ExplorerState = {
  readonly q: string;
  readonly removed: readonly string[];
  readonly ref: 'sprout' | 'stalk' | null;
  readonly file: string | null;
  readonly bean: string | null;
  readonly view: 'diff' | 'file' | null;
  /** Race second for a recorded run; null is the end. */
  readonly at: number | null;
};

type SearchParams = Readonly<Record<string, string | readonly string[] | undefined>>;

export function readExplorerState(params: SearchParams): ExplorerState {
  const one = (key: string): string | undefined => {
    const value = params[key];
    return typeof value === 'string' ? value : value?.[0];
  };
  const many = (key: string): readonly string[] => {
    const value = params[key];
    if (value === undefined) return [];
    return typeof value === 'string' ? [value] : value;
  };
  const ref = one('ref');
  const view = one('view');
  const at = Number(one('at'));
  return {
    q: (one('q') ?? '').slice(0, 300),
    removed: many('x').slice(0, 40),
    ref: ref === 'sprout' || ref === 'stalk' ? ref : null,
    file: one('file') ?? null,
    bean: one('bean') ?? null,
    view: view === 'diff' || view === 'file' ? view : null,
    at: Number.isFinite(at) && at >= 0 ? at : null,
  };
}

/** The explorer URL for a run with some state changed. */
export function explorerHref(
  run: string,
  state: ExplorerState,
  change: Partial<ExplorerState> = {},
): string {
  const next = { ...state, ...change };
  const params = new URLSearchParams();
  if (next.q !== '') params.set('q', next.q);
  for (const removed of next.removed) params.append('x', removed);
  if (next.ref !== null) params.set('ref', next.ref);
  if (next.file !== null) params.set('file', next.file);
  if (next.bean !== null) params.set('bean', next.bean);
  if (next.view !== null) params.set('view', next.view);
  if (next.at !== null) params.set('at', String(Math.round(next.at)));
  const query = params.toString();
  return `/runs/${run}${query === '' ? '' : `?${query}`}`;
}

/** A fresh question: keeps the line and the moment, drops removals and selection. */
export function askHref(run: string, state: ExplorerState, q: string): string {
  return explorerHref(run, state, { q, removed: [], file: null, bean: null, view: null });
}
