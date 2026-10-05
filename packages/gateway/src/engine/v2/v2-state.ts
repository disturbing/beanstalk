/**
 * The state of the v2 policy (plan §6, v2.2): beans land on the sprout after a pre-land
 * check, the sprout is validated asynchronously and promoted to the stalk, red validations
 * are reverted. Field names follow `policy_beanstalk*.py` where the harness has one.
 */
import type { Sha, SlotId, TaskId } from '@beanstalk/shared-race/ids';

import type { StepContext } from '../context';
import type { CheckResult, CiId, JobId, Seconds, TimerId } from '../model';
import type { CulpritContext } from '../prompts';

/** One commit on the sprout (`TrunkCommit`): a landed bean or a revert. */
export type SproutCommit = {
  idx: number;
  sha: Sha;
  parent: Sha;
  kind: 'task' | 'revert';
  task: TaskId | null;
  /** The repair ticket (or decision card) a revert answers. */
  ticket: string | null;
  files: string[];
  landedAt: Seconds;
  reverted: boolean;
  /** The sprout index of the revert that undid it. */
  revertedAt?: number;
};

export type TicketStatus = 'bisecting' | 'open' | 'reverting' | 'reverted' | 'escalated' | 'closed';

/** A red validation's repair ticket (`Ticket`). v2 never sends a fixer: it reverts. */
export type Ticket = {
  id: string;
  openedAt: Seconds;
  redSha: Sha;
  redIdx: number;
  failingFiles: string[];
  failingTests: string[];
  output: string;
  suspects: number[];
  concurrent: number[];
  method: 'read-set' | 'bisect';
  attempt: number;
  status: TicketStatus;
  revertIdx: number | null;
  closedAt: Seconds | null;
  closedHow: string | null;
  /** v2.3: opened from inherited pre-land reds, before any validation (`early_tickets`). */
  early: boolean;
};

/** `first_bad`: a K-ary search over sprout indexes (`lo` good, `hi` bad) with CI probes. */
export type FirstBadSearch = {
  lo: number;
  hi: number;
  files: string[];
  points: number[];
  /** Probes still running: CI run → sprout index. */
  probes: Record<string, number>;
  /** Whether each probed index failed the ticket's tests. */
  bad: Record<string, boolean>;
};

/** One `leave_one_out` probe: the sprout head without one unvalidated commit. */
export type LeaveOneOutProbe = {
  commit: number;
  /** The probe commit; null while the runner builds it, or when the revert conflicted. */
  sha: Sha | null;
  isBuilt: boolean;
  ciId: CiId | null;
  result: CheckResult | null;
};

/** `revert_culprit`: find the culprit, then revert it on the sprout in the turn. */
export type RevertFlow =
  | { phase: 'bisect'; search: FirstBadSearch }
  | {
      phase: 'leave-one-out';
      /** `first_bad`'s answer, kept for `ticket.stuck` / `ticket.culprit`. */
      idx: number;
      head: Sha;
      candidates: number[];
      offset: number;
      probes: LeaveOneOutProbe[];
    }
  | { phase: 'queued'; idx: number; target: number }
  | { phase: 'revert'; target: number; head: Sha; jobId: JobId }
  | { phase: 'publish'; target: number; head: Sha; sha: Sha; files: string[]; jobId: JobId };

/** Work a bean needs an agent for. With `release_on_check` it waits for a free slot. */
export type AgentWork =
  | { readonly kind: 'conflict'; readonly head: Sha; readonly files: readonly string[] }
  | {
      readonly kind: 'informed';
      readonly head: Sha;
      readonly red: CheckResult;
      readonly culprits: readonly TaskId[];
      readonly diffs: Readonly<Record<string, string>>;
    }
  | {
      /** v2.4: reconcile the bean's tests with the landed parties' before a card. */
      readonly kind: 'reconcile';
      readonly against: TaskId;
      /** v2.5: every landed task in the reconcile, `against` first (v2.4: `against` alone). */
      readonly parties: readonly TaskId[];
      readonly red: CheckResult;
      readonly head: Sha;
    }
  | { readonly kind: 'author'; readonly card: string }
  | { readonly kind: 'reexec'; readonly card: string }
  | { readonly kind: 'adopt'; readonly card: string };

