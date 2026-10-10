/**
 * Entity resolution (`docs/claude-opus/13` §2.2): a feature term becomes a ranked file set by
 * combining (a) path and name matches, (b) a content grep at the ref, (c) the files of beans
 * whose title or intent mentions the term, and (d) the code under tests that mention it.
 * Pure: the caller fetches the corpus (tree, grep hits, beans, tests) and passes it in.
 */
import type { TaskId } from '@gitstalk/shared-race/ids';

import { compareText, pathWords } from '../repo/paths';
import type { GrepMatch } from '../repo/repo-types';
import { featureStems } from './question-words';

export type ResolverBean = {
  readonly id: TaskId;
  readonly title: string;
  readonly intent: string;
  readonly files: readonly string[];
};

export type ResolverTest = {
  readonly path: string;
  readonly covers: readonly string[];
};

export type ResolverCorpus = {
  /** Every file at the ref. */
  readonly paths: readonly string[];
  /** Content matches per stem (`repoGrep` of each stem). */
  readonly grep: ReadonlyMap<string, readonly GrepMatch[]>;
  readonly beans: readonly ResolverBean[];
  readonly tests: readonly ResolverTest[];
};

export type MatchReason = 'path' | 'content' | 'bean' | 'test';

export type RankedFile = {
  readonly path: string;
  readonly score: number;
  readonly reasons: readonly MatchReason[];
  /** Beans whose intent mentions the term and that touch this file. */
  readonly beans: readonly TaskId[];
  /** Matching lines in this file. */
  readonly hits: number;
};

/** The file set shown for a feature: this many files at most. */
export const MAX_RESOLVED_FILES = 12;
/** A file needs at least this score: a name match, a bean, or content with corroboration. */
const MIN_SCORE = 2;
const PATH_WEIGHT = 4;
const BEAN_WEIGHT = 3;
/** A bean that names the term only in its long prompt counts half as much as in its title. */
const INTENT_ONLY_FACTOR = 0.5;
const TEST_COVER_WEIGHT = 1;
/** Tests share helpers (fixtures, clocks): their signal per file stays small. */
const TEST_SCORE_CAP = 2;
const CONTENT_CAP = 3;
/** Matching every word of a multi-word term multiplies the score. */
const ALL_WORDS_BONUS = 1.5;

type Tally = {
  score: number;
  testScore: number;
  reasons: Set<MatchReason>;
  beans: Set<TaskId>;
  hits: number;
  stems: Set<string>;
};

/** Ranks the files that answer `feature`, best first. Empty when nothing matches. */
export function resolveFiles(feature: string, corpus: ResolverCorpus): readonly RankedFile[] {
  const stems = featureStems(feature);
  if (stems.length === 0) return [];
  const tallies = new Map<string, Tally>();
  const tally = (path: string): Tally => {
    const existing = tallies.get(path);
    if (existing !== undefined) return existing;
    const created: Tally = {
      score: 0,
      testScore: 0,
      reasons: new Set(),
      beans: new Set(),
      hits: 0,
      stems: new Set(),
    };
    tallies.set(path, created);
    return created;
  };
  const present = new Set(corpus.paths);
  scorePaths(corpus.paths, stems, tally);
  scoreContent(corpus.grep, stems, tally);
  scoreBeans(corpus, { stems, present }, tally);
  scoreTests(corpus.tests, { grep: corpus.grep, stems, present }, tally);
  return rank(tallies, stems.length);
}

function scorePaths(
  paths: readonly string[],
  stems: readonly string[],
  tally: (path: string) => Tally,
) {
  for (const path of paths) {
    const words = pathWords(path);
    for (const stem of stems) {
      if (!words.some((word) => matchesStem(word, stem))) continue;
      const entry = tally(path);
      entry.score += PATH_WEIGHT;
      entry.reasons.add('path');
      entry.stems.add(stem);
    }
  }
}

function scoreContent(
  grep: ReadonlyMap<string, readonly GrepMatch[]>,
  stems: readonly string[],
  tally: (path: string) => Tally,
) {
  for (const stem of stems) {
    const counts = new Map<string, number>();
    for (const match of grep.get(stem) ?? [])
      counts.set(match.path, (counts.get(match.path) ?? 0) + 1);
    for (const [path, count] of counts) {
      const entry = tally(path);
      entry.score += Math.min(CONTENT_CAP, 1 + Math.log2(count));
      entry.hits += count;
      entry.reasons.add('content');
      entry.stems.add(stem);
    }
  }
}

