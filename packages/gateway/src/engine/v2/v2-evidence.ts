/**
 * Promotion by evidence (`evidence_promotion`, `docs/claude-opus/11`, "Event-driven
 * promotion"). A test's verdict depends only on the files it reads. So if a test passed on a
 * tree T whose full suite was green, and none of the files it reads differ between T and a
 * sprout commit H, it passes on H too. H is green without CI when every test of H is vouched for
 * that way by some checked tree: a bean's green full pre-land check, or a sprout commit a full
 * validation passed or that was itself promoted on evidence (its read sets are then the ones that
 * vouched for it).
 *
 * The rule, conservative at every step:
 *
 * - A voucher's difference to H is the union of the files every sprout commit after its base
 *   changed (a revert's and a reset's included), plus the bean's own change while the bean's
 *   own landing is not among them. The bean's landing is left out only when it is the checked
 *   commit or a textual re-squash of it: a file it changed then has the checked content unless
 *   another commit changed it too, and that commit's files are in the union.
 * - A test is touched when its read set (always including the test file) meets the difference,
 *   when the difference holds a file every test depends on (`GLOBAL_FILE`), or when a changed
 *   file is another resolution of a module the test reads (`src/a.ts` beside `src/a/index.ts`:
 *   an added file a test probes). Listings (globs, fixtures directories) are the runner's to
 *   report as reads.
 * - The tests of H are every test any voucher's tree has, plus every test file a commit
 *   changed. A test no voucher vouches for is affected; one with no read set is never vouched for.
 * - No evidence at all while the sprout is known red (a ticket, a red validation at or below H,
 *   a red waiting for its re-run), when a bean on the sprout has no green full check with read
 *   sets, when a structural merge's tree was never checked, or for a test an audit caught.
 *
 * Read sets count only when the runner marks them complete (`evidence_read_sets: complete`), or
 * also as static import closures (`static`); the background audit (`v2-audit`) is the net.
 */
import type { Sha, TaskId } from '@beanstalk/shared-race/ids';
import type { EvidenceOverlap, EvidenceTree } from '@beanstalk/shared-race/events';

import { isRunnableTest } from '../arena';
import type { CheckResult } from '../model';
import { knownRedFiles, requireCommit, sproutIndex } from './v2-sprout';
import type { AffectedRun, EvidenceState, SproutCommit, V2State, Voucher } from './v2-state';
import { activeTickets } from './v2-tickets';

/** Files every test depends on: a change to one may break any test that does not import it. */
export const GLOBAL_FILE =
  /(^|\/)(package\.json|pnpm-lock\.yaml|package-lock\.json|yarn\.lock|\.npmrc|tsconfig[^/]*\.json|(vitest|vite|jest)\.(config|workspace)\.[cm]?[jt]s)$/;

/** Read-set index of a test whose read set the check did not report. */
const UNKNOWN_READS = -1;
/** Files or tests an evidence event lists. */
const LISTED = 20;
/** Suffixes one module may resolve through (the runner's `RESOLVE_SUFFIXES`, longest first). */
const MODULE_SUFFIX = /(\/index)?\.(tsx?|mts|cts|jsx?|mjs|cjs)$/;

/** A voucher's difference to a sprout commit; an anchor's comes from sprout commits alone. */
type Difference = { readonly files: readonly string[]; readonly isAnchor: boolean };

export type RefusalReason =
  | 'no-read-sets'
  | 'unchecked-bean'
  | 'structural'
  | 'known-red'
  | 'affected';

/** What evidence says about one sprout commit. */
export type Evidence = {
  readonly idx: number;
  /** Every test of the commit's tree, as far as the vouchers know. */
  readonly tests: readonly string[];
  /** Tests vouched for, with the voucher and the read set that did it. */
  readonly vouched: Readonly<Record<string, { voucher: string; set: number }>>;
  readonly affected: readonly string[];
  readonly trees: readonly EvidenceTree[];
  readonly overlaps: readonly EvidenceOverlap[];
  /** Null when every test is vouched for. */
  readonly refusal: RefusalReason | null;
};

export function isEvidenceOn(state: V2State): boolean {
  return state.settings.evidence !== undefined;
}

