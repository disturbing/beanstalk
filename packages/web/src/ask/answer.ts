/**
 * An answer: the explorer's fixed layout, configured for one question. Pages render it;
 * nothing in it is layout, only data and the choice of panels.
 */
import type { Sha, TaskId } from '@beanstalk/shared-race/ids';

import type { BeanDetail, BeanRecord, DecisionRecord, TestRecord } from '../forge/forge-source';
import type { BatchId, TicketId } from '../race/race-events';
import type { BeanStep, Lane, PolicyKind } from '../race/race-state';
import type { RepoDiff, RepoFile } from '../repo/repo-types';
import type { ClassifierName } from './classifier';
import type { MatchReason, RankedFile } from './resolve-files';
import type { LineRef, ViewConfig, ViewSpec } from './view-spec';

export type ChipKind = 'feature' | 'range' | 'agent' | 'bean' | 'path' | 'file';

/** A parsed part of the question, shown as a filter the user can remove. */
export type Chip = {
  /** The `x=` value that removes it. */
  readonly id: string;
  readonly kind: ChipKind;
  readonly label: string;
};

export type FileBadges = {
  /** Line commits in the range that changed the file. */
  readonly changes: number;
  /** Beans in flight that touch it. */
  readonly inFlight: number;
  /** Failing tests that are, or cover, the file. */
  readonly red: number;
  readonly decisions: number;
  /** Why the resolver matched it, when a feature was asked. */
  readonly reasons: readonly MatchReason[];
};

export type TreeModel = {
  readonly mode: 'full' | 'filtered';
  readonly files: readonly string[];
  readonly badges: Readonly<Record<string, FileBadges>>;
  /** Files the answer is about (highlighted in a full tree). */
  readonly matched: readonly string[];
};

/** Which bean last changed each line of a file. */
export type BlameLine = { readonly task: TaskId | null; readonly idx: number | null };

export type MainPane =
  | {
      readonly kind: 'diff';
      readonly title: string;
      readonly diff: RepoDiff;
      readonly fromLabel: string;
      readonly toLabel: string;
    }
  | {
      readonly kind: 'file';
      readonly title: string;
      readonly file: RepoFile;
      /** New-side lines changed in the question's range. */
      readonly highlights: readonly number[];
      readonly blame: readonly BlameLine[] | null;
    }
  | { readonly kind: 'bean'; readonly bean: BeanDetail; readonly diff: RepoDiff | null }
  | { readonly kind: 'beans'; readonly title: string; readonly beans: readonly BeanRecord[] }
  | { readonly kind: 'empty'; readonly title: string; readonly message: string };

export type RedRun = {
  readonly ci: string;
  readonly t: number;
  readonly purpose: string;
  readonly subject: string;
  readonly failingFiles: readonly string[];
  readonly failingTests: readonly string[];
};

export type RedCheck = {
  readonly bean: TaskId;
  readonly t: number;
  readonly detail: string;
};

export type RepairTicket = {
  readonly ticket: TicketId;
  readonly redIdx: number;
  readonly status: string;
  readonly culprit: TaskId | null;
  readonly failing: readonly string[];
};

export type QueueCulprit = {
  readonly batch: BatchId;
  readonly culprit: TaskId;
  readonly t: number;
};

export type RailBlock =
  | { readonly kind: 'beans'; readonly title: string; readonly beans: readonly BeanRecord[] }
  | { readonly kind: 'decisions'; readonly cards: readonly DecisionRecord[] }
  | { readonly kind: 'tests'; readonly tests: readonly TestRecord[] }
  | { readonly kind: 'agents'; readonly lanes: readonly Lane[]; readonly now: number }
  | {
      readonly kind: 'red';
      readonly runs: readonly RedRun[];
      readonly checks: readonly RedCheck[];
      readonly tickets: readonly RepairTicket[];
      readonly culprits: readonly QueueCulprit[];
    }
  | {
      readonly kind: 'promotion';
      readonly beans: readonly BeanRecord[];
      readonly validating: { readonly idx: number | null; readonly startedAt: number } | null;
      readonly ciSeconds: number;
      readonly now: number;
    }
  | { readonly kind: 'checks'; readonly bean: TaskId; readonly steps: readonly BeanStep[] };

export type Answer = {
  readonly question: string;
  readonly spec: ViewSpec;
  readonly view: ViewConfig;
  readonly classifiedBy: ClassifierName;
  readonly chips: readonly Chip[];
  readonly ref: { readonly name: LineRef; readonly sha: Sha };
  readonly policy: PolicyKind | null;
  /** The race second the answer describes (the end of a recorded run, or now). */
  readonly at: number;
  readonly fileSet: readonly RankedFile[];
  readonly tree: TreeModel;
  readonly main: MainPane;
  readonly rail: readonly RailBlock[];
  readonly headline: string;
};
