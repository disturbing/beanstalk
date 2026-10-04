import { RunId } from '@beanstalk/shared-race/ids';
import type { SlotId } from '@beanstalk/shared-race/ids';

/** Characters of a generated run id (36^10 ≈ 3.7e15 ids; ids are unguessable labels, not secrets). */
const RUN_ID_LENGTH = 10;
const RUN_ID_ALPHABET = 'abcdefghijklmnopqrstuvwxyz0123456789';

/** A fresh random run id. */
export function newRunId(): RunId {
  const bytes = crypto.getRandomValues(new Uint8Array(RUN_ID_LENGTH));
  return RunId.parse(
    Array.from(bytes, (byte) => RUN_ID_ALPHABET[byte % RUN_ID_ALPHABET.length]).join(''),
  );
}

/** The run repo in the Artifacts namespace: the sprout, the stalk and every bean branch. */
export function runRepoName(run: RunId): string {
  return `race-${run}`;
}

/**
 * Whether an Artifacts repo belongs to a run: its run repo, or a `race-<run>-*` repo an
 * earlier gateway made for it (forked beans, trunks).
 */
export function isRunRepo(run: RunId, name: string): boolean {
  const repo = runRepoName(run);
  return name === repo || name.startsWith(`${repo}-`);
}

/** The run a repo name belongs to (`race-<run>`, or `race-<run>-…` of earlier gateways). */
export function runOfRepo(repo: string): RunId | null {
  const match = /^race-([a-z0-9]+)(?:-[A-Za-z0-9][A-Za-z0-9._-]*)?$/.exec(repo);
  const parsed = RunId.safeParse(match?.[1]);
  return parsed.success ? parsed.data : null;
}

/** The runner instance that writes for a run (squash, revert, update-ref): one writer per run. */
export function committerInstance(run: RunId): string {
  return `run-${run}-committer`;
}

/** The runner instance of an emulated CI slot. */
export function ciInstance(run: RunId, slot: number): string {
  return `run-${run}-ci-${slot}`;
}

/** The runner instance an agent slot's pre-land checks run on (its sandbox). */
export function sandboxInstance(run: RunId, slot: SlotId): string {
  return `run-${run}-sandbox-${slot}`;
}
