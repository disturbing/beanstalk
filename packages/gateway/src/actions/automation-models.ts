/**
 * The models an automation's agent may use (doc 25 §7.5): Workers AI models with function
 * calling, called through AI Gateway by the gateway's model proxy, never by the container. The
 * owner's decision of 2026-10-09 makes this the one place Workers AI does coding work. Prices
 * are Workers AI's list prices (USD per million tokens, read from the model catalog on
 * 2026-10-09); the proxy charges each call to the run and the repository with them.
 */

export type ModelPrice = { readonly inputPerM: number; readonly outputPerM: number };

/** The default: a coding-tuned model with tool calling and a 262k context. */
export const DEFAULT_AUTOMATION_MODEL = '@cf/moonshotai/kimi-k2.7-code';

export const AUTOMATION_MODELS: Readonly<Record<string, ModelPrice>> = {
  '@cf/moonshotai/kimi-k2.7-code': { inputPerM: 0.95, outputPerM: 4 },
  '@cf/moonshotai/kimi-k2.6': { inputPerM: 0.95, outputPerM: 4 },
  '@cf/openai/gpt-oss-120b': { inputPerM: 0.35, outputPerM: 0.75 },
  '@cf/openai/gpt-oss-20b': { inputPerM: 0.2, outputPerM: 0.3 },
  '@cf/zai-org/glm-5.3': { inputPerM: 1.4, outputPerM: 4.4 },
  '@cf/zai-org/glm-5.3-flash': { inputPerM: 0.15, outputPerM: 0.5 },
  '@cf/qwen/qwen3.8-27b': { inputPerM: 0.45, outputPerM: 3.2 },
  '@cf/deepseek-ai/deepseek-v4-pro-0813': { inputPerM: 1.32, outputPerM: 3.96 },
  '@cf/deepseek-ai/deepseek-v4-flash-0731': { inputPerM: 0.44, outputPerM: 1.32 },
};

/** Whether `model` is one an automation may name. */
export function isAutomationModel(model: string): boolean {
  return Object.hasOwn(AUTOMATION_MODELS, model);
}

/** What a call cost, from its token counts; an unknown model costs nothing (it is refused before). */
export function callCostUsd(
  model: string,
  usage: { readonly inputTokens: number; readonly outputTokens: number },
): number {
  const price = AUTOMATION_MODELS[model];
  if (price === undefined) return 0;
  return (usage.inputTokens * price.inputPerM + usage.outputTokens * price.outputPerM) / 1_000_000;
}
