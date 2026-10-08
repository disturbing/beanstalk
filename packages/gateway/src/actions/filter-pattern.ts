/**
 * GitHub's filter patterns for `branches`, `paths` and their `-ignore` forms: `*` matches any
 * characters but `/`, `**` any characters, `?` one character, `+` one or more of the previous
 * character, `[…]` a class, and a leading `!` in a list negates (later patterns win).
 */

/** Whether `value` matches pattern `pattern` (no `!`). */
export function matchesPattern(pattern: string, value: string): boolean {
  return patternRegex(pattern).test(value);
}

/**
 * Whether `value` is selected by a list of patterns, with GitHub's `!` rule: the last pattern
 * that matches decides (a positive one selects, a negated one deselects).
 */
export function selectedBy(patterns: readonly string[], value: string): boolean {
  let selected = false;
  for (const pattern of patterns) {
    const isNegated = pattern.startsWith('!');
    if (matchesPattern(isNegated ? pattern.slice(1) : pattern, value)) selected = !isNegated;
  }
  return selected;
}

function patternRegex(pattern: string): RegExp {
  let source = '';
  let index = 0;
  while (index < pattern.length) {
    const char = pattern[index] ?? '';
    if (char === '*' && pattern[index + 1] === '*') {
      // `**/` also matches nothing, so `docs/**/a.md` matches `docs/a.md`.
      const isDirectory = pattern[index + 2] === '/';
      source += isDirectory ? '(?:.*/)?' : '.*';
      index += isDirectory ? 3 : 2;
    } else if (char === '*') {
      source += '[^/]*';
      index += 1;
    } else if (char === '?') {
      source += '[^/]';
      index += 1;
    } else if (char === '+') {
      source += '+';
      index += 1;
    } else if (char === '[') {
      const end = pattern.indexOf(']', index + 1);
      source += end === -1 ? '\\[' : pattern.slice(index, end + 1);
      index = end === -1 ? index + 1 : end + 1;
    } else {
      source += char.replace(/[.^$|(){}\\]/g, '\\$&');
      index += 1;
    }
  }
  return new RegExp(`^${source}$`);
}
