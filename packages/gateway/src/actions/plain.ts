/**
 * The parser's template tokens as plain JSON: mappings as objects, sequences as arrays,
 * literals as themselves, and an expression as the text it was written as (a `run:` block with
 * `${{ }}` parts stays that block, not the parser's `format(…)` rewrite).
 */
import type { TemplateToken } from '@actions/workflow-parser/templates/tokens/template-token';
import {
  isBasicExpression,
  isBoolean,
  isMapping,
  isNumber,
  isSequence,
  isString,
} from '@actions/workflow-parser';

export type PlainValue =
  | string
  | number
  | boolean
  | null
  | readonly PlainValue[]
  | { readonly [key: string]: PlainValue };

/** A token as plain JSON; null for what has no plain form (null, an insert expression). */
export function plainOf(token: TemplateToken): PlainValue {
  if (isString(token)) return token.value;
  if (isNumber(token) || isBoolean(token)) return token.value;
  if (isBasicExpression(token)) return token.source ?? `\${{ ${token.expression} }}`;
  if (isSequence(token)) return [...token].map((item) => plainOf(item));
  if (isMapping(token)) {
    const result: Record<string, PlainValue> = {};
    for (const pair of token) if (isString(pair.key)) result[pair.key.value] = plainOf(pair.value);
    return result;
  }
  return null;
}

export function isPlainObject(
  value: PlainValue | undefined,
): value is { readonly [key: string]: PlainValue } {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** A scalar or a sequence of scalars as strings (`runs-on`, `needs`). */
export function stringsOf(value: PlainValue | undefined): string[] {
  if (typeof value === 'string') return [value];
  if (!Array.isArray(value)) return [];
  return value.flatMap((item: PlainValue) => (typeof item === 'string' ? [item] : []));
}
