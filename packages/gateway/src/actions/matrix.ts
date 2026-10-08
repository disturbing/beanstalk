/**
 * `strategy.matrix`, minimal (doc 25 §6.1): axes of scalars crossed, then GitHub's `include`
 * (merged into the legs whose axis values it matches, or added as a leg of its own) and
 * `exclude`, capped at a number of legs. A matrix written as an expression is not run.
 */
import type { PlainValue } from './plain';
import { isPlainObject } from './plain';

export type MatrixScalar = string | number | boolean;
export type MatrixLeg = Readonly<Record<string, MatrixScalar>>;

export type MatrixPlan =
  | { readonly kind: 'none' }
  | { readonly kind: 'legs'; readonly legs: readonly MatrixLeg[] }
  | { readonly kind: 'invalid'; readonly reason: string };

/** The legs of `matrix` (the plain value under `strategy`), at most `maxLegs`. */
export function planMatrix(matrix: PlainValue | undefined, maxLegs: number): MatrixPlan {
  if (matrix === undefined || matrix === null) return { kind: 'none' };
  if (!isPlainObject(matrix))
    return { kind: 'invalid', reason: 'a matrix from an expression is not supported yet' };
  const axes: [string, MatrixScalar[]][] = [];
  for (const [key, values] of Object.entries(matrix)) {
    if (key === 'include' || key === 'exclude') continue;
    const scalars = Array.isArray(values) ? values.filter(isScalar) : [];
    if (!Array.isArray(values) || scalars.length !== values.length)
      return { kind: 'invalid', reason: `matrix axis ${key} must be a list of plain values` };
    axes.push([key, scalars]);
  }
  const include = entriesOf(matrix['include']);
  const exclude = entriesOf(matrix['exclude']);
  if (include === null || exclude === null)
    return { kind: 'invalid', reason: 'include and exclude must be lists of plain mappings' };
  const crossed = axes.length === 0 ? [] : cross(axes);
  const kept = crossed.filter((leg) => !exclude.some((entry) => matches(entry, leg)));
  const legs = applyInclude(kept, include, new Set(axes.map(([key]) => key)));
  if (legs.length === 0) return { kind: 'invalid', reason: 'the matrix has no legs' };
  if (legs.length > maxLegs)
    return {
      kind: 'invalid',
      reason: `the matrix has ${legs.length} legs; at most ${maxLegs} run`,
    };
  return { kind: 'legs', legs };
}

function cross(axes: readonly [string, readonly MatrixScalar[]][]): MatrixLeg[] {
  return axes.reduce<MatrixLeg[]>(
    (legs, [key, values]) =>
      legs.flatMap((leg) => values.map((value) => ({ ...leg, [key]: value }))),
    [{}],
  );
}

/** GitHub's rule: an entry extends every leg it does not contradict on an axis, else it is a new leg. */
function applyInclude(
  legs: readonly MatrixLeg[],
  include: readonly MatrixLeg[],
  axisKeys: ReadonlySet<string>,
): MatrixLeg[] {
  const result = [...legs];
  for (const entry of include) {
    let merged = false;
    for (const [index, leg] of legs.entries()) {
      const fits = Object.entries(entry).every(
        ([key, value]) => !axisKeys.has(key) || leg[key] === value,
      );
      if (fits) {
        result[index] = { ...result[index], ...entry };
        merged = true;
      }
    }
    if (!merged) result.push(entry);
  }
  return result;
}

function matches(entry: MatrixLeg, leg: MatrixLeg): boolean {
  return Object.entries(entry).every(([key, value]) => leg[key] === value);
}

function entriesOf(value: PlainValue | undefined): MatrixLeg[] | null {
  if (value === undefined || value === null) return [];
  if (!Array.isArray(value)) return null;
  const entries: MatrixLeg[] = [];
  for (const item of value) {
    if (!isPlainObject(item)) return null;
    const scalars = Object.entries(item).filter((pair): pair is [string, MatrixScalar] =>
      isScalar(pair[1]),
    );
    if (scalars.length !== Object.keys(item).length) return null;
    entries.push(Object.fromEntries(scalars));
  }
  return entries;
}

function isScalar(value: PlainValue): value is MatrixScalar {
  return typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean';
}
