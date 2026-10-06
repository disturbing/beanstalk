/**
 * Culprit isolation, a simulation study (the 30-agent post-mortem, `docs/claude-opus/11`). It
 * does not run the engine: it models one red sprout episode at a time, with the engine's
 * timings, and plays each isolation strategy against it, so strategies the engine does not
 * have can be compared on the same cases. The engine's own bisect and lone-suspect paths are
 * measured on `burst30` directly (`v2-culprit-study.test.ts`).
 *
 * An episode: the window of unvalidated commits 1..W above the stalk (oldest first), a red
 * validation of the head, and a rule saying which test files fail for any set of commits
 * present. A commit's own acceptance test exists only while the commit is present, so a new
 * test that fails with a whole-suite break points at its author, as t022's and t009's did.
 */

/** Seconds of one CI run (75 s in `cf-demo-sonnet-30-s7`), of one sandbox probe or pre-land check (77 s). */
export const CI_SECONDS = 75;
export const SANDBOX_SECONDS = 77;
/** The committer's turn plus a revert or a reset job. */
export const REVERT_SECONDS = 5;
/** CI slots, shared with the queue's count (2). */
export const CI_SLOTS = 2;
/** Suites one CI slot runs at once when probes share it (the runner's four-at-a-time sandbox). */
export const SUITES_PER_SLOT = 4;

export type Episode = {
  readonly name: string;
  /** Unvalidated commits; commit i (1-based) adds `tests/c<i>.test.ts`. */
  readonly window: number;
  /** Failing test files with these commits present (base tests always exist). */
  readonly failing: (present: ReadonlySet<number>) => readonly string[];
  /** Commits whose files the failing tests read (the read-set suspects), best ranked first. */
  readonly suspects: readonly number[];
  /** Commits whose revert conflicts with what landed after them. */
  readonly unrevertable: readonly number[];
  /** The true culprits (reverting any of `fixesAlone` makes the head green; else all of them). */
  readonly culprits: readonly number[];
  /** When an outside fix lands (a bean fixing forward), seconds after the red is settled; null: never. */
  readonly outsideFixAt: number | null;
  /** The commit whose validation was red first (default: the head); later reds open nested tickets. */
  readonly firstRedAt?: number;
};

export type Outcome = {
  readonly strategy: string;
  readonly episode: string;
  /** Seconds from the settled red to the first culprit named (null: none named). */
  readonly isolate: number | null;
  /** Seconds from the settled red to a green sprout (null: never within the model). */
  readonly green: number | null;
  /** CI slot-seconds the isolation used (probes, re-validations). */
  readonly ciSeconds: number;
  /** Agent-sandbox seconds it used. */
  readonly sandboxSeconds: number;
  /** Innocent commits reverted (their beans dropped). */
  readonly wrongBlames: number;
  /** Beans reverted or sent back to land again. */
  readonly displaced: number;
  /** Bean-minutes the window's innocent beans wait to be green (dropped ones excluded). */
  readonly heldBeanMinutes: number | null;
};

type Probe = (present: ReadonlySet<number>) => boolean;

function range(from: number, to: number): number[] {
  return Array.from({ length: Math.max(0, to - from + 1) }, (_, index) => from + index);
}

function prefix(count: number): Set<number> {
  return new Set(range(1, count));
}

/** Whether `present` fails any of `files` (any failure when `files` is empty). */
function failsAny(episode: Episode, files: readonly string[]): Probe {
  return (present) => {
    const failing = episode.failing(present);
    return files.length === 0 ? failing.length > 0 : failing.some((path) => files.includes(path));
  };
}

/** K-ary first-bad search over prefixes (the engine's `first_bad`): rounds and the culprit. */
function firstBad(
  window: number,
  bad: Probe,
  k: number,
): { rounds: number; runs: number; idx: number } {
  let lo = 0;
  let hi = window;
  let rounds = 0;
  let runs = 0;
  while (hi - lo > 1) {
    const step = (hi - lo) / (k + 1);
    const points = [
      ...new Set(
        range(1, k).map((index) =>
          Math.min(hi - 1, Math.max(lo + 1, Math.round(lo + step * index))),
        ),
      ),
    ];
    rounds += 1;
    runs += points.length;
    const reds = points.filter((point) => bad(prefix(point)));
    const newHi = reds.length > 0 ? Math.min(...reds) : hi;
    const goods = points.filter((point) => point < newHi && !bad(prefix(point)));
    lo = Math.max(lo, ...goods);
    hi = newHi;
  }
  return { rounds, runs, idx: hi };
}

