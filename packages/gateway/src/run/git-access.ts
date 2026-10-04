/**
 * Who may read or write the run repo through the git proxy. Agents never hold Artifacts
 * tokens; this decides whether the gateway lends its own for one request.
 *
 * - A slot reads the run repo at any time: the sprout, the stalk and every bean branch.
 * - A slot pushes only `refs/heads/beans/<task>` of a task it is working on (held, or the
 *   subject of its open invocation). The proxy reads the push's command list and refuses
 *   any other ref and every deletion.
 * - The admin's seed token pushes the arena base to the sprout and the stalk, before the
 *   start only.
 * - Nobody else gets anything.
 */
import { assertNever } from '../engine/errors';
import { SPROUT_REF, STALK_REF } from '../engine/refs';
import type { EngineState } from '../engine/state';
import { taskBranch } from '../engine/tasks';
import type { RunRepos } from './run-jobs';

export type GitPrincipal = { readonly scope: 'slot' | 'seed' | 'view'; readonly sub: string };
export type GitAccess = 'read' | 'write';

export type GitDecision =
  | {
      readonly allowed: true;
      /** Artifacts repo name to lend a token for. */
      readonly repo: string;
      readonly scope: GitAccess;
      /** Refs a push may update; null for reads. */
      readonly refs: readonly string[] | null;
    }
  | { readonly allowed: false; readonly status: 403 | 404 | 409; readonly message: string };

/** The refs the seed push creates: both lines start at the arena base. */
export const SEED_REFS: readonly string[] = [SPROUT_REF, STALK_REF];

export function decideGitAccess(input: {
  principal: GitPrincipal;
  repo: string;
  access: GitAccess;
  repos: RunRepos;
  state: EngineState;
}): GitDecision {
  const { principal, repo, access, repos, state } = input;
  if (repo !== repos.repo.name) return deny(404, `${repo} is not a repo of this run`);
  switch (principal.scope) {
    case 'seed':
      return seedAccess(repo, access, state);
    case 'slot':
      return slotAccess(repo, access, { state, slot: principal.sub });
    case 'view':
      return deny(403, 'view tokens do not open git repos');
    default:
      return assertNever(principal.scope);
  }
}

function seedAccess(repo: string, access: GitAccess, state: EngineState): GitDecision {
  if (access === 'write' && state.phase !== 'created') {
    return deny(409, 'the run repo takes the arena base only before the run starts');
  }
  return { allowed: true, repo, scope: access, refs: access === 'write' ? SEED_REFS : null };
}

function slotAccess(
  repo: string,
  access: GitAccess,
  who: { state: EngineState; slot: string },
): GitDecision {
  if (access === 'read') return { allowed: true, repo, scope: 'read', refs: null };
  const tasks = tasksOf(who.state, who.slot);
  if (tasks.length === 0) return deny(403, `slot ${who.slot} is not working on a task`);
  const refs = tasks.map((task) => `refs/heads/${taskBranch(task)}`);
  return { allowed: true, repo, scope: 'write', refs };
}

/** The tasks a slot holds or has an invocation for: the beans it may push. */
function tasksOf(state: EngineState, slot: string): string[] {
  const held = state.slots.flatMap((candidate) =>
    candidate.id === slot && candidate.holding !== null ? [candidate.holding] : [],
  );
  const invoked = Object.values(state.invocations).flatMap((inv) =>
    inv.slot === slot ? [inv.workspace.repoKey] : [],
  );
  return [...new Set([...held, ...invoked])];
}

function deny(status: 403 | 404 | 409, message: string): GitDecision {
  return { allowed: false, status, message };
}
