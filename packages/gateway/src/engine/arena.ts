import { roundTo } from './numbers';

/**
 * The study's definitions of a file's category and module (`research/common/corpus.py`
 * `classify`, `research/race/harness/arena.py` `module_of`, `placement_modules`), used for
 * footprint scoring in the summary and for `base_tests_changed` in the final check.
 */

export type FileCategory =
  | 'lockfile'
  | 'changelog'
  | 'migration'
  | 'snapshot'
  | 'manifest'
  | 'generated'
  | 'binary'
  | 'ci'
  | 'docs'
  | 'test'
  | 'source';

const CATEGORY_RULES: readonly (readonly [FileCategory, RegExp])[] = [
  [
    'lockfile',
    /(^|\/)(package-lock\.json|pnpm-lock\.yaml|yarn\.lock|bun\.lockb?|Cargo\.lock|poetry\.lock|uv\.lock|Pipfile\.lock|go\.sum|Gemfile\.lock|composer\.lock|flake\.lock)$/,
  ],
  [
    'changelog',
    /(^|\/)(CHANGELOG[^/]*|CHANGES[^/]*|HISTORY[^/]*|RELEASE[_-]?NOTES[^/]*)$|(^|\/)\.changeset\//i,
  ],
  ['migration', /(^|\/)migrations?\/|(^|\/)[^/]*migration[^/]*\.(sql|ts|js|py|rb)$/i],
  ['snapshot', /(^|\/)__snapshots__\/|\.snap$|(^|\/)snapshots\//i],
  [
    'manifest',
    /(^|\/)(package\.json|Cargo\.toml|pyproject\.toml|go\.mod|deno\.json|tsconfig[^/]*\.json)$/,
  ],
  [
    'generated',
    /(^|\/)(dist|build|gen|generated|__generated__|precomputed)\/|\.gen\.[a-z]+$|\.generated\.[a-z]+$|(^|\/)schema\.(json|graphql)$|\.(zst|gz|br)$/i,
  ],
  ['binary', /\.(png|jpe?g|gif|webp|ico|svg|pdf|wasm|bin|woff2?|ttf|otf|mp4|mp3|zip|tar)$/i],
  ['ci', /(^|\/)\.github\/|(^|\/)\.circleci\/|(^|\/)\.buildkite\//],
  ['docs', /\.(md|mdx|rst|txt)$|(^|\/)docs?\//i],
  [
    'test',
    /(^|\/)(tests?|__tests__|spec|e2e|fixtures?)\/|[._-](test|spec)\.[a-z]+$|_test\.(go|rs|py)$/i,
  ],
];

/** A path's category; the first matching rule wins, as in the study. */
export function classifyPath(path: string): FileCategory {
  const rule = CATEGORY_RULES.find(([, pattern]) => pattern.test(path));
  return rule === undefined ? 'source' : rule[0];
}

const MODULE_DEPTH = 2;
const DISSOLVABLE: ReadonlySet<FileCategory> = new Set([
  'lockfile',
  'changelog',
  'snapshot',
  'generated',
]);

/** `src/cart/index.ts` → `src/cart` (the arena's module depth of 2); root files → `(root)`. */
export function moduleOf(path: string): string {
  const segments = path.split('/').slice(0, -1);
  return segments.length > 0 ? segments.slice(0, MODULE_DEPTH).join('/') : '(root)';
}

/**
 * Modules that matter for placement and footprint scoring: source-like files only (tests,
 * docs and commutative files such as CHANGELOG.md do not make two tasks collide).
 */
export function placementModules(paths: Iterable<string>): Set<string> {
  const modules = new Set<string>();
  for (const path of paths) {
    const category = classifyPath(path);
    if (DISSOLVABLE.has(category) || category === 'test' || category === 'docs') continue;
    modules.add(moduleOf(path));
  }
  return modules;
}

/** Precision, recall and F1 of a predicted set against an actual one (`footprint.prf`). */
export type Prf = {
  readonly precision: number;
  readonly recall: number;
  readonly f1: number;
  readonly tp: number;
  readonly pred: number;
  readonly actual: number;
};

export function precisionRecall(predicted: ReadonlySet<string>, actual: ReadonlySet<string>): Prf {
  const tp = [...predicted].filter((item) => actual.has(item)).length;
  const precision = precisionOf(tp, predicted, actual);
  const recall = actual.size > 0 ? tp / actual.size : 1;
  const f1 = precision + recall > 0 ? (2 * precision * recall) / (precision + recall) : 0;
  return {
    precision: roundTo(precision, 4),
    recall: roundTo(recall, 4),
    f1: roundTo(f1, 4),
    tp,
    pred: predicted.size,
    actual: actual.size,
  };
}

/** An empty prediction is perfectly precise only when nothing was touched either. */
function precisionOf(
  tp: number,
  predicted: ReadonlySet<string>,
  actual: ReadonlySet<string>,
): number {
  if (predicted.size > 0) return tp / predicted.size;
  return actual.size === 0 ? 1 : 0;
}
