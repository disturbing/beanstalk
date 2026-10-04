/**
 * Relative imports of TypeScript files and their closure: which source files a test
 * exercises. The arena imports with explicit `.ts` extensions (Node runs it natively).
 */

const IMPORT_PATTERN =
  /(?:^|\n)\s*(?:import|export)\s+(?:type\s+)?(?:[^'"]*?\sfrom\s+)?['"](\.{1,2}\/[^'"]+)['"]/g;

/** Repo paths a file imports (relative imports only; packages and node: are skipped). */
function relativeImports(path: string, text: string): readonly string[] {
  const directory = path.split('/').slice(0, -1);
  const found = [...text.matchAll(IMPORT_PATTERN)].flatMap((match) => {
    const specifier = match[1];
    return specifier === undefined ? [] : [resolveSpecifier(directory, specifier)];
  });
  return [...new Set(found)];
}

function resolveSpecifier(directory: readonly string[], specifier: string): string {
  const parts = [...directory];
  for (const segment of specifier.split('/')) {
    if (segment === '' || segment === '.') continue;
    if (segment === '..') parts.pop();
    else parts.push(segment);
  }
  const joined = parts.join('/');
  return /\.[cm]?[jt]sx?$/.test(joined) ? joined : `${joined}.ts`;
}

/** A file that wires many modules together (an app, a route table, test helpers). */
const HUB_IMPORTS = 6;

/**
 * The repo files `start` reaches through relative imports, `start` excluded. Hubs (files
 * importing many modules, like a test helper that builds the whole app) are not followed
 * and not listed: through them every test would cover everything. `read` returns a file's
 * text, or undefined when the path is not in the tree.
 */
export function importClosure(
  start: string,
  read: (path: string) => string | undefined,
): readonly string[] {
  const seen = new Set<string>([start]);
  const covered: string[] = [];
  const queue = [start];
  for (let next = queue.shift(); next !== undefined; next = queue.shift()) {
    const text = read(next);
    if (text === undefined) continue;
    for (const imported of relativeImports(next, text)) {
      if (seen.has(imported)) continue;
      seen.add(imported);
      const importedText = read(imported);
      if (importedText === undefined || isHub(imported, importedText)) continue;
      covered.push(imported);
      queue.push(imported);
    }
  }
  return covered;
}

function isHub(path: string, text: string): boolean {
  return relativeImports(path, text).length >= HUB_IMPORTS;
}

/** `*.test.ts` and friends. */
export function isTestFile(path: string): boolean {
  return /\.test\.[cm]?[jt]sx?$/.test(path);
}