/** Where a bean is in its landing loop (`land` + `try_optimistic`) or in a decision. */
export type LandingStep =
  | { kind: 'squash'; head0: Sha; jobId: JobId }
  | {
      kind: 'check';
      /** Inside the turn (the locked fallback, or `preland_mode: locked`). */
      isInTurn: boolean;
      /** A re-check after the sprout moved under an overlapping change (`recheck: sampled` counts it). */
      isRecheck: boolean;
      head0: Sha;
      candidate: Sha;
      files: string[];
      mine: string[] | null;
      jobId: JobId | null;
      startedAt: Seconds;
      result: CheckResult | null;
    }
  | {
      /** Checked green outside the turn; waiting for it to land. */
      kind: 'queued-land';
      head0: Sha;
      candidate: Sha;
      files: string[];
      mine: string[] | null;
    }
  /** Waiting for the turn to squash and check inside it. */
  | { kind: 'queued-locked' }
  /** The check failed only with the sprout's own reds (`inherited_reds`): wait for it to move. */
  | { kind: 'inherited'; head: Sha; failing: string[] }
  /** v2.3: green, waiting for room in the sprout window (`land` null: the locked path). */
  | {
      kind: 'window-wait';
      land: { head0: Sha; candidate: Sha; files: string[]; mine: string[] | null } | null;
    }
  | { kind: 'resquash'; head0: Sha; head: Sha; candidate: Sha; mine: string[] | null; jobId: JobId }
  | {
      /** The `hunk` rule: comparing the lines the bean and the meanwhile landings changed. */
      kind: 'hunks';
      head0: Sha;
      head: Sha;
      sha: Sha;
      files: string[];
      landedMeanwhile: number;
      jobId: JobId;
    }
  | { kind: 'locked-squash'; head: Sha; jobId: JobId }
  | { kind: 'publish'; head: Sha; sha: Sha; files: string[]; jobId: JobId }
  | {
      kind: 'diffs';
      head: Sha;
      red: CheckResult;
      culprits: TaskId[];
      /** Diff text by culprit, filled as the diff jobs return. */
      diffs: Record<string, string>;
    }
  | { kind: 'awaiting-agent'; work: AgentWork }
  | { kind: 'rework'; reason: 'conflict' | 'preland-red' | 'decision' }
  /** Waiting for a decision card's answer. */
  | { kind: 'decision'; card: string }
  /** v2.4: a test author reconciles the bean's tests with `against`'s, then reads what changed. */
  | { kind: 'reconciling'; against: TaskId; parties: TaskId[]; red: CheckResult; head: Sha }
  | {
      kind: 'reconcile-reading';
      against: TaskId;
      parties: TaskId[];
      red: CheckResult;
      head: Sha;
      inv: string;
      reason: string;
      before: Record<string, string>;
      jobId: JobId;
    }
  /** A decided card's pipeline: the winner's diff, the author, its files, the fail-first proof. */
  | { kind: 'card-context'; card: string; jobId: JobId }
  | { kind: 'authoring'; card: string }
  | { kind: 'reading'; card: string; head: Sha; jobId: JobId }
  | {
      kind: 'fail-first';
      card: string;
      changed: Record<string, string>;
      jobId: JobId | null;
      startedAt: Seconds;
      result: CheckResult | null;
    };

/** A bean between its first commit and its landing (or drop). */
export type LandingFlow = {
  task: TaskId;
  /** The slot that last worked on the bean (its author); preferred for its reworks. */
  slot: SlotId;
  /** Failed attempts so far (`rounds`): conflicts and red checks. */
  rounds: number;
  /** Re-checks in this attempt after the sprout moved under an overlapping change. */
  rechecks: number;
  /** Red checks waited out as the sprout's (`inherited_reds`); at most three per bean. */
  inheritedWaits: number;
  step: LandingStep;
};

/** How a decided card changes the beans (`decision_outcome: reexecute`, E6). */
export type CardOutcome = 'declined' | 'keep-landed' | 'adopt-in-place';

/** The test author's result for a card. */
export type Amendment = {
  status: 'amended' | 'none' | 'rejected';
  /** Amended contents by path (empty unless amended). */
  files: Record<string, string>;
  /** The author's commit (`beans/<loser>`): an in-place amendment is merged from it. */
  head: Sha | null;
};

