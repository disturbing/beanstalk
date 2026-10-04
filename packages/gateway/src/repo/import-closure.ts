/**
 * Static import closures of test files (what the runner calls a read set), for the web
 * app's `testsFor`: relative `import … from`, `export … from`, side-effect `import`,
 * `require()` and `import()` specifiers, resolved against the files of one commit the way
 * TypeScript resolves them (`.ts`, `.js` written for `.ts`, `index` files). Package imports
 * are left out: only the repo's own files count.
 */

const SPECIFIERS = [
  /(?:import|export)\s[^'"`;]*?\sfrom\s*['"]([^'"]+)['"]/g,
  /import\s*['"]([^'"]+)['"]/g,
  /(?:require|import)\s*\(\s*['"]([^'"]+)['"]\s*\)/g,
];
const EXTENSIONS = ['', '.ts', '.tsx', '.mts', '.js', '.mjs', '.cjs', '/index.ts', '/index.js'];

/** The relative module specifiers a source file imports. */
export function importSpecifiers(source: string): string[] {
  const found = SPECIFIERS.flatMap((pattern) =>
    [...source.matchAll(pattern)].map((match) => match[1] ?? ''),
  );
  return [...new Set(found.filter((specifier) => specifier.startsWith('.')))];
}

/** The repo file an import resolves to, or null (outside the repo, or missing). */
export function resolveImport(
  from: string,
  specifier: string,
  files: ReadonlySet<string>,
): string | null {
  const target = normalize(`${dirname(from)}/${specifier}`);
  if (target === null) return null;
  const stem = /\.[cm]?js$/.test(target) ? target.replace(/\.[cm]?js$/, '') : null;
  const candidates = [
    ...EXTENSIONS.map((extension) => `${target}${extension}`),
    ...(stem === null ? [] : [`${stem}.ts`, `${stem}.tsx`, `${stem}.mts`]),
  ];
  return candidates.find((candidate) => files.has(candidate)) ?? null;
}

/**
 * The closure of each test file: a breadth-first walk over imports. `known` gives contents
 * already in hand (the tests' own); others come from `read`, at most `maxReads` in all.
 */
export async function importClosures(input: {
  known: Readonly<Record<string, string>>;
  files: ReadonlySet<string>;
  read: (paths: readonly string[]) => Promise<readonly (string | null)[]>;
  maxReads: number;
}): Promise<{ closures: Map<string, Set<string>>; truncated: boolean }> {
  const contents = new Map<string, string | null>(Object.entries(input.known));
  const roots = Object.keys(input.known);
  const closures = new Map(roots.map((root) => [root, new Set([root])]));
  let frontier = new Map(roots.map((root) => [root, [root]]));
  let reads = 0;
  let truncated = false;
  while ([...frontier.values()].some((paths) => paths.length > 0)) {
    const needed = [...new Set([...frontier.values()].flat())].filter(
      (path) => !contents.has(path),
    );
    const allowed = needed.slice(0, Math.max(0, input.maxReads - reads));
    truncated ||= allowed.length < needed.length;
    if (allowed.length > 0) {
      // oxlint-disable-next-line no-await-in-loop -- each round reads the files the last one found
      const texts = await input.read(allowed);
      allowed.forEach((path, index) => contents.set(path, texts[index] ?? null));
      reads += allowed.length;
    }
    frontier = nextFrontier({ frontier, closures, contents, files: input.files });
  }
  return { closures, truncated };
}

function nextFrontier(walk: {
  frontier: Map<string, string[]>;
  closures: Map<string, Set<string>>;
  contents: Map<string, string | null>;
  files: ReadonlySet<string>;
}): Map<string, string[]> {
  const next = new Map<string, string[]>();
  for (const [root, paths] of walk.frontier) {
    const closure = walk.closures.get(root) ?? new Set<string>();
    const found: string[] = [];
    for (const path of paths) {
      const source = walk.contents.get(path);
      if (source === null || source === undefined) continue;
      for (const specifier of importSpecifiers(source)) {
        const resolved = resolveImport(path, specifier, walk.files);
        if (resolved === null || closure.has(resolved)) continue;
        closure.add(resolved);
        found.push(resolved);
      }
    }
    next.set(root, found);
  }
  return next;
}

function dirname(path: string): string {
  const index = path.lastIndexOf('/');
  return index < 0 ? '.' : path.slice(0, index);
}

/** `a/./b/../c` → `a/c`; null when the path climbs out of the repo. */
function normalize(path: string): string | null {
  const parts: string[] = [];
  for (const segment of path.split('/')) {
    if (segment === '' || segment === '.') continue;
    if (segment !== '..') {
      parts.push(segment);
      continue;
    }
    if (parts.length === 0) return null;
    parts.pop();
  }
  return parts.join('/');
}
