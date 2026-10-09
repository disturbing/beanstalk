/**
 * The automations' model proxy (doc 25 §7.5): `POST /v1/automations/model/chat/completions`.
 * An automation's agent loop calls it with its job token, never with a model key. The proxy
 * checks the token belongs to a running automation job, asks the run for the model the file
 * names and what the run may still spend, checks the repository's monthly cap, calls Workers AI
 * through AI Gateway with the AI binding (no key exists anywhere), and charges the call's
 * tokens to the run and the repository. The answer is the model's OpenAI-shaped completion.
 */
import type { RpcResult } from '@beanstalk/shared-race/rpc';
import { z } from 'zod';

import { callCostUsd } from '@beanstalk/shared-race/automation-models';
import { automationJobOf } from './job-tokens';
import type { ModelCalls } from './run-store';

/** The AI binding's `run`, as the proxy uses it (a fake in tests). */
export type ModelRunner = {
  run(
    model: string,
    input: Readonly<Record<string, unknown>>,
    options: {
      readonly gateway: { readonly id: string; readonly metadata: Record<string, string> };
    },
  ): Promise<unknown>;
};

export type ModelProxyDeps = {
  readonly db: D1Database;
  readonly ai: ModelRunner | null;
  readonly gatewayId: string;
  readonly run: (runId: string) => {
    modelAllowance(
      jobId: string,
    ): Promise<RpcResult<{ readonly model: string; readonly remainingUsd: number }>>;
    chargeModel(calls: ModelCalls): Promise<ModelCalls>;
  };
  readonly repo: (repoId: string) => {
    automationSpend(): Promise<{ readonly spentUsd: number; readonly limitUsd: number }>;
    addAutomationSpend(usd: number): Promise<void>;
  };
  readonly now: () => number;
};

const Body = z.object({
  messages: z.array(z.record(z.string(), z.unknown())).min(1).max(1000),
  tools: z.array(z.record(z.string(), z.unknown())).max(64).optional(),
  tool_choice: z.unknown().optional(),
  max_tokens: z.number().int().min(1).max(32_768).optional(),
  temperature: z.number().min(0).max(2).optional(),
});

const Usage = z
  .object({
    usage: z
      .object({
        prompt_tokens: z.number().optional(),
        completion_tokens: z.number().optional(),
        input_tokens: z.number().optional(),
        output_tokens: z.number().optional(),
      })
      .optional(),
  })
  .loose();

/** Answers one model call from an automation's job. */
export async function proxyModelCall(
  deps: ModelProxyDeps,
  request: { readonly authorization: string | null; readonly body: unknown },
): Promise<Response> {
  const token = /^Bearer\s+(\S+)$/i.exec(request.authorization ?? '')?.[1] ?? '';
  const job = await automationJobOf(deps.db, token, deps.now());
  if (job === null)
    return refusal(401, 'unauthorized', 'a running automation job token is required');
  const body = Body.safeParse(request.body);
  if (!body.success)
    return refusal(400, 'invalid_request', body.error.issues[0]?.message ?? 'invalid request');
  const run = deps.run(job.runId);
  const repo = deps.repo(job.repoId);
  const [allowance, spend] = await Promise.all([
    run.modelAllowance(job.jobId),
    repo.automationSpend(),
  ]);
  if (!allowance.ok)
    return refusal(allowance.error.status, allowance.error.code, allowance.error.message);
  if (spend.spentUsd >= spend.limitUsd)
    return refusal(
      429,
      'over_limit',
      `this repository's automation model spend for the month reached $${spend.limitUsd}`,
    );
  if (deps.ai === null)
    return refusal(503, 'not_configured', 'no Workers AI binding on this deployment');
  const answer = await callModel(deps, { model: allowance.value.model, body: body.data, job });
  if (!answer.ok) return refusal(502, 'upstream_failed', answer.error);
  const calls = usageOf(allowance.value.model, answer.value);
  const [total] = await Promise.all([
    run.chargeModel(calls),
    repo.addAutomationSpend(calls.costUsd),
  ]);
  return Response.json(answer.value, {
    headers: {
      'x-beanstalk-run-cost-usd': total.costUsd.toFixed(4),
      'x-beanstalk-model': allowance.value.model,
    },
  });
}

async function callModel(
  deps: ModelProxyDeps,
  input: {
    readonly model: string;
    readonly body: z.infer<typeof Body>;
    readonly job: {
      readonly repoId: string;
      readonly runId: string;
      readonly automationId: string;
    };
  },
): Promise<
  { readonly ok: true; readonly value: unknown } | { readonly ok: false; readonly error: string }
> {
  try {
    const value = await deps.ai?.run(
      input.model,
      { ...input.body, max_tokens: input.body.max_tokens ?? 8192 },
      {
        gateway: {
          id: deps.gatewayId,
          metadata: {
            repo: input.job.repoId,
            run: input.job.runId,
            automation: input.job.automationId,
          },
        },
      },
    );
    return { ok: true, value };
  } catch (error: unknown) {
    return { ok: false, error: error instanceof Error ? error.message : String(error) };
  }
}

/** The call's tokens and cost, from the completion's `usage` (zero when it has none). */
export function usageOf(model: string, completion: unknown): ModelCalls {
  const usage = Usage.safeParse(completion);
  const counts = usage.success ? usage.data.usage : undefined;
  const inputTokens = counts?.prompt_tokens ?? counts?.input_tokens ?? 0;
  const outputTokens = counts?.completion_tokens ?? counts?.output_tokens ?? 0;
  return {
    calls: 1,
    inputTokens,
    outputTokens,
    costUsd: callCostUsd(model, { inputTokens, outputTokens }),
  };
}

function refusal(status: number, code: string, message: string): Response {
  return Response.json({ error: { code, message } }, { status });
}
