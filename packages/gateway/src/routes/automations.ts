/**
 * Automations over HTTP (doc 25 §7.5): `POST /v1/automations/model/chat/completions`, the model
 * proxy an automation's agent loop calls from its job container with its job token.
 */
import { Hono } from 'hono';

import { readActionsConfig } from '../actions/actions-config';
import type { ModelRunner } from '../actions/model-proxy';
import { proxyModelCall } from '../actions/model-proxy';
import type { AppEnv } from '../app-env';

export const automationRoutes = new Hono<AppEnv>().post('/model/chat/completions', async (c) => {
  const body: unknown = await c.req.json().catch(() => null);
  return proxyModelCall(
    {
      db: c.env.FORGE,
      ai: aiOf(c.env),
      gatewayId: readActionsConfig(c.env).aiGatewayId,
      run: (runId) => c.env.ACTIONS_RUNS.getByName(runId),
      repo: (repoId) => c.env.ACTIONS_REPOS.getByName(repoId),
      now: Date.now,
    },
    { authorization: c.req.header('authorization') ?? null, body },
  );
});

/** The AI binding, when this deployment has one (tests and bare local dev do not). */
function aiOf(env: Env): ModelRunner | null {
  const binding: unknown = Reflect.get(env, 'AI');
  if (typeof binding !== 'object' || binding === null) return null;
  const run: unknown = Reflect.get(binding, 'run');
  if (typeof run !== 'function') return null;
  return {
    run: async (model, input, options) => Reflect.apply(run, binding, [model, input, options]),
  };
}