/**
 * The tickets one red opens today: what failed the first red validation (of the window up to
 * `firstRedAt`), then a nested ticket for what failed only later (new tests failing with the
 * suite), as R001 and R002 did in the real race.
 */
function ticketFiles(episode: Episode, present: ReadonlySet<number>): string[][] {
  const upTo = episode.firstRedAt ?? episode.window;
  const first = episode.failing(new Set([...present].filter((commit) => commit <= upTo)));
  const later = episode.failing(present).filter((path) => !first.includes(path));
  const tickets: string[][] = [];
  if (first.length > 0) tickets.push([...first]);
  if (later.length > 0) tickets.push([...later]);
  return tickets;
}

type Search = (
  episode: Episode,
  present: ReadonlySet<number>,
  files: readonly string[],
) => { seconds: number; ci: number; sandbox: number; culprit: number | null };

/** Today: K-ary bisect on the two CI slots. */
const bisect =
  (k: number, perRound: number): Search =>
  (episode, present, files) => {
    const live = [...present].toSorted((a, b) => a - b);
    const bad: Probe = (subset) =>
      failsAny(episode, files)(new Set(live.filter((_, index) => subset.has(index + 1))));
    const found = firstBad(live.length, bad, k);
    return {
      seconds: found.rounds * perRound,
      ci: found.runs * CI_SECONDS,
      sandbox: 0,
      culprit: live[found.idx - 1] ?? null,
    };
  };

/** Leave-one-out from the head over `order`, `width` at a time, `seconds` a round. */
const leaveOneOut =
  (
    orderOf: (episode: Episode, present: ReadonlySet<number>) => number[],
    width: number,
    onCi: boolean,
  ): Search =>
  (episode, present, files) => {
    const order = orderOf(episode, present);
    const fixes = (commit: number): boolean => {
      if (episode.unrevertable.includes(commit)) return false; // the probe cannot be built
      const without = new Set(present);
      without.delete(commit);
      return !failsAny(episode, files)(without);
    };
    const round = onCi ? CI_SECONDS : SANDBOX_SECONDS;
    for (let offset = 0; offset < order.length; offset += width) {
      const batch = order.slice(offset, offset + width);
      const hit = batch.find(fixes);
      const rounds = offset / width + 1;
      const runs = Math.min(order.length, offset + width);
      if (hit !== undefined) {
        return {
          seconds: rounds * round,
          ci: onCi ? runs * CI_SECONDS : 0,
          sandbox: onCi ? 0 : runs * SANDBOX_SECONDS,
          culprit: hit,
        };
      }
    }
    const rounds = Math.ceil(order.length / width);
    return {
      seconds: rounds * round,
      ci: onCi ? order.length * CI_SECONDS : 0,
      sandbox: onCi ? 0 : order.length * SANDBOX_SECONDS,
      culprit: null,
    };
  };

const newestFirst = (_episode: Episode, present: ReadonlySet<number>): number[] =>
  [...present].toSorted((a, b) => b - a);
const ranked = (episode: Episode, present: ReadonlySet<number>): number[] =>
  episode.suspects.filter((commit) => present.has(commit));

/** Read-set ranked probes, then today's bisect when none fixes it. */
const rankedThenBisect: Search = (episode, present, files) => {
  const probes = leaveOneOut(ranked, CI_SLOTS, true)(episode, present, files);
  if (probes.culprit !== null) return probes;
  const fallback = bisect(CI_SLOTS, CI_SECONDS)(episode, present, files);
  return { ...fallback, seconds: probes.seconds + fallback.seconds, ci: probes.ci + fallback.ci };
};