/**
 * Beans whose title or intent mentions the term lend their files a score, scaled by how
 * rare each file is among beans: a changelog every bean touches says little.
 */
function scoreBeans(
  corpus: ResolverCorpus,
  context: { readonly stems: readonly string[]; readonly present: ReadonlySet<string> },
  tally: (path: string) => Tally,
) {
  const rarity = rarityOf(corpus.beans.map((bean) => bean.files));
  for (const bean of corpus.beans) {
    const inTitle = context.stems.filter((stem) => mentions(bean.title, stem));
    const mentioned = context.stems.filter((stem) =>
      mentions(`${bean.title} ${bean.intent}`, stem),
    );
    if (mentioned.length === 0) continue;
    const strength =
      (mentioned.length / context.stems.length) * (inTitle.length > 0 ? 1 : INTENT_ONLY_FACTOR);
    for (const file of bean.files) {
      if (!context.present.has(file)) continue;
      const entry = tally(file);
      entry.score += BEAN_WEIGHT * strength * rarity(file);
      entry.reasons.add('bean');
      entry.beans.add(bean.id);
      for (const stem of mentioned) entry.stems.add(stem);
    }
  }
}

function scoreTests(
  tests: readonly ResolverTest[],
  context: {
    readonly grep: ReadonlyMap<string, readonly GrepMatch[]>;
    readonly stems: readonly string[];
    readonly present: ReadonlySet<string>;
  },
  tally: (path: string) => Tally,
) {
  const rarity = rarityOf(tests.map((test) => test.covers));
  for (const test of tests) {
    const mentioned = context.stems.filter((stem) =>
      (context.grep.get(stem) ?? []).some((match) => match.path === test.path),
    );
    if (mentioned.length === 0) continue;
    for (const covered of test.covers) {
      if (!context.present.has(covered)) continue;
      const entry = tally(covered);
      const added = Math.min(TEST_COVER_WEIGHT * rarity(covered), TEST_SCORE_CAP - entry.testScore);
      if (added <= 0) continue;
      entry.score += added;
      entry.testScore += added;
      entry.reasons.add('test');
    }
  }
}

/**
 * How specific a file is to one member of a group (a bean's files, a test's imports), from 1
 * (one member) down to 0 (all of them): an inverse document frequency on [0, 1].
 */
function rarityOf(groups: readonly (readonly string[])[]): (path: string) => number {
  const counts = new Map<string, number>();
  for (const group of groups)
    for (const path of new Set(group)) counts.set(path, (counts.get(path) ?? 0) + 1);
  const size = Math.max(groups.length, 2);
  return (path) => {
    const value = Math.log(size / (1 + (counts.get(path) ?? 0))) / Math.log(size / 2);
    return Math.max(0, Math.min(1, value));
  };
}

function rank(tallies: ReadonlyMap<string, Tally>, stemCount: number): readonly RankedFile[] {
  return [...tallies]
    .map(([path, entry]) => ({
      path,
      score:
        stemCount > 1 && entry.stems.size === stemCount
          ? entry.score * ALL_WORDS_BONUS
          : entry.score,
      reasons: [...entry.reasons],
      beans: [...entry.beans].toSorted(compareText),
      hits: entry.hits,
    }))
    .filter((file) => file.score >= MIN_SCORE)
    .toSorted((a, b) => b.score - a.score || compareText(a.path, b.path))
    .slice(0, MAX_RESOLVED_FILES);
}

/** A word matches a stem when it starts with it (`coupons` ← `coupon`, `billing` ← `bill`). */
function matchesStem(word: string, stem: string): boolean {
  return word.startsWith(stem) || (stem.length >= 5 && word.includes(stem));
}

/** Whether prose mentions a stem at a word start. */
function mentions(text: string, stem: string): boolean {
  return new RegExp(`\\b${escapeRegExp(stem)}`, 'i').test(text);
}

function escapeRegExp(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}