/** The evidence state, created on first use. */
export function evidenceState(state: V2State): EvidenceState {
  state.evidence ??= {
    sets: [],
    vouchers: {},
    verifiedIdx: -1,
    unverified: [],
    affected: {},
    audit: null,
    tried: null,
  };
  return state.evidence;
}

/**
 * A bean's full pre-land check of `candidate` (built on `head0`, differing from it in `files`)
 * was green: it vouches for its tests from now on, replacing the bean's older check.
 */
export function rememberCheck(
  state: V2State,
  check: {
    task: TaskId;
    candidate: Sha;
    head0: Sha;
    files: readonly string[];
    result: CheckResult;
  },
): void {
  const reads = usableReads(state, check.result);
  if (reads === null) return;
  const evidence = evidenceState(state);
  for (const [key, voucher] of Object.entries(evidence.vouchers)) {
    if (voucher.kind === 'check' && voucher.task === check.task) delete evidence.vouchers[key];
  }
  evidence.vouchers[check.candidate] = {
    sha: check.candidate,
    kind: 'check',
    task: check.task,
    base: sproutIndex(state, check.head0),
    own: [...check.files],
    reads: intern(evidence, reads),
  };
  evidence.tried = null;
}

/** The sprout commit at `idx` passed the full suite (`result`): its tree vouches from now on. */
export function rememberValidated(state: V2State, idx: number, result: CheckResult): void {
  const reads = usableReads(state, result);
  if (reads === null) return;
  const evidence = evidenceState(state);
  setSproutVoucher(state, idx, intern(evidence, reads));
}

/** The sprout commit at `idx` is the exact tree of a bean's check: that check vouches for it. */
export function adoptCheck(state: V2State, idx: number, sha: Sha): void {
  const voucher = state.evidence?.vouchers[sha];
  if (voucher !== undefined) setSproutVoucher(state, idx, voucher.reads);
}

/** The reset commit at `idx` has the tree of the stalk at `from`: the stalk's voucher holds for it. */
export function adoptStalk(state: V2State, idx: number, from: number): void {
  const voucher = state.evidence?.vouchers[sproutKey(from)];
  if (voucher !== undefined) setSproutVoucher(state, idx, voucher.reads);
}

/**
 * Evidence for the sprout commit at `idx` (above the stalk): which of its tests the vouchers
 * vouch for, and why evidence is refused when some are left.
 */
export function evidenceFor(state: V2State, idx: number): Evidence {
  const evidence = evidenceState(state);
  const ruledOut = ruleOut(state, idx);
  const vouchers = Object.values(evidence.vouchers).filter((voucher) => voucher.base <= idx);
  if (ruledOut !== null || vouchers.length === 0) {
    return refused(idx, ruledOut ?? 'no-read-sets');
  }
  const differences = new Map(
    vouchers.map((voucher) => [voucher.sha, differenceTo(state, voucher, idx)]),
  );
  const diffs = new Map([...differences].map(([sha, difference]) => [sha, difference.files]));
  const tests = testsOf(state, idx, { vouchers, differences });
  if (tests === null) return refused(idx, 'no-read-sets');
  const distrusted = new Set(evidence.distrusted ?? []);
  const vouched: Record<string, { voucher: string; set: number }> = {};
  const overlaps: EvidenceOverlap[] = [];
  const counts = new Map<string, number>();
  for (const test of tests) {
    if (distrusted.has(test)) continue;
    for (const voucher of vouchers) {
      const set = voucher.reads[test];
      if (set === undefined || set === UNKNOWN_READS) continue;
      const met = touched(test, evidence.sets[set] ?? [], diffs.get(voucher.sha) ?? []);
      if (met.length > 0) {
        overlaps.push({ test, checked: voucher.sha, files: met.slice(0, LISTED) });
        continue;
      }
      vouched[test] = { voucher: voucher.sha, set };
      counts.set(voucher.sha, (counts.get(voucher.sha) ?? 0) + 1);
      break;
    }
  }
  const affected = tests.filter((test) => vouched[test] === undefined);
  return {
    idx,
    tests,
    vouched,
    affected,
    trees: vouchers
      .filter((voucher) => (counts.get(voucher.sha) ?? 0) > 0)
      .map((voucher) =>
        treeOf(voucher, diffs.get(voucher.sha) ?? [], counts.get(voucher.sha) ?? 0),
      ),
    overlaps: overlaps.filter(
      (overlap) => vouched[overlap.test] !== undefined || affected.includes(overlap.test),
    ),
    refusal: affected.length > 0 ? 'affected' : null,
  };
}