/** A spec decision between an arriving bean and a landed one (idea 8, E6). */
export type DecisionCard = {
  id: string;
  /** The arriving bean whose pre-land check stayed red. */
  task: TaskId;
  against: TaskId[];
  specs: Record<string, string>;
  openedAt: Seconds;
  status: 'open' | 'decided' | 'done';
  /** The oracle's timer (oracle mode), or the human timeout's (human mode). */
  timerId: TimerId | null;
  /** The red pre-land check that raised the card. */
  red: { head: Sha; failing: string[]; output: string };
  winner: string | null;
  loser: TaskId | null;
  outcome: CardOutcome | null;
  text: string | null;
  by: 'oracle' | 'human' | 'human-timeout' | null;
  /** The tree the test author worked on (the loser's snapshot). */
  snapshot: Sha | null;
  winnerContext: CulpritContext | null;
  amendment: Amendment | null;
};

/** An in-place amendment a winner carries until it lands (then it is the loser's spec). */
export type CarriedAmendment = {
  card: string;
  loser: TaskId;
  files: Record<string, string>;
  /** The loser's effective tests before, for a rollback when the winner is dropped. */
  before: Record<string, string>;
  /** The author's commit the winner merges. */
  head: Sha;
};

/** Who holds the single-writer turn (the harness's committer lock). */
export type TurnHolder =
  | { readonly kind: 'landing'; readonly task: TaskId }
  | { readonly kind: 'revert'; readonly ticket: string };

/** The turn and the FIFO of those waiting for it (asyncio.Lock is FIFO). */
export type Turn = { holder: TurnHolder | null; queue: TurnHolder[] };

/** The stalk ref follows the newest validated commit through serialized ref updates. */
export type StalkSync = {
  /** Where the stalk ref points (as last confirmed by the runner). */
  pushed: Sha;
  /** The newest validated commit; the ref follows it. */
  target: Sha;
  inFlight: { jobId: JobId; sha: Sha } | null;
};

/** What a runner job or CI run of the policy feeds when it returns. */
export type V2Wait =
  | { readonly kind: 'landing'; readonly task: TaskId }
  | { readonly kind: 'diff'; readonly task: TaskId; readonly culprit: TaskId }
  | { readonly kind: 'validate'; readonly idx: number }
  | { readonly kind: 'confirm'; readonly idx: number }
  | { readonly kind: 'probe'; readonly ticket: string }
  | { readonly kind: 'loo-revert'; readonly ticket: string; readonly commit: number }
  | { readonly kind: 'loo-check'; readonly ticket: string; readonly commit: number }
  | { readonly kind: 'ticket-revert'; readonly ticket: string }
  | { readonly kind: 'card'; readonly card: string }
  | { readonly kind: 'stalk' };

export type CardDetail = {
  card: string;
  task: string;
  against: string[];
  winner: string;
  specs: Record<string, string>;
};

/** The harness's `stats` dict, in its key order (`policy_beanstalk*.py`), then v2.2's. */
export type V2Stats = {
  placements_disjoint: number;
  placements_overlap: number;
  placement_overlap_modules: number;
  landings: number;
  fixer_landings: number;
  reverts: number;
  validations: number;
  validations_green: number;
  validations_red: number;
  stale_reds: number;
  tickets: number;
  tickets_closed: number;
  tickets_escalated: number;
  tickets_by_method: Record<string, number>;
  suspects_per_ticket: number[];
  trunk_bisect_runs: number;
  pauses: number;
  paused_seconds: number;
  fixers_without_change: number;
  preland_checks: number;
  preland_red: number;
  preland_seconds: number;
  preland_reworks: number;
  preland_drops: number;
  preland_optimistic_landings: number;
  preland_rechecks: number;
  preland_locked_fallbacks: number;
  preland_skipped_rechecks: number;
  preland_hunk_disjoint: number;
  preland_hunk_overlap: number;
  informed_reworks: number;
  cards: number;
  card_details: CardDetail[];
  revert_first: number;
  agent_waits: number;
  agent_wait_seconds: number;
  validation_reruns: number;
  flakes_suspected: number;
  amendments: number;
  amendments_none: number;
  amendments_rejected: number;
  amendments_rolled_back: number;
  reexecutions: number;
  adoptions_in_place: number;
  inherited_reds: number;
  window_waits: number;
  recheck_samples: number;
  early_tickets: number;
  confirmed_by_sighting: number;
  reconciles: number;
  reconciled: number;
  contradictions: number;
  stale_rechecks: number;
  /** v2.5: beans dropped still red against a counterpart already reconciled and decided. */
  stuck_drops: number;
};

