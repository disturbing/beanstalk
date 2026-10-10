import { createLogger, isLogLevel } from './log';
import type { Logger } from './log';

/** The Worker's vars, and the optional secrets read only when present. */
export type SwarmConfig = {
  readonly modelUpstream: string;
  readonly chatgptUpstream: string;
  readonly chatgptTokenUrl: string;
  readonly maxAgents: number;
  readonly openaiApiKey: string | null;
  readonly gatewayAdminToken: string | null;
};

export function swarmConfig(env: Env): SwarmConfig {
  return {
    modelUpstream: env.MODEL_UPSTREAM.replace(/\/+$/, ''),
    chatgptUpstream: env.CHATGPT_UPSTREAM.replace(/\/+$/, ''),
    chatgptTokenUrl: env.CHATGPT_TOKEN_URL,
    maxAgents: Math.max(1, Number.parseInt(env.MAX_AGENTS, 10) || 1),
    openaiApiKey: optionalSecret(env, 'OPENAI_API_KEY'),
    gatewayAdminToken: optionalSecret(env, 'GATEWAY_ADMIN_TOKEN'),
  };
}

/** A secret that is not declared in wrangler.jsonc (so not in the generated Env), if set. */
function optionalSecret(env: Env, name: string): string | null {
  const value: unknown = Reflect.get(env, name);
  return typeof value === 'string' && value.trim() !== '' ? value.trim() : null;
}

export function loggerFor(env: Env, component: string): Logger {
  return createLogger(isLogLevel(env.LOG_LEVEL) ? env.LOG_LEVEL : 'info', { component });
}