/**
 * The commit at `idx` is green on evidence (with `affected` run green): its tree vouches for its
 * tests from now on, through the read sets that vouched for them (and the affected run's).
 */
export function rememberPromoted(
  state: V2State,
  idx: number,
  proof: { vouched: Readonly<Record<string, number>>; run: CheckResult | null },
): void {
  const evidence = evidenceState(state);
  const reads: Record<string, number> = { ...proof.vouched };
  const ran = proof.run === null ? null : usableReads(state, proof.run);
  if (ran !== null) Object.assign(reads, intern(evidence, ran));
  setSproutVoucher(state, idx, reads);
}

/** The read sets that vouched for each test, by interned index (an affected run keeps them). */
export function vouchedSets(proof: Evidence): Record<string, number> {
  return Object.fromEntries(Object.entries(proof.vouched).map(([test, by]) => [test, by.set]));
}

/** The affected validation started for `idx`, if any. */
export function affectedRun(state: V2State, idx: number): AffectedRun | undefined {
  return state.evidence?.affected[String(idx)];
}

/**
 * The stalk moved to `idx`; `how` says whether a full suite passed its tree. Vouchers the stalk
 * now covers are dropped: beans at or below it, and sprout commits below it.
 */
export function onStalkMoved(state: V2State, idx: number, how: 'full' | 'evidence'): void {
  const evidence = state.evidence;
  if (evidence === undefined) return;
  if (how === 'full') {
    evidence.verifiedIdx = idx;
    evidence.unverified = evidence.unverified.filter((promoted) => promoted > idx);
  } else if (!evidence.unverified.includes(idx)) {
    evidence.unverified.push(idx);
  }
  for (const key of Object.keys(evidence.affected)) {
    if (Number(key) <= idx) delete evidence.affected[key];
  }
  pruneVouchers(state, idx);
  evidence.tried = null;
}

/**
 * A confirmed red audit moved the stalk back to `idx`: the sprout vouchers above it are dropped,
 * and the failing tests are never vouched for again (their read sets missed what broke them).
 */
export function onStalkDemoted(state: V2State, idx: number, failing: readonly string[]): void {
  const evidence = evidenceState(state);
  evidence.unverified = [];
  evidence.distrusted = [...new Set([...(evidence.distrusted ?? []), ...failing])].toSorted();
  for (const [key, voucher] of Object.entries(evidence.vouchers)) {
    if (voucher.kind === 'sprout' && voucher.base > idx) delete evidence.vouchers[key];
  }
  evidence.tried = null;
}

/** Whether the stalk's tree is not yet known to pass the full suite (an audit is owed). */
export function isStalkUnverified(state: V2State): boolean {
  const evidence = state.evidence;
  return evidence !== undefined && state.greenIdx > evidence.verifiedIdx;
}

/** The newest stalk commit a full suite passed, still on the stalk (-1: the base). */
export function verifiedIdx(state: V2State): number {
  return Math.min(state.evidence?.verifiedIdx ?? state.greenIdx, state.greenIdx);
}

/** The read sets of a green full check that may serve as evidence, or null. */
function usableReads(
  state: V2State,
  result: CheckResult,
): Record<string, readonly string[]> | null {
  const settings = state.settings.evidence;
  const passing = result.passingReadSets;
  if (settings === undefined || !result.green || passing === undefined) return null;
  if (settings.readSets === 'complete' && result.readSetsComplete !== true) return null;
  const tests = result.passingFiles ?? Object.keys(passing);
  // A test the check ran without reporting its read set is kept with an empty one (unknown): it
  // is one of the tree's tests, and no evidence can vouch for it.
  return Object.fromEntries(tests.map((test) => [test, passing[test] ?? []]));
}

