/**
 * `${{ }}` expressions, evaluated with GitHub's own engine (`@actions/expressions`, MIT): job
 * `if:` conditions with the status functions, and display names with `matrix`. The control
 * plane evaluates only what decides the DAG; step expressions are the executor's.
 */
import { Evaluator, Lexer, Parser, data } from '@actions/expressions';
import type { FunctionDefinition } from '@actions/expressions/funcs/info';
import { truthy } from '@actions/expressions/result';

/** Plain JSON a context holds (`github`, `needs`, `inputs`, `matrix`, `vars`). */
export type ContextValue =
  | string
  | number
  | boolean
  | null
  | readonly ContextValue[]
  | { readonly [key: string]: ContextValue };

export type ExpressionContexts = Readonly<Record<string, ContextValue>>;

/** How the needed jobs and the run stand, for `success()`, `failure()` and `cancelled()`. */
export type StatusFacts = {
  readonly needsSucceeded: boolean;
  readonly needsFailed: boolean;
  readonly runCancelled: boolean;
};

export type Evaluated<T> =
  | { readonly ok: true; readonly value: T }
  | { readonly ok: false; readonly error: string };

/** A job `if:` (already normalized by the parser, `success() && (…)`), as a boolean. */
export function evaluateCondition(
  expression: string,
  contexts: ExpressionContexts,
  status: StatusFacts,
): Evaluated<boolean> {
  const evaluated = evaluate(expression, contexts, statusFunctions(status));
  return evaluated.ok ? { ok: true, value: truthy(evaluated.value) } : evaluated;
}

/**
 * A string with `${{ }}` parts (a job's `name:`), each part replaced by its value. A part that
 * does not evaluate is left as written.
 */
export function interpolate(template: string, contexts: ExpressionContexts): string {
  return template.replaceAll(/\$\{\{([\s\S]*?)\}\}/g, (whole, inner: string) => {
    const evaluated = evaluate(inner.trim(), contexts, new Map());
    return evaluated.ok ? evaluated.value.coerceString() : whole;
  });
}

function evaluate(
  expression: string,
  contexts: ExpressionContexts,
  functions: Map<string, FunctionDefinition>,
): Evaluated<data.ExpressionData> {
  try {
    const { tokens } = new Lexer(expression).lex();
    const infos = [...functions.values()].map(({ name, minArgs, maxArgs }) => ({
      name,
      minArgs,
      maxArgs,
    }));
    const tree = new Parser(tokens, Object.keys(contexts), infos).parse();
    const revived: unknown = JSON.parse(JSON.stringify(contexts), data.reviver);
    if (!(revived instanceof data.Dictionary)) return { ok: false, error: 'contexts' };
    return { ok: true, value: new Evaluator(tree, revived, functions).evaluate() };
  } catch (error: unknown) {
    return { ok: false, error: error instanceof Error ? error.message : String(error) };
  }
}

function statusFunctions(status: StatusFacts): Map<string, FunctionDefinition> {
  const constant = (name: string, value: boolean): [string, FunctionDefinition] => [
    name,
    { name, minArgs: 0, maxArgs: 0, call: () => new data.BooleanData(value) },
  ];
  return new Map([
    constant('success', status.needsSucceeded && !status.runCancelled),
    constant('failure', status.needsFailed),
    constant('cancelled', status.runCancelled),
    constant('always', true),
  ]);
}
