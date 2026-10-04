/**
 * The picker: where the page decides what to show. Code computes a candidate list, a picker
 * orders it, nothing writes layout (`docs/claude-opus/14` §5). Two pickers share one shape:
 * - `rulesPicker`: each decision's own deterministic rule;
 * - `jevPicker`: Jev (TypeSafe's decision model, via Workers AI and AI Gateway) ranks the
 *   candidates; any failure, timeout or answer outside the catalog falls back to the rule.
 *
 * Every decision leaves a receipt, so the page can show what was asked, the candidates, what
 * was chosen and by whom.
 */
import { z } from 'zod';

export type PickCandidate = {
  readonly id: string;
  /** What Jev reads about the option: a description, never data values. */
  readonly description: string;
  /** How the receipt names it to a person. */
  readonly label: string;
};

export type RuleChoice = {
  /** Candidate ids, best first. */
  readonly chosen: readonly string[];
  /** The rule, in words, for the receipt. */
  readonly why: string;
};

export type PickDecision = {
  /** Stable name of the decision (`lead`, `route`, `files`, `sections`, `suggest`). */
  readonly id: string;
  readonly title: string;
  /** The instruction Jev gets. */
  readonly ask: string;
  /** Compact context Jev reads alongside the instruction (the question, a few flags). */
  readonly state: Readonly<Record<string, unknown>>;
  readonly candidates: readonly PickCandidate[];
  /** How many to keep, best first. */
  readonly slots: number;
  readonly rule: () => RuleChoice;
};

export type PickedBy = 'jev' | 'rules';

export type PickReceipt = {
  readonly decision: string;
  readonly title: string;
  readonly ask: string;
  readonly candidates: readonly PickCandidate[];
  readonly chosen: readonly string[];
  readonly by: PickedBy;
  /** Why the rule answered (or `Jev ranked…`). */
  readonly why: string;
  /** Jev's probability of its top choice; null for rules. */
  readonly confidence: number | null;
  readonly ms: number;
  /** Bytes of state plus candidate descriptions Jev reads. */
  readonly inputBytes: number;
};

export interface Picker {
  readonly name: PickedBy;
  decide(decision: PickDecision): Promise<PickReceipt>;
}

/** The slice of the Workers AI binding the Jev picker uses. */
export type JevRunner = {
  run(
    model: string,
    input: Readonly<Record<string, unknown>>,
    options?: Readonly<Record<string, unknown>>,
  ): Promise<unknown>;
};

export type JevOptions = {
  /** Workers AI model id of Jev. */
  readonly model: string;
  /** AI Gateway id the call goes through (logs, caching, unified billing); null for none. */
  readonly gateway: string | null;
  /** A decision must come back within this, or its rule answers. */
  readonly budgetMs: number;
  /** Where failures are reported (the caller's structured logger). */
  readonly onError?: (decision: string, error: unknown) => void;
};

export const JEV_MODEL = 'typesafe/jev';
export const JEV_BUDGET_MS = 1500;

const QUESTION_KEY = 'pick';

const JevAnswer = z.object({
  answers: z.record(
    z.string(),
    z.object({
      choice: z.string(),
      probabilities: z.record(z.string(), z.number()).optional(),
      confidence: z.number().optional(),
    }),
  ),
});

export const rulesPicker: Picker = {
  name: 'rules',
  decide: (decision) => Promise.resolve(byRule(decision, 0, '')),
};

export function jevPicker(ai: JevRunner, options: JevOptions): Picker {
  return {
    name: 'jev',
    decide: async (decision) => {
      const started = Date.now();
      if (decision.candidates.length < 2) return byRule(decision, 0, '');
      try {
        const answer = await withBudget(askJev(ai, options, decision), options.budgetMs);
        return { ...answer, ms: Date.now() - started };
      } catch (error: unknown) {
        options.onError?.(decision.id, error);
        return byRule(decision, Date.now() - started, ` Jev did not answer (${reason(error)}).`);
      }
    },
  };
}

/** Bytes of what a decision sends to Jev (shown on the receipt). */
export function inputBytes(decision: PickDecision): number {
  return JSON.stringify({ state: decision.state, criteria: criteriaOf(decision) }).length;
}

async function askJev(
  ai: JevRunner,
  options: JevOptions,
  decision: PickDecision,
): Promise<PickReceipt> {
  const raw = await ai.run(
    options.model,
    {
      state: decision.state,
      questions: {
        [QUESTION_KEY]: {
          type: 'choice',
          instructions: decision.ask,
          criteria: criteriaOf(decision),
        },
      },
    },
    options.gateway === null ? {} : { gateway: { id: options.gateway } },
  );
  const answer = JevAnswer.parse(unwrap(raw)).answers[QUESTION_KEY];
  if (answer === undefined) throw new Error('no answer for the question');
  const ids = decision.candidates.map((candidate) => candidate.id);
  if (!ids.includes(answer.choice)) throw new Error(`"${answer.choice}" is not a candidate`);
  return {
    ...receiptBase(decision),
    chosen: rankByProbability({
      decision,
      top: answer.choice,
      probabilities: answer.probabilities,
    }),
    by: 'jev',
    why: 'Jev ranked the candidates; ties follow the rule.',
    confidence: answer.confidence ?? answer.probabilities?.[answer.choice] ?? null,
    ms: 0,
  };
}

/** Jev's top choice first, then the others by probability, ties in the rule's order. */
function rankByProbability(input: {
  readonly decision: PickDecision;
  readonly top: string;
  readonly probabilities: Readonly<Record<string, number>> | undefined;
}): readonly string[] {
  const ruleOrder = input.decision.rule().chosen;
  const position = (id: string): number => {
    const at = ruleOrder.indexOf(id);
    return at === -1 ? ruleOrder.length : at;
  };
  const probability = (id: string): number => input.probabilities?.[id] ?? 0;
  const rest = input.decision.candidates
    .map((candidate) => candidate.id)
    .filter((id) => id !== input.top)
    .toSorted((a, b) => probability(b) - probability(a) || position(a) - position(b));
  return [input.top, ...rest].slice(0, input.decision.slots);
}

function byRule(decision: PickDecision, ms: number, note: string): PickReceipt {
  const rule = decision.rule();
  const ids = new Set(decision.candidates.map((candidate) => candidate.id));
  return {
    ...receiptBase(decision),
    chosen: rule.chosen.filter((id) => ids.has(id)).slice(0, decision.slots),
    by: 'rules',
    why: `${rule.why}${note}`,
    confidence: null,
    ms,
  };
}

function receiptBase(decision: PickDecision) {
  return {
    decision: decision.id,
    title: decision.title,
    ask: decision.ask,
    candidates: decision.candidates,
    inputBytes: inputBytes(decision),
  };
}

function criteriaOf(decision: PickDecision): Readonly<Record<string, string>> {
  return Object.fromEntries(
    decision.candidates.map((candidate) => [candidate.id, candidate.description]),
  );
}

/** The binding returns the answer; the REST API wraps it in `result` (twice). */
function unwrap(raw: unknown): unknown {
  let value = raw;
  for (let depth = 0; depth < 2; depth += 1) {
    if (typeof value !== 'object' || value === null || 'answers' in value) return value;
    value = Reflect.get(value, 'result') ?? value;
  }
  return value;
}

function withBudget<T>(promise: Promise<T>, ms: number): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error(`no answer within ${ms} ms`)), ms);
  });
  return Promise.race([promise, timeout]).finally(() => clearTimeout(timer));
}

function reason(error: unknown): string {
  return error instanceof Error ? error.message.slice(0, 120) : 'unknown error';
}