function ruleOut(state: V2State, idx: number): RefusalReason | null {
  const commit = requireCommit(state, idx);
  if (
    activeTickets(state).length > 0 ||
    Object.keys(state.confirming).length > 0 ||
    knownRedFiles(state, commit.sha).length > 0
  ) {
    return 'known-red';
  }
  const vouchers = state.evidence?.vouchers ?? {};
  if (Object.keys(vouchers).length === 0) return 'no-read-sets';
  const isChecked = (landed: SproutCommit): boolean =>
    vouchers[landed.sha] !== undefined ||
    (landed.voucher !== undefined && vouchers[landed.voucher] !== undefined);
  for (const landed of state.commits.slice(state.greenIdx + 1, idx + 1)) {
    // A landing undone at or below `idx` is gone from its tree (its files and its revert's are
    // in every difference).
    if (landed.reverted && (landed.revertedAt ?? Infinity) <= idx) continue;
    if (landed.structural === true && vouchers[landed.sha] === undefined) return 'structural';
    if (landed.kind === 'task' && !isChecked(landed)) return 'unchecked-bean';
  }
  return null;
}

/**
 * The files that may differ between a voucher's tree and the sprout at `idx`: everything the
 * commits after its base changed, without the voucher's own landing (its checked content), and
 * the voucher's own change while that landing is not among them.
 */
function differenceTo(state: V2State, voucher: Voucher, idx: number): Difference {
  const files = new Set<string>();
  let isAnchor = voucher.kind === 'sprout';
  for (const landed of state.commits.slice(voucher.base + 1, idx + 1)) {
    if (
      voucher.kind === 'check' &&
      (landed.sha === voucher.sha || landed.voucher === voucher.sha)
    ) {
      isAnchor = true;
      continue;
    }
    for (const path of landed.files) files.add(path);
  }
  if (!isAnchor) for (const path of voucher.own) files.add(path);
  return { files: [...files].toSorted(), isAnchor };
}

/**
 * The tests of the sprout at `idx`. An anchor (a voucher whose tree differs from it only by sprout
 * commits: a sprout commit's, or a check whose bean landed in range) knows every test the commits
 * left alone; each test file a commit since changed is added. Tests of other vouchers' trees
 * that their difference leaves alone are there too. Null without an anchor: the tests are not
 * all known.
 */
function testsOf(
  state: V2State,
  idx: number,
  known: { vouchers: readonly Voucher[]; differences: ReadonlyMap<string, Difference> },
): string[] | null {
  const anchors = known.vouchers.filter(
    (voucher) => known.differences.get(voucher.sha)?.isAnchor === true,
  );
  if (anchors.length === 0) return null;
  const tests = new Set<string>();
  const named = new Set<string>();
  for (const voucher of known.vouchers) {
    const changed = new Set(known.differences.get(voucher.sha)?.files ?? []);
    for (const test of Object.keys(voucher.reads)) {
      named.add(test);
      if (!changed.has(test)) tests.add(test);
    }
  }
  const since = Math.min(...anchors.map((voucher) => voucher.base));
  for (const landed of state.commits.slice(since + 1, idx + 1)) {
    for (const path of landed.files) if (isRunnableTest(path) || named.has(path)) tests.add(path);
  }
  return [...tests].toSorted();
}

/** The changed files a test may observe: its reads, every-test files, other resolutions of its modules. */
function touched(test: string, reads: readonly string[], changed: readonly string[]): string[] {
  if (changed.length === 0) return [];
  const read = new Set([test, ...reads]);
  const modules = new Set([...read].map(moduleOf));
  return changed.filter(
    (path) => read.has(path) || GLOBAL_FILE.test(path) || modules.has(moduleOf(path)),
  );
}

/** A path without its module suffix: `src/a/index.ts` and `src/a.ts` are both `src/a`. */
function moduleOf(path: string): string {
  return path.replace(MODULE_SUFFIX, '');
}

function refused(idx: number, reason: RefusalReason): Evidence {
  return { idx, tests: [], vouched: {}, affected: [], trees: [], overlaps: [], refusal: reason };
}

