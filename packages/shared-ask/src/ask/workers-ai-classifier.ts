/**
 * The optional model classifier: a small Workers AI model picks the class and entities as a
 * constrained JSON choice over the catalog (`docs/claude-opus/13` §2, step 1). It is off by
 * default; any failure, timeout or invalid answer falls back to the keyword router.
 */
import { z } from 'zod';

import type { Classification, Classifier } from './classifier';
import { classifyByKeywords, validSpec } from './classifier';
import { CATALOG, QUESTION_CLASSES } from './view-spec';
import type { LineRef } from './view-spec';

/** The slice of the AI binding this classifier uses. */
export type AiRunner = {
  run(model: string, input: Readonly<Record<string, unknown>>): Promise<unknown>;
};

/** A routing answer must come back within this, or the keyword router answers instead. */
const CLASSIFY_TIMEOUT_MS = 2500;

const ModelAnswer = z.object({
  class: z.enum(QUESTION_CLASSES),
  feature: z.string().nullable().optional(),
  agent: z.string().nullable().optional(),
  bean: z.string().nullable().optional(),
  paths: z.array(z.string()).optional(),
});

const RESPONSE_SCHEMA = {
  type: 'object',
  properties: {
    class: { type: 'string', enum: [...QUESTION_CLASSES] },
    feature: { type: ['string', 'null'] },
    agent: { type: ['string', 'null'] },
    bean: { type: ['string', 'null'] },
    paths: { type: 'array', items: { type: 'string' } },
  },
  required: ['class'],
} as const;

export function workersAiClassifier(ai: AiRunner, model: string): Classifier {
  return {
    name: 'workers-ai',
    classify: async (question, defaultRef) => {
      const answer = await askModel(ai, model, question);
      return answer === undefined
        ? { spec: classifyByKeywords(question, defaultRef), by: 'keywords' }
        : merge(question, defaultRef, answer);
    },
  };
}

async function askModel(
  ai: AiRunner,
  model: string,
  question: string,
): Promise<z.infer<typeof ModelAnswer> | undefined> {
  try {
    const raw = await withTimeout(
      ai.run(model, {
        messages: [
          { role: 'system', content: systemPrompt() },
          { role: 'user', content: question },
        ],
        response_format: { type: 'json_schema', json_schema: RESPONSE_SCHEMA },
        max_tokens: 200,
        temperature: 0,
      }),
      CLASSIFY_TIMEOUT_MS,
    );
    return parseAnswer(raw);
  } catch {
    // The model is optional: an error or a timeout means the keyword router answers.
    return undefined;
  }
}

function parseAnswer(raw: unknown): z.infer<typeof ModelAnswer> | undefined {
  const envelope = z.object({ response: z.unknown() }).safeParse(raw);
  const body = envelope.success ? envelope.data.response : raw;
  const value = typeof body === 'string' ? safeJson(body) : body;
  const parsed = ModelAnswer.safeParse(value);
  return parsed.success ? parsed.data : undefined;
}

function safeJson(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    // Not JSON: the caller treats it as no answer.
    return undefined;
  }
}

/** The model picks the class; code keeps the entities it can read for itself. */
function merge(
  question: string,
  defaultRef: LineRef,
  answer: z.infer<typeof ModelAnswer>,
): Classification {
  const fallback = classifyByKeywords(question, defaultRef);
  const spec = validSpec({
    class: answer.class,
    entities: {
      feature: answer.feature ?? fallback.entities.feature,
      paths: answer.paths ?? fallback.entities.paths,
      agent: answer.agent ?? fallback.entities.agent,
      bean: answer.bean ?? fallback.entities.bean,
    },
    range: fallback.range,
  });
  return spec === undefined ? { spec: fallback, by: 'keywords' } : { spec, by: 'workers-ai' };
}

function systemPrompt(): string {
  const classes = QUESTION_CLASSES.map(
    (name) => `- ${name}: ${CATALOG[name].description} Example: "${CATALOG[name].example}"`,
  ).join('\n');
  return [
    'You route questions about a code repository to one view of a fixed catalog.',
    'Answer with JSON only: {"class", "feature", "agent", "bean", "paths"}.',
    "feature: the code area or topic asked about, in the question's words, or null.",
    'agent: an agent slot like "a3", or null. bean: a bean id like "t032", or null.',
    'paths: file or folder paths named in the question.',
    'Classes:',
    classes,
  ].join('\n');
}

function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
  return Promise.race([
    promise,
    new Promise<never>((_, reject) => {
      setTimeout(() => reject(new Error(`no answer within ${ms} ms`)), ms);
    }),
  ]);
}
