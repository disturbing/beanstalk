/**
 * Which workflows a moment starts (doc 25 §2): the stalk moving is GitHub's `push` to the base
 * branch, so `branches: [main]`, `[stalk]` or the repository's default branch all match it
 * (D3); a button or MCP call is `workflow_dispatch`, with its inputs checked as GitHub does.
 */
import type { DispatchInputSpec, WorkflowTrigger } from '@beanstalk/shared-race/actions';

import { selectedBy } from './filter-pattern';

/** What a run's `github.ref` says for the stalk: `refs/heads/main` (D3). */
export const STALK_REF_NAME = 'main';

/** Branch names the stalk answers to in filters: `main`, `stalk` and the default branch. */
export function stalkNames(defaultBranch: string): readonly string[] {
  return [...new Set([STALK_REF_NAME, 'stalk', defaultBranch])];
}

/**
 * Whether a `push` trigger fires for the stalk moving. `changedPaths` is null when the change
 * is unknown (the first stalk move the index sees), and path filters then let it through.
 */
export function pushFires(
  trigger: Extract<WorkflowTrigger, { kind: 'push' }>,
  move: { readonly defaultBranch: string; readonly changedPaths: readonly string[] | null },
): boolean {
  const names = stalkNames(move.defaultBranch);
  if (trigger.branches.length > 0 && !names.some((name) => selectedBy(trigger.branches, name)))
    return false;
  if (trigger.branchesIgnore.length > 0 && names.some((name) => selectedBy(trigger.branchesIgnore, name)))
    return false;
  if (move.changedPaths === null) return true;
  const paths = move.changedPaths;
  if (trigger.paths.length > 0 && !paths.some((path) => selectedBy(trigger.paths, path))) return false;
  if (trigger.pathsIgnore.length > 0 && paths.every((path) => selectedBy(trigger.pathsIgnore, path)))
    return false;
  return true;
}

/** Whether `ref` names the stalk (`stalk`, `main`, the default branch, or `refs/heads/` of one). */
export function namesStalk(ref: string, defaultBranch: string): boolean {
  const name = ref.startsWith('refs/heads/') ? ref.slice('refs/heads/'.length) : ref;
  return stalkNames(defaultBranch).includes(name);
}

export type InputsCheck =
  | { readonly ok: true; readonly inputs: Readonly<Record<string, string>> }
  | { readonly ok: false; readonly error: string };

/** Dispatch inputs checked against the declared ones, defaults filled, all as strings. */
export function checkDispatchInputs(
  declared: readonly DispatchInputSpec[],
  given: Readonly<Record<string, string | number | boolean>>,
): InputsCheck {
  const known = new Set(declared.map((input) => input.name));
  const unknown = Object.keys(given).filter((name) => !known.has(name));
  if (unknown.length > 0) return { ok: false, error: `unexpected inputs: ${unknown.join(', ')}` };
  const inputs: Record<string, string> = {};
  for (const input of declared) {
    const raw = given[input.name];
    const value = raw === undefined ? input.default : String(raw);
    if (value === null || value === '') {
      if (input.required) return { ok: false, error: `input ${input.name} is required` };
      inputs[input.name] = input.type === 'boolean' ? 'false' : '';
      continue;
    }
    const problem = inputProblem(input, value);
    if (problem !== null) return { ok: false, error: problem };
    inputs[input.name] = value;
  }
  return { ok: true, inputs };
}

function inputProblem(input: DispatchInputSpec, value: string): string | null {
  switch (input.type) {
    case 'boolean':
      return value === 'true' || value === 'false' ? null : `input ${input.name} must be true or false`;
    case 'number':
      return Number.isFinite(Number(value)) ? null : `input ${input.name} must be a number`;
    case 'choice':
      return input.options.includes(value)
        ? null
        : `input ${input.name} must be one of ${input.options.join(', ')}`;
    case 'string':
    case 'environment':
      return null;
    default:
      return input.type;
  }
}
