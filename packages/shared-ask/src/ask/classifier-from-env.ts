/** Picks Ask's classifier from configuration: keywords unless Workers AI is set up. */
import type { Classifier } from './classifier';
import { keywordClassifier } from './classifier';
import type { AiRunner } from './workers-ai-classifier';
import { workersAiClassifier } from './workers-ai-classifier';

export type ClassifierConfig = {
  readonly name: string;
  readonly model: string;
  /** The optional `AI` binding; absent unless wrangler.jsonc declares it. */
  readonly ai: unknown;
};

export function classifierFrom(config: ClassifierConfig): Classifier {
  if (config.name !== 'workers-ai' || !isAiRunner(config.ai)) return keywordClassifier;
  return workersAiClassifier(config.ai, config.model);
}

function isAiRunner(value: unknown): value is AiRunner {
  return (
    typeof value === 'object' && value !== null && typeof Reflect.get(value, 'run') === 'function'
  );
}
