/**
 * Grep patterns for the RunDO, which runs the engine on the same thread: a user-supplied
 * regular expression must not be able to pin it. A pattern is a literal unless the caller
 * asks for `regex`, and a regex is limited to a subset that cannot backtrack exponentially.
 */
import { GatewayError } from '../errors';

/** Characters of a pattern. */
export const MAX_PATTERN_CHARS = 200;
/** Characters of a line that are tested; the rest is ignored. */
export const MAX_TESTED_LINE_CHARS = 2000;

/** The matcher for `pattern`: a literal search, or (with `regex`) a safe-subset regular expression. */
export function compileGrep(pattern: string, options: { readonly regex: boolean }): RegExp {
  if (pattern.length === 0 || pattern.length > MAX_PATTERN_CHARS) {
    throw invalid(`the pattern must have 1 to ${MAX_PATTERN_CHARS} characters`);
  }
  if (!options.regex) return new RegExp(escapeRegExp(pattern));
  assertSafeRegex(pattern);
  try {
    return new RegExp(pattern);
  } catch {
    throw invalid(`not a regular expression: ${pattern}`);
  }
}

/** Whether `line` (cut at `MAX_TESTED_LINE_CHARS`) matches. */
export function lineMatches(matcher: RegExp, line: string): boolean {
  return matcher.test(
    line.length > MAX_TESTED_LINE_CHARS ? line.slice(0, MAX_TESTED_LINE_CHARS) : line,
  );
}

function escapeRegExp(text: string): string {
  return text.replaceAll(/[.*+?^${}()|[\]\\]/g, String.raw`\$&`);
}

function invalid(message: string): GatewayError {
  return new GatewayError(message, 'invalid_request', 400);
}

type Group = { repeats: boolean; alternates: boolean };

const COUNTED_REPEAT = /^\{\d+(?:,\d*)?\}/;

/**
 * Rejects what backtracks badly: a repeated group that holds a repeat or an alternation
 * (`(a+)+`, `(a|aa)*`), backreferences and lookbehind. Everything else is linear enough
 * on a line of at most `MAX_TESTED_LINE_CHARS`.
 */
function assertSafeRegex(pattern: string): void {
  const stack: Group[] = [{ repeats: false, alternates: false }];
  const top = (): Group => {
    const group = stack.at(-1);
    if (group === undefined) throw invalid('unbalanced parentheses');
    return group;
  };
  let index = 0;
  while (index < pattern.length) {
    const char = pattern.charAt(index);
    if (char === '\\') {
      const next = pattern.charAt(index + 1);
      if (/[1-9k]/.test(next)) throw invalid('backreferences are not allowed in a grep pattern');
      index += 2;
    } else if (char === '[') {
      index = endOfClass(pattern, index);
    } else if (char === '(') {
      if (/^\(\?<[=!]/.test(pattern.slice(index))) throw invalid('lookbehind is not allowed');
      stack.push({ repeats: false, alternates: false });
      index = endOfGroupPrefix(pattern, index);
    } else if (char === ')') {
      const group = stack.pop();
      if (group === undefined || stack.length === 0) throw invalid('unbalanced parentheses');
      const repeated = isRepeatAt(pattern, index + 1);
      if (repeated && (group.repeats || group.alternates)) {
        throw invalid('a repeated group may not contain a repeat or an alternation');
      }
      const parent = top();
      parent.repeats ||= group.repeats;
      parent.alternates ||= group.alternates;
      index += 1;
    } else if (char === '|') {
      top().alternates = true;
      index += 1;
    } else if (char === '+' || char === '*') {
      top().repeats = true;
      index += 1;
    } else if (char === '{') {
      const counted = COUNTED_REPEAT.exec(pattern.slice(index));
      if (counted === null) index += 1;
      else {
        top().repeats = true;
        index += counted[0].length;
      }
    } else {
      index += 1;
    }
  }
}

function isRepeatAt(pattern: string, index: number): boolean {
  const char = pattern.charAt(index);
  return char === '+' || char === '*' || COUNTED_REPEAT.test(pattern.slice(index));
}

function endOfClass(pattern: string, start: number): number {
  let index = start + 1;
  while (index < pattern.length && pattern.charAt(index) !== ']') {
    index += pattern.charAt(index) === '\\' ? 2 : 1;
  }
  return index + 1;
}

/** Past `(`, and past `?:`, `?=`, `?!` or `?<name>` so their `?` is not read as a repeat. */
function endOfGroupPrefix(pattern: string, start: number): number {
  if (pattern.charAt(start + 1) !== '?') return start + 1;
  if (/[:=!]/.test(pattern.charAt(start + 2))) return start + 3;
  const close = pattern.indexOf('>', start);
  return close === -1 ? start + 2 : close + 1;
}
