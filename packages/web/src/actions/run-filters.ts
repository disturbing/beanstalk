/**
 * The Actions list's URL state (`?workflow=&status=&branch=&before=`) and the dispatch form's
 * inputs, checked against the workflow's `workflow_dispatch` declaration before anything is
 * sent: required ones present, a choice one of its options, a boolean true or false.
 */
import type { DispatchInput, RunFilter } from './actions-contract';

export const STATUS_FILTERS = ['success', 'failure', 'cancelled', 'in_progress', 'queued'] as const;
type StatusFilter = (typeof STATUS_FILTERS)[number];

export const STATUS_FILTER_WORDS: Readonly<Record<StatusFilter, string>> = {
  success: 'Succeeded',
  failure: 'Failed',
  cancelled: 'Cancelled',
  in_progress: 'Running',
  queued: 'Queued',
};

export const RUNS_PER_PAGE = 25;

type SearchParams = Readonly<Record<string, string | string[] | undefined>>;

export function runFilterOf(params: SearchParams): RunFilter {
  const workflow = single(params['workflow']);
  const status = single(params['status']);
  const branch = single(params['branch']);
  const before = single(params['before']);
  return {
    limit: RUNS_PER_PAGE,
    ...(workflow === undefined ? {} : { workflow }),
    ...(isStatus(status) ? { status } : {}),
    ...(branch === undefined ? {} : { branch }),
    ...(before !== undefined && /^\d+$/.test(before) ? { before } : {}),
  };
}

/** The list's address with one filter changed (and paging reset unless `before` is the change). */
export function filterHref(
  path: string,
  filter: RunFilter,
  change: Partial<Record<'workflow' | 'status' | 'branch' | 'before', string | null>>,
): string {
  const next = new URLSearchParams();
  const keep = { workflow: filter.workflow, status: filter.status, branch: filter.branch };
  for (const [key, value] of Object.entries({ ...keep, ...change }))
    if (value !== undefined && value !== null && key !== 'before') next.set(key, value);
  if (typeof change.before === 'string') next.set('before', change.before);
  const query = next.toString();
  return query === '' ? path : `${path}?${query}`;
}

export type InputsCheck =
  | { readonly ok: true; readonly inputs: Readonly<Record<string, string>> }
  | { readonly ok: false; readonly message: string };

/** The form's `input:<name>` fields against the declared inputs. */
export function dispatchInputsOf(declared: readonly DispatchInput[], form: FormData): InputsCheck {
  const inputs: Record<string, string> = {};
  for (const input of declared) {
    const raw = form.get(`input:${input.name}`);
    const value = input.type === 'boolean' ? String(raw === 'true' || raw === 'on') : stringOf(raw);
    if (value === '' && input.required) return { ok: false, message: `${input.name} is required.` };
    if (input.type === 'choice' && value !== '' && !input.options.includes(value))
      return { ok: false, message: `${input.name} must be one of ${input.options.join(', ')}.` };
    if (input.type === 'number' && value !== '' && !Number.isFinite(Number(value)))
      return { ok: false, message: `${input.name} must be a number.` };
    if (value !== '') inputs[input.name] = value;
  }
  return { ok: true, inputs };
}

function stringOf(value: FormDataEntryValue | null): string {
  return typeof value === 'string' ? value.trim() : '';
}

function single(value: string | string[] | undefined): string | undefined {
  const first = Array.isArray(value) ? value[0] : value;
  return first === undefined || first === '' ? undefined : first;
}

function isStatus(value: string | undefined): value is StatusFilter {
  return STATUS_FILTERS.some((status) => status === value);
}