/** The v2.2 rules as the run uses them (the summary and the view report them). */
export type V2Settings = {
  readonly recheck: 'file' | 'never' | 'hunk' | 'adaptive' | 'sampled';
  readonly recheckFallback: 'file' | 'hunk';
  readonly window: 'aimd' | 'off';
  readonly releaseOnCheck: boolean;
  readonly flakeConfirm: boolean;
  readonly inheritedReds: 'readset' | 'validation' | 'off';
  readonly earlyTickets: boolean;
  readonly reconcile: boolean;
  /** v2.5: failed informed repairs against one counterpart before escalating (2: v2.4). */
  readonly escalateAfter: number;
  /** v2.5: landed tasks a reconcile takes in (1: v2.4). */
  readonly reconcileParties: number;
  readonly decisionOutcome: 'reexecute' | 'decline';
  readonly decisionMode: 'oracle' | 'human';
};

export type V2State = {
  kind: 'beanstalk-v2';
  /** `PRELAND_MODE` and `PRELAND_SECONDS` as the run uses them (the summary reports both). */
  prelandMode: 'optimistic' | 'locked';
  prelandLatency: number;
  settings: V2Settings;
  /** The sprout head (`self.trunk`). */
  sprout: Sha;
  /** The newest validated commit (`self.green`). */
  green: Sha;
  greenIdx: number;
  commits: SproutCommit[];
  /** Sprout index of each landed commit; the base is -1 (`sha_idx`). */
  shaIdx: Record<string, number>;
  validating: number[];
  validated: Record<string, boolean>;
  /** Red validations waiting for their confirming re-run, by sprout index. */
  confirming: Record<string, CheckResult>;
  /** Files that failed a validation (a first run or its re-run), by sprout index. */
  redValidations: Record<string, string[]>;
  /** Inherited pre-land reds by sprout index and failing file: the beans that saw them. */
  sightings: Record<string, Record<string, string[]>>;
  /** v2.3's sprout window: its size, and the green beans waiting for room (oldest first). */
  window: { size: number; waiting: TaskId[] };
  /** `recheck: sampled`: re-checking or skipping, the green re-checks in a row, the skips. */
  recheckMeter: { mode: 'checking' | 'skipping'; greenStreak: number; skips: number };
  /** Tests suspected flaky this run (a red that did not repeat), with how often. */
  flakes: Record<string, number>;
  tickets: Record<string, Ticket>;
  ticketSeq: number;
  /** Tickets without a read-set suspect, bisecting the unvalidated range. */
  bisects: Record<string, FirstBadSearch>;
  reverts: Record<string, RevertFlow>;
  unstarted: TaskId[];
  landings: Record<string, LandingFlow>;
  /** Beans waiting for a free agent (release on check), in arrival order. */
  agentQueue: TaskId[];
  /** When each waiting bean started to wait. */
  agentWaitSince: Record<string, Seconds>;
  /** The last pre-land check outcomes (green = true), for the `adaptive` re-check. */
  recentChecks: boolean[];
  /** Red pre-land checks per (arriving bean, landed culprit): `pair_reds`. */
  pairReds: Record<string, number>;
  /** Pairs a card already decided (never asked twice), with the card. */
  decidedPairs: Record<string, string>;
  /** v2.4: pairs already reconciled once (a second stuck red goes to a card). */
  reconciledPairs: Record<string, boolean>;
  /**
   * v2.5 (`escalate_after: 1`): per pair, the failing files of its last red and how many reds
   * in a row repeated a failing file of the one before; reset when a card decides the pair.
   */
  pairRepeats: Record<string, { files: string[]; repeats: number; decided: boolean }>;
  cards: Record<string, DecisionCard>;
  cardSeq: number;
  /** The card of each running test-author invocation. */
  authors: Record<string, string>;
  /** In-place amendments each winner carries until it lands. */
  carried: Record<string, CarriedAmendment[]>;
  turn: Turn;
  stalk: StalkSync;
  waits: Record<string, V2Wait>;
  stuckLogged: boolean;
  stats: V2Stats;
};

/**
 * Continuations across v2's modules, bound by the policy for each step so the modules
 * never import each other in a cycle.
 */
export type V2Flow = {
  /** The turn passed to `holder`: its owner continues. */
  readonly granted: (holder: TurnHolder) => void;
  /** A bean starts its next landing attempt. */
  readonly attempt: (task: TaskId) => void;
  /** A slot was found for a bean's awaited work: start it there. */
  readonly startWork: (flow: LandingFlow, slot: SlotId) => void;
};

/** One step of the v2 policy: the engine context, the policy's draft state, the continuations. */
export type V2Step = {
  readonly ctx: StepContext;
  readonly state: V2State;
  readonly flow: V2Flow;
};
