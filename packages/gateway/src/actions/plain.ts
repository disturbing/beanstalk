/**
 * The parser's template tokens as plain JSON: its serialized form (`{type: 2, map}` for a
 * mapping, `{type: 1, seq}` for a sequence, `{type: 3, expr}` for an expression, literals as
 * themselves) turned into objects, arrays and strings, an expression into `${{ expr }}`.
 */

export type PlainValue =
  | string
  | number
  | boolean
  | null
  | readonly PlainValue[]
  | { readonly [key: string]: PlainValue };

const SEQUENCE = 1;
const MAPPING = 2;
const BASIC_EXPRESSION = 3;

/** A serialized token as plain JSON; null for what has no plain form (an insert expression). */
export function plainOf(serialized: unknown): PlainValue {
  if (serialized === null) return null;
  if (typeof serialized === 'string' || typeof serialized === 'number' || typeof serialized === 'boolean')
    return serialized;
  if (typeof serialized !== 'object') return null;
  const type: unknown = Reflect.get(serialized, 'type');
  if (type === SEQUENCE) {
    const items: unknown = Reflect.get(serialized, 'seq');
    return Array.isArray(items) ? items.map((item: unknown) => plainOf(item)) : [];
  }
  if (type === MAPPING) return mappingOf(Reflect.get(serialized, 'map'));
  if (type === BASIC_EXPRESSION) {
    const expression: unknown = Reflect.get(serialized, 'expr');
    return typeof expression === 'string' ? `\${{ ${expression} }}` : null;
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

function mappingOf(pairs: unknown): { readonly [key: string]: PlainValue } {
  const result: Record<string, PlainValue> = {};
  if (!Array.isArray(pairs)) return result;
  for (const pair of pairs) {
    if (typeof pair !== 'object' || pair === null) continue;
    const key = plainOf(Reflect.get(pair, 'Key'));
    if (typeof key === 'string') result[key] = plainOf(Reflect.get(pair, 'Value'));
  }
  return result;
}
