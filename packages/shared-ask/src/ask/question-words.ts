/**
 * The words of a question: the entities it names (a bean, an agent, paths, a time range, a
 * line) and the feature terms left once the question's own words are removed.
 */
import type { TaskId } from '@beanstalk/shared-race/ids';
import { TaskId as TaskIdSchema } from '@beanstalk/shared-race/ids';

import type { LineRef } from './view-spec';

export type QuestionEntities = {
  readonly bean: TaskId | null;
  readonly agent: string | null;
  readonly paths: readonly string[];
  readonly minutes: number | null;
  readonly ref: LineRef | null;
  /** Content words that name what the question is about (`coupons`, `tax rounding`). */
  readonly feature: string | null;
};

/** Feature terms kept from one question. */
const MAX_FEATURE_WORDS = 3;

/** Words that carry the question's shape, never its subject. */
const STOPWORDS = new Set(
  `a about after all also am an and any are as at be been before being between both but by can
  could did do does doing done during each for from get got had has have having how i if in into
  is it its just me more most my no not now of on once only or our out over own please same she
  should so some such than that the their them then there these they this those through to too
  under until up us very was we were what whats when where which while who whom whose why will
  with would you your yet let lets show tell give find list see look looking currently right
  recent recently latest new newest changed change changes changing modified touched updated
  happened happen going work working worked being progress flight inflight
  decide decided decision decisions deciding choose chose chosen card cards spec specs
  test tests tested testing cover covers covering covered coverage
  broke broken break breaking red fail failed failing failure failures fails green go went gone
  wrong revert reverted reverts culprit
  sprout sprouts stalk stalks staged stable line trunk main
  agent agents bean beans commit commits code file files repo repository
  today yesterday hour hours minute minutes min mins last past since ago time
  pending awaiting waiting promoted promotion promote validated validation unvalidated ahead
  does done did doing has have`.split(/\s+/),
);

const BEAN_PATTERN = /\b(t\d{3})\b/i;
const AGENT_PATTERN = /\b(?:agent\s*)?a(\d{1,2})\b|\bagent\s+(\d{1,2})\b/i;
const PATH_TOKEN = /(?:^|\s)([\w.-]+\/[\w./-]*|[\w-]+\.(?:ts|tsx|js|mjs|json|md))(?=[\s?,.!]|$)/g;
const MINUTES_PATTERN =
  /\b(?:last|past|previous)\s+(\d{1,4})\s*(m|min|mins|minutes?|h|hr|hrs|hours?)\b/i;

export function parseQuestion(question: string): QuestionEntities {
  const text = question.trim();
  const paths = [...text.matchAll(PATH_TOKEN)].flatMap((match) =>
    match[1] === undefined ? [] : [match[1].replace(/^\.\//, '').replace(/[.]$/, '')],
  );
  return {
    bean: beanOf(text),
    agent: agentOf(text),
    paths: [...new Set(paths)],
    minutes: minutesOf(text),
    ref: refOf(text),
    feature: featureOf(text, paths),
  };
}

function beanOf(text: string): TaskId | null {
  const match = BEAN_PATTERN.exec(text)?.[1]?.toLowerCase();
  const parsed = TaskIdSchema.safeParse(match);
  return parsed.success ? parsed.data : null;
}

function agentOf(text: string): string | null {
  const match = AGENT_PATTERN.exec(text);
  const number = match?.[1] ?? match?.[2];
  return number === undefined ? null : `a${Number(number)}`;
}

function minutesOf(text: string): number | null {
  const match = MINUTES_PATTERN.exec(text);
  if (match?.[1] !== undefined) {
    const amount = Number(match[1]);
    return (match[2] ?? 'm').toLowerCase().startsWith('h') ? amount * 60 : amount;
  }
  if (/\b(?:last|past) hour\b/i.test(text)) return 60;
  if (/\btoday\b/i.test(text)) return 24 * 60;
  return null;
}

function refOf(text: string): LineRef | null {
  if (/\b(?:stalk|stable|green line)\b/i.test(text) && !/\bsprout\b/i.test(text)) return 'stalk';
  if (/\b(?:sprout|staged)\b/i.test(text)) return 'sprout';
  return null;
}

function featureOf(text: string, paths: readonly string[]): string | null {
  const rest = paths.reduce(
    (remaining, path) => remaining.replace(path.toLowerCase(), ' '),
    text.toLowerCase(),
  );
  const words = rest
    .replace(BEAN_PATTERN, ' ')
    .replace(new RegExp(AGENT_PATTERN.source, 'gi'), ' ')
    .replace(/\b\d+(?:am|pm|h|m|s)?\b/g, ' ')
    .split(/[^a-z0-9-]+/)
    .map((word) => word.replace(/^-+|-+$/g, ''))
    .filter((word) => word.length >= 3 && !STOPWORDS.has(word));
  const kept = [...new Set(words)].slice(0, MAX_FEATURE_WORDS);
  return kept.length === 0 ? null : kept.join(' ');
}

/**
 * A light English stemmer for matching question words against code: plural, gerund and
 * past endings only (`coupons` → `coupon`, `rounding` → `round`, `formatting` → `format`).
 */
export function stem(word: string): string {
  const lower = word.toLowerCase();
  const rules: readonly (readonly [RegExp, string])[] = [
    [/ies$/, 'y'],
    [/(ss)es$/, '$1'],
    [/(ch|sh|x|z)es$/, '$1'],
    [/([^s])s$/, '$1'],
    [/(\w{3,}?)(\w)\2ing$/, '$1$2'],
    [/(\w{3,})ing$/, '$1'],
    [/(\w{3,}?)(\w)\2ed$/, '$1$2'],
    [/(\w{3,})ed$/, '$1'],
  ];
  for (const [pattern, replacement] of rules) {
    if (pattern.test(lower)) return lower.replace(pattern, replacement);
  }
  return lower;
}

/** The stems of a feature term, de-duplicated (`money formatting` → money, format). */
export function featureStems(feature: string): readonly string[] {
  const stems = feature
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter((word) => word.length >= 3)
    .map(stem)
    .filter((word) => word.length >= 3);
  return [...new Set(stems)];
}
