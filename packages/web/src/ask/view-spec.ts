/**
 * A question becomes a view spec, not a generated layout (`docs/claude-opus/13` §2): a class
 * from a fixed catalog, the entities it names, a range and a ref. The catalog decides how
 * the explorer is arranged for each class; nothing writes layout at runtime.
 */
import { z } from 'zod';

import { TaskId } from '@beanstalk/shared-race/ids';

export const QUESTION_CLASSES = [
  'recent-changes',
  'who-why',
  'in-flight',
  'what-broke',
  'pending-promotion',
  'decisions',
  'tests-for',
  'agent-activity',
  'bean',
  'explore',
] as const;

export const QuestionClass = z.enum(QUESTION_CLASSES);
export type QuestionClass = z.infer<typeof QuestionClass>;

export const LineRef = z.enum(['sprout', 'stalk']);
export type LineRef = z.infer<typeof LineRef>;

export const AgentSlot = z.string().regex(/^a\d{1,2}$/);

export const ViewSpec = z.strictObject({
  class: QuestionClass,
  entities: z.strictObject({
    feature: z.string().trim().min(1).max(80).nullable(),
    paths: z.array(z.string().min(1).max(300)).max(10),
    agent: AgentSlot.nullable(),
    bean: TaskId.nullable(),
  }),
  range: z.strictObject({
    /** Only what landed in the last N minutes; null is the whole run. */
    minutes: z
      .number()
      .int()
      .positive()
      .max(7 * 24 * 60)
      .nullable(),
    ref: LineRef,
  }),
});
export type ViewSpec = z.infer<typeof ViewSpec>;

export type TreeMode = 'full' | 'filtered';
export type MainView = 'file' | 'diff' | 'bean' | 'beans';
export type RailSection =
  | 'beans'
  | 'decisions'
  | 'tests'
  | 'agents'
  | 'red'
  | 'promotion'
  | 'checks';

export type ViewConfig = {
  readonly tree: TreeMode;
  readonly main: MainView;
  readonly rail: readonly RailSection[];
};

export type CatalogEntry = {
  readonly label: string;
  readonly example: string;
  /** What the class answers, in the words a classifier is shown. */
  readonly description: string;
  readonly view: ViewConfig;
};

/** The v1 catalog (`docs/claude-opus/13` §3): one fixed arrangement per question class. */
export const CATALOG: Readonly<Record<QuestionClass, CatalogEntry>> = {
  'recent-changes': {
    label: 'Recent changes',
    example: 'what changed recently on coupons?',
    description: 'What changed in an area of the code over a time range.',
    view: { tree: 'filtered', main: 'diff', rail: ['beans', 'decisions'] },
  },
  'who-why': {
    label: 'Who and why',
    example: 'who changed tax rounding and why?',
    description: 'Which beans and agents changed some code, and their intents.',
    view: { tree: 'filtered', main: 'file', rail: ['beans', 'decisions'] },
  },
  'in-flight': {
    label: 'In flight',
    example: "what's being worked on in billing right now?",
    description: 'Work in progress: beans not landed yet, their agents and overlaps.',
    view: { tree: 'filtered', main: 'bean', rail: ['agents', 'beans'] },
  },
  'what-broke': {
    label: 'What broke',
    example: 'why did the sprout go red?',
    description: 'Red validations and checks, their failing tests, culprits and reverts.',
    view: { tree: 'filtered', main: 'diff', rail: ['red', 'beans'] },
  },
  'pending-promotion': {
    label: 'Waiting for the stalk',
    example: "what's on sprout but not on stalk?",
    description: 'Commits on the sprout that the stalk does not have yet.',
    view: { tree: 'filtered', main: 'diff', rail: ['promotion', 'beans'] },
  },
  decisions: {
    label: 'Decisions',
    example: 'what did we decide about money formatting?',
    description: 'Decision cards: two specs that disagreed and which one won.',
    view: { tree: 'filtered', main: 'file', rail: ['decisions', 'beans'] },
  },
  'tests-for': {
    label: 'Tests',
    example: 'what tests cover checkout?',
    description: 'Tests that exercise some code, and whether they pass.',
    view: { tree: 'filtered', main: 'file', rail: ['tests'] },
  },
  'agent-activity': {
    label: 'Agent activity',
    example: 'what has a3 done?',
    description: 'What one agent worked on: its beans and the files they touch.',
    view: { tree: 'filtered', main: 'beans', rail: ['agents', 'beans'] },
  },
  bean: {
    label: 'Bean',
    example: 'show bean t032',
    description: 'One bean: its intent, diff, checks, reworks and decision.',
    view: { tree: 'filtered', main: 'bean', rail: ['checks', 'decisions'] },
  },
  explore: {
    label: 'Explore',
    example: 'src/lib/money.ts',
    description: 'Anything else: the repository, with search hits for the words asked.',
    view: { tree: 'full', main: 'file', rail: ['beans'] },
  },
};

/** The spec of an empty question: the plain explorer. */
export function exploreSpec(ref: LineRef = 'sprout'): ViewSpec {
  return {
    class: 'explore',
    entities: { feature: null, paths: [], agent: null, bean: null },
    range: { minutes: null, ref },
  };
}

/** The spec with its arrangement, as agents get it over MCP (`ask_repo`). */
export function specWithView(spec: ViewSpec): ViewSpec & { readonly view: ViewConfig } {
  return { ...spec, view: CATALOG[spec.class].view };
}
