/**
 * The sprout and the stalk of a repository that gets a continuous engine. A repository made by
 * the repository side has a default branch (or nothing yet); its engine starts both lines at
 * that branch's head, or at an empty first commit for an empty repository. A repository that
 * already has both lines (the engine was opened before) keeps them.
 */
import { Sha } from '@beanstalk/shared-race/ids';

import { GatewayError } from '../errors';
import { EMPTY_TREE_ID, commitObject, gitObject } from '../git/pack-writer';
import type { RemoteTarget } from '../git/remote-client';
import { ZERO_SHA, listRefs, pushRefs } from '../git/remote-client';

const SPROUT = 'refs/heads/sprout';
const STALK = 'refs/heads/stalk';
const FALLBACK_BRANCHES = ['main', 'master'] as const;

/** Makes sure both lines exist and agree; returns the base the engine starts from. */
export async function prepareRepoLines(
  target: RemoteTarget,
  options: { baseBranch: string | null; nowMs: number },
): Promise<Sha> {
  const refs = await listRefs(target);
  const sprout = refs.get(SPROUT);
  const stalk = refs.get(STALK);
  if (sprout !== undefined && stalk !== undefined) {
    if (sprout !== stalk)
      throw new GatewayError(
        `refs/heads/sprout and refs/heads/stalk differ; an engine starts where they agree`,
        'invalid_state',
        409,
      );
    return Sha.parse(sprout);
  }
  const base = baseHead(refs, options.baseBranch) ?? (await firstCommit(target, options.nowMs));
  const updates = [SPROUT, STALK]
    .filter((ref) => !refs.has(ref))
    .map((ref) => ({ ref, oldSha: ZERO_SHA, newSha: base }));
  const report = await pushRefs(target, updates, []);
  const refused = report.refs.find((status) => !status.ok);
  if (!report.unpackOk || refused !== undefined)
    throw new GatewayError(
      `seeding the lines failed: ${refused?.reason ?? 'unpack failed'}`,
      'upstream_failed',
      502,
    );
  return Sha.parse(base);
}

function baseHead(refs: ReadonlyMap<string, string>, baseBranch: string | null): string | null {
  const names = baseBranch === null ? FALLBACK_BRANCHES : [baseBranch];
  for (const name of names) {
    const sha = refs.get(`refs/heads/${name}`);
    if (sha !== undefined) return sha;
  }
  const first = [...refs.entries()].find(([ref]) => ref.startsWith('refs/heads/'));
  return first?.[1] ?? null;
}

/** An empty repository's first commit (an empty tree), pushed as `main`. */
async function firstCommit(target: RemoteTarget, nowMs: number): Promise<string> {
  const tree = await gitObject('tree', new Uint8Array(0));
  if (tree.id !== EMPTY_TREE_ID) throw new Error('the empty tree has the wrong id');
  const commit = await commitObject({
    tree: tree.id,
    parents: [],
    author: { name: 'beanstalk', email: 'engine@beanstalk.invalid', atMs: nowMs },
    message: 'Start the repository',
  });
  const report = await pushRefs(
    target,
    [{ ref: 'refs/heads/main', oldSha: ZERO_SHA, newSha: commit.id }],
    [tree, commit],
  );
  if (!report.unpackOk || report.refs.some((status) => !status.ok))
    throw new GatewayError('creating the first commit failed', 'upstream_failed', 502);
  return commit.id;
}