/** Lone suspect: revert at once when the read set names one commit, else bisect. */
const loneSuspect: Search = (episode, present, files) => {
  const live = ranked(episode, present);
  if (live.length === 1) return { seconds: 0, ci: 0, sandbox: 0, culprit: live[0] ?? null };
  return bisect(CI_SLOTS, CI_SECONDS)(episode, present, files);
};

/**
 * Revert-first with a search: flake re-run, tickets (nested ones too, as today), revert, a
 * validation; again while the head is red; the outside fix ends whatever is left.
 */
function revertFirst(
  strategy: string,
  search: Search,
  episode: Episode,
  options: { prefixFirstRound?: number } = {},
): Outcome {
  const present = new Set(range(1, episode.window));
  let clock = CI_SECONDS; // the flake re-run before the first ticket
  let ci = CI_SECONDS;
  let sandbox = 0;
  let isolate: number | null = null;
  let wrongBlames = 0;
  let displaced = 0;
  const tried = new Set<number>();
  for (let rounds = 0; rounds < 6 && episode.failing(present).length > 0; rounds += 1) {
    let reverted = false;
    for (const files of ticketFiles(episode, present)) {
      const found = search(episode, present, files);
      clock += found.seconds;
      ci += found.ci;
      sandbox += found.sandbox;
      if (found.culprit === null || tried.has(found.culprit)) continue;
      tried.add(found.culprit);
      isolate ??= clock;
      if (episode.unrevertable.includes(found.culprit)) continue;
      present.delete(found.culprit);
      reverted = true;
      displaced += 1;
      if (!episode.culprits.includes(found.culprit)) wrongBlames += 1;
      clock += REVERT_SECONDS;
    }
    if (!reverted) break;
    clock += CI_SECONDS; // the validation after the revert
    ci += CI_SECONDS;
  }
  const green = greenAfter(episode, present, clock);
  const innocents = [...present].filter((commit) => !episode.culprits.includes(commit));
  const greenAt = (commit: number): number | null =>
    options.prefixFirstRound !== undefined && commit < Math.min(...episode.culprits)
      ? options.prefixFirstRound
      : green;
  const held = innocents.map(greenAt);
  return {
    strategy,
    episode: episode.name,
    isolate,
    green,
    ciSeconds: ci,
    sandboxSeconds: sandbox,
    wrongBlames,
    displaced,
    heldBeanMinutes: held.includes(null)
      ? null
      : held.reduce<number>((sum, at) => sum + (at ?? 0), 0) / 60,
  };
}

/** When the sprout is green: now, after the outside fix and its validation, or never. */
function greenAfter(episode: Episode, present: ReadonlySet<number>, clock: number): number | null {
  if (episode.failing(present).length === 0) return clock;
  if (episode.outsideFixAt === null) return null;
  return Math.max(clock, episode.outsideFixAt) + CI_SECONDS;
}

/**
 * Revert-then-requeue:the sprout goes back to the last green commit at once (a reset never
 * conflicts), and every bean of the window lands again through its pre-land check (in its
 * sandbox), which names the culprit there. Nothing is dropped.
 */
function revertThenRequeue(episode: Episode): Outcome {
  const greenAgain = REVERT_SECONDS;
  // Innocent beans re-check (in parallel, in their sandboxes), land again and are validated.
  const innocentGreen = REVERT_SECONDS + SANDBOX_SECONDS + CI_SECONDS;
  const innocents = range(1, episode.window).filter((commit) => !episode.culprits.includes(commit));
  return {
    strategy: 'revert-then-requeue the red window',
    episode: episode.name,
    isolate: REVERT_SECONDS + SANDBOX_SECONDS,
    green: greenAgain,
    ciSeconds: 0,
    sandboxSeconds: episode.window * SANDBOX_SECONDS,
    wrongBlames: 0,
    displaced: episode.window,
    heldBeanMinutes: (innocents.length * innocentGreen) / 60,
  };
}

