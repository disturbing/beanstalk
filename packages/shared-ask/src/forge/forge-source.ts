/**
 * The data adapter the web app codes against: everything it reads about a run and its repo,
 * and the one command it sends (a decision). Two implementations:
 * - `gatewaySource`: RPC over the GATEWAY service binding (live runs);
 * - `recordedSource`: the bundled recorded runs, optionally as of a moment of the race.
 *
 * The method names follow the gateway's "RPC for the web app" (docs/claude-opus/31-gateway-engine-internals.md).
 */
import type { RunId, Sha, SlotId, TaskId } from '@gitstalk/shared-race/ids';

import type { CardId, RaceEvent } from '../race/race-events';
import type {
  BeanPhase,
  BeanStep,
  DecisionCard,
  PolicyKind,
  RaceOptions,
} from '../race/race-state';
import type {
  GrepMatch,
  RefName,
  RepoCommit,
  RepoDiff,
  RepoFile,
  RepoTree,
} from '../repo/repo-types';

export type RunPhase = 'created' | 'running' | 'finishing' | 'done';

export type RunListing = {
  readonly run: RunId;
  readonly source: 'recorded' | 'live';
  readonly label: string;
  readonly policy: PolicyKind;
  readonly phase: RunPhase;
  readonly agents: number;
  readonly model: string | null;
  readonly createdAt: string | null;
  readonly beans: number;
  readonly green: number;
  readonly costUsd: number;
};

export type EventsPage = {
  readonly events: readonly RaceEvent[];
  /** Pass as `after` for the next page. */
  readonly nextAfter: number;
  /** The run is over and this page reached the end of its log. */
  readonly done: boolean;
};

/** Where a bean stands, as the explorer's badges and timelines show it. */
export type BeanStatus =
  | 'pending'
  | 'in-flight'
  | 'landed'
  | 'green'
  | 'reverted'
  | 'dropped'
  /** v2 `park`: it needs a person. */
  | 'parked';

export type BeanRecord = {
  readonly id: TaskId;
  readonly title: string;
  /** The task prompt: what the bean is for. */
  readonly intent: string;
  readonly status: BeanStatus;
  readonly phase: BeanPhase;
  readonly agent: SlotId | null;
  /** Files the bean itself changes. */
  readonly files: readonly string[];
  readonly startedAt: number | null;
  readonly landedAt: number | null;
  readonly landedIdx: number | null;
  readonly greenAt: number | null;
  readonly reworks: number;
  readonly card: CardId | null;
  readonly costUsd: number;
};

export type BeanDetail = BeanRecord & {
  /** The bean's own acceptance tests. */
  readonly tests: readonly string[];
  readonly steps: readonly BeanStep[];
  readonly head: Sha | null;
  /** Diff `diffBase..head` for the bean's own change (its landing, or its latest head). */
  readonly diffBase: Sha | null;
  readonly diffHead: Sha | null;
  readonly checks: number;
  readonly redChecks: number;
  readonly conflicts: number;
  readonly lastMessage: string;
  readonly dropReason: string | null;
};

export type DecisionRecord = DecisionCard & {
  /** Files the beans of the card change. */
  readonly files: readonly string[];
};

export type TestRun = {
  readonly t: number;
  readonly green: boolean;
  /** `validate` (sprout), `batch` (queue), `preland` (a bean's check), `bisect`. */
  readonly kind: string;
  readonly subject: string;
};

export type TestRecord = {
  readonly path: string;
  /** Source files the test imports, directly or not. */
  readonly covers: readonly string[];
  /** The bean whose acceptance test it is, if any. */
  readonly owner: TaskId | null;
  readonly state: 'pass' | 'fail' | 'unknown';
  readonly history: readonly TestRun[];
};

export type DecideOutcome =
  | { readonly ok: true }
  | {
      readonly ok: false;
      readonly code:
        | 'unknown_card'
        | 'invalid_winner'
        | 'invalid_state'
        | 'read_only'
        | 'unavailable';
      readonly message: string;
    };

/** A person's answer to a decision card. */
export type DecisionAnswer = {
  readonly winner: TaskId;
  /** Who decided (a handle); the log records `human:<actor>`. */
  readonly actor: string;
  /** The decision in one line: what the test author and the re-executed bean read (v2.2). */
  readonly text?: string;
};

export interface ForgeSource {
  listRuns(): Promise<readonly RunListing[]>;
  /** The engine's knobs no event states (v2.2's agent release), from the run's view. */
  runOptions(run: RunId): Promise<RaceOptions>;
  runEvents(run: RunId, after: number, limit: number): Promise<EventsPage>;
  repoTree(run: RunId, ref: RefName): Promise<RepoTree>;
  repoFile(run: RunId, ref: RefName, path: string): Promise<RepoFile | undefined>;
  repoDiff(run: RunId, from: RefName, to: RefName, paths?: readonly string[]): Promise<RepoDiff>;
  repoLog(
    run: RunId,
    ref: RefName,
    options?: { readonly paths?: readonly string[]; readonly limit?: number },
  ): Promise<readonly RepoCommit[]>;
  repoGrep(
    run: RunId,
    ref: RefName,
    pattern: string,
    paths?: readonly string[],
  ): Promise<readonly GrepMatch[]>;
  /** Beans that touch any of `paths`; every bean of the run when `paths` is empty. */
  beansByPath(run: RunId, paths: readonly string[]): Promise<readonly BeanRecord[]>;
  beanDetail(run: RunId, bean: TaskId): Promise<BeanDetail | undefined>;
  decisions(run: RunId, paths?: readonly string[]): Promise<readonly DecisionRecord[]>;
  testsFor(run: RunId, paths: readonly string[]): Promise<readonly TestRecord[]>;
  decide(run: RunId, card: CardId, answer: DecisionAnswer): Promise<DecideOutcome>;
}