function treeOf(voucher: Voucher, changed: readonly string[], vouched: number): EvidenceTree {
  return {
    task: voucher.task,
    sha: voucher.sha,
    base_idx: voucher.base,
    changed: changed.slice(0, LISTED),
    changed_count: changed.length,
    vouched,
  };
}

function sproutKey(idx: number): string {
  return `sprout:${idx}`;
}

function setSproutVoucher(
  state: V2State,
  idx: number,
  reads: Readonly<Record<string, number>>,
): void {
  const evidence = evidenceState(state);
  evidence.vouchers[sproutKey(idx)] = {
    sha: sproutKey(idx),
    kind: 'sprout',
    task: null,
    base: idx,
    own: [],
    reads: { ...reads },
  };
  evidence.tried = null;
}

/**
 * Drops what the stalk at `idx` covers: bean checks whose bean landed at or below it (or left the
 * sprout), and sprout vouchers below the stalk and the newest verified commit. Read sets no
 * voucher names any more are dropped too.
 */
function pruneVouchers(state: V2State, idx: number): void {
  const evidence = evidenceState(state);
  const keep = new Set([sproutKey(idx), sproutKey(evidence.verifiedIdx)]);
  const landedAbove = new Set(
    state.commits.slice(idx + 1).flatMap((landed) => [landed.sha, landed.voucher ?? '']),
  );
  for (const [key, voucher] of Object.entries(evidence.vouchers)) {
    const isStale =
      voucher.kind === 'sprout'
        ? !keep.has(key) && voucher.base < idx
        : !landedAbove.has(voucher.sha) && !isInFlight(state, voucher);
    if (isStale) delete evidence.vouchers[key];
  }
  compact(evidence);
}

/** A bean check whose bean is still on its way to the sprout (its newest check). */
function isInFlight(state: V2State, voucher: Voucher): boolean {
  return voucher.task !== null && state.landings[voucher.task]?.voucher === voucher.sha;
}

/** Interns each read set (sorted), reusing an equal one already stored. */
function intern(
  evidence: EvidenceState,
  reads: Readonly<Record<string, readonly string[]>>,
): Record<string, number> {
  const known = new Map(evidence.sets.map((set, index) => [set.join('\n'), index]));
  const out: Record<string, number> = {};
  for (const [test, set] of Object.entries(reads)) {
    if (set.length === 0) {
      out[test] = UNKNOWN_READS;
      continue;
    }
    const sorted = [...new Set(set)].toSorted();
    const key = sorted.join('\n');
    let index = known.get(key);
    if (index === undefined) {
      index = evidence.sets.length;
      evidence.sets.push(sorted);
      known.set(key, index);
    }
    out[test] = index;
  }
  return out;
}

/** Rebuilds the read-set table with only the sets a voucher or an affected run still names. */
function compact(evidence: EvidenceState): void {
  const used = new Set<number>();
  const holders = [
    ...Object.values(evidence.vouchers).map((voucher) => voucher.reads),
    ...Object.values(evidence.affected).map((run) => run.vouched),
  ];
  for (const reads of holders) for (const set of Object.values(reads)) if (set >= 0) used.add(set);
  if (used.size === evidence.sets.length) return;
  const remap = new Map<number, number>();
  const sets: string[][] = [];
  for (const index of [...used].toSorted((a, b) => a - b)) {
    remap.set(index, sets.length);
    sets.push(evidence.sets[index] ?? []);
  }
  const renumber = (reads: Readonly<Record<string, number>>): Record<string, number> =>
    Object.fromEntries(
      Object.entries(reads).map(([test, set]) => [
        test,
        set < 0 ? set : (remap.get(set) ?? UNKNOWN_READS),
      ]),
    );
  for (const [key, voucher] of Object.entries(evidence.vouchers)) {
    evidence.vouchers[key] = { ...voucher, reads: renumber(voucher.reads) };
  }
  for (const [key, run] of Object.entries(evidence.affected)) {
    evidence.affected[key] = { ...run, vouched: renumber(run.vouched) };
  }
  evidence.sets = sets;
}