/** Every strategy of the study on one episode. */
export function studyEpisode(episode: Episode): Outcome[] {
  const ciK = CI_SLOTS;
  return [
    revertFirst("today's bisect (2 CI probes a round)", bisect(ciK, CI_SECONDS), episode),
    revertFirst('lone-suspect revert, else bisect', loneSuspect, episode),
    revertFirst('read-set ranked leave-one-out on CI', rankedThenBisect, episode),
    revertFirst('leave-one-out, newest first, on CI', leaveOneOut(newestFirst, ciK, true), episode),
    revertFirst(
      'bisect, 8 probes a round in the same 2 slots',
      bisect(CI_SLOTS * SUITES_PER_SLOT, CI_SECONDS),
      episode,
    ),
    revertFirst(
      'leave-one-out in agent sandboxes (all at once)',
      leaveOneOut(newestFirst, episode.window, false),
      episode,
    ),
    revertFirst("today's bisect + prefix promotion", bisect(ciK, CI_SECONDS), episode, {
      // A green probe promotes its prefix: the beans below the culprit at the first round.
      prefixFirstRound: 2 * CI_SECONDS,
    }),
    revertThenRequeue(episode),
  ];
}

// ---- The episodes ----

const testOf = (commit: number): string => `tests/c${commit}.test.ts`;
const ownTests = (present: ReadonlySet<number>): string[] => [...present].map(testOf);

/** One culprit breaks one module test; its read set names it alone. */
export const LONE: Episode = {
  name: 'one culprit, read set names it alone',
  window: 8,
  failing: (present) => (present.has(5) ? ['src/billing/billing.test.ts'] : []),
  suspects: [5],
  unrevertable: [],
  culprits: [5],
  outsideFixAt: null,
};

/** One culprit; three commits wrote what the failing test reads (the culprit ranked second). */
export const AMBIGUOUS: Episode = {
  name: 'one culprit among three read-set suspects',
  window: 8,
  failing: (present) => (present.has(3) ? ['src/orders/orders.test.ts'] : []),
  suspects: [6, 3, 7],
  unrevertable: [],
  culprits: [3],
  outsideFixAt: null,
};

/**
 * `cf-demo-sonnet-30-s7` (and `burst30`): t010 (commit 1, with t011 in the base) breaks the
 * whole suite, new tests included; t007 (commit 6) edited the same migration index, so
 * t010's revert conflicts. Every commit wrote something the suite reads. t026 fixes it
 * forward 15.5 minutes after the red settled (it landed at 26.7; the red settled at 11.2).
 */
export const WHOLE_SUITE_UNREVERTABLE: Episode = {
  name: 'whole-suite break, culprit unrevertable (the real stall)',
  window: 6,
  failing: (present) =>
    present.has(1) ? ['src/app.test.ts', 'src/billing/billing.test.ts', ...ownTests(present)] : [],
  suspects: [6, 5, 4, 3, 2, 1],
  unrevertable: [1],
  culprits: [1],
  outsideFixAt: 15.5 * 60,
  firstRedAt: 3,
};

/** The same break with a clean revert: what the engine expects. */
export const WHOLE_SUITE: Episode = {
  ...WHOLE_SUITE_UNREVERTABLE,
  name: 'whole-suite break, culprit revertable',
  unrevertable: [],
  outsideFixAt: null,
};

/** Two commits break a test only together (t010 with t011): reverting either fixes it. */
export const AND_PAIR: Episode = {
  name: 'two culprits together (either revert fixes)',
  window: 8,
  failing: (present) => (present.has(2) && present.has(7) ? ['src/db/db.test.ts'] : []),
  suspects: [7, 2],
  unrevertable: [],
  culprits: [2, 7],
  outsideFixAt: null,
};

/**
 * Two commits each break the same test alone (t005 and t033 under t032's test): reverting one
 * leaves it red, and leave-one-out confirms neither.
 */
export const OR_PAIR: Episode = {
  name: 'two culprits each alone (t005 + t033 style)',
  window: 8,
  failing: (present) => (present.has(2) || present.has(6) ? ['src/shipping/shipping.test.ts'] : []),
  suspects: [6, 2],
  unrevertable: [],
  culprits: [2, 6],
  outsideFixAt: null,
};

export const EPISODES: readonly Episode[] = [
  LONE,
  AMBIGUOUS,
  WHOLE_SUITE,
  WHOLE_SUITE_UNREVERTABLE,
  AND_PAIR,
  OR_PAIR,
];
