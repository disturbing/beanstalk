import { env } from 'cloudflare:test';
import { describe, expect, it } from 'vitest';

import type { RpcResult } from '@gitstalk/shared-race/rpc';

import { mintJobToken, revokeJobTokens, tokenHash } from './job-tokens';
import type { ModelProxyDeps, ModelRunner } from './model-proxy';
import { proxyModelCall, usageOf } from './model-proxy';
import type { ModelCalls } from './run-store';

const MODEL = '@cf/moonshotai/kimi-k2.7-code';
const COMPLETION = {
  object: 'chat.completion',
  choices: [{ index: 0, message: { role: 'assistant', content: 'done' }, finish_reason: 'stop' }],
  usage: { prompt_tokens: 1_000_000, completion_tokens: 100_000, total_tokens: 1_100_000 },
};

type Fakes = {
  readonly calls: { model: string; input: Readonly<Record<string, unknown>> }[];
  charged: ModelCalls;
  repoSpent: number;
};

function depsWith(
  fakes: Fakes,
  options: {
    readonly allowance?: RpcResult<{ readonly model: string; readonly remainingUsd: number }>;
    readonly repoLimitUsd?: number;
    readonly ai?: ModelRunner | null;
  } = {},
): ModelProxyDeps {
  const ai: ModelRunner = {
    run: async (model, input) => {
      fakes.calls.push({ model, input });
      return COMPLETION;
    },
  };
  return {
    db: env.FORGE,
    ai: options.ai === undefined ? ai : options.ai,
    gatewayId: 'default',
    now: Date.now,
    run: () => ({
      modelAllowance: async () =>
        options.allowance ?? { ok: true, value: { model: MODEL, remainingUsd: 0.5 } },
      chargeModel: async (calls) => {
        fakes.charged = {
          calls: fakes.charged.calls + calls.calls,
          inputTokens: fakes.charged.inputTokens + calls.inputTokens,
          outputTokens: fakes.charged.outputTokens + calls.outputTokens,
          costUsd: fakes.charged.costUsd + calls.costUsd,
        };
        return fakes.charged;
      },
    }),
    repo: () => ({
      automationSpend: async () => ({
        spentUsd: fakes.repoSpent,
        limitUsd: options.repoLimitUsd ?? 10,
      }),
      addAutomationSpend: async (usd) => {
        fakes.repoSpent += usd;
      },
    }),
  };
}

function freshFakes(): Fakes {
  return {
    calls: [],
    charged: { calls: 0, inputTokens: 0, outputTokens: 0, costUsd: 0 },
    repoSpent: 0,
  };
}

async function automationToken(automationId: string | null): Promise<string> {
  return mintJobToken(env.FORGE, {
    repoId: 'r-proxy',
    engineId: 'e-proxy',
    runId: 'run-proxy',
    jobId: crypto.randomUUID(),
    canPush: false,
    expiresMs: Date.now() + 60_000,
    automationId,
  });
}

const BODY = { model: 'anything', messages: [{ role: 'user', content: 'hi' }], tools: [] };

describe('the automations model proxy (doc 25 §7.5)', () => {
  it('calls the file’s model through AI Gateway and charges the run and the repository', async () => {
    const fakes = freshFakes();
    const token = await automationToken('fix-red');
    const response = await proxyModelCall(depsWith(fakes), {
      authorization: `Bearer ${token}`,
      body: BODY,
    });
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual(COMPLETION);
    expect(fakes.calls[0]?.model).toBe(MODEL);
    expect(fakes.calls[0]?.input).not.toHaveProperty('model');
    // Kimi K2.7 code: $0.95 per million in, $4 per million out.
    expect(fakes.charged).toEqual({
      calls: 1,
      inputTokens: 1_000_000,
      outputTokens: 100_000,
      costUsd: 1.35,
    });
    expect(fakes.repoSpent).toBeCloseTo(1.35);
    expect(response.headers.get('x-beanstalk-run-cost-usd')).toBe('1.3500');
  });

  it('refuses a job token that is not an automation’s, or revoked, without calling a model', async () => {
    const fakes = freshFakes();
    const workflowToken = await automationToken(null);
    expect(
      (
        await proxyModelCall(depsWith(fakes), {
          authorization: `Bearer ${workflowToken}`,
          body: BODY,
        })
      ).status,
    ).toBe(401);
    const token = await automationToken('fix-red');
    await revokeJobTokens(env.FORGE, (await jobOfToken(token)) ?? '', Date.now());
    expect(
      (await proxyModelCall(depsWith(fakes), { authorization: `Bearer ${token}`, body: BODY }))
        .status,
    ).toBe(401);
    expect(
      (await proxyModelCall(depsWith(fakes), { authorization: null, body: BODY })).status,
    ).toBe(401);
    expect(fakes.calls).toEqual([]);
  });

  it('stops at the run’s cap and at the repository’s monthly cap', async () => {
    const fakes = freshFakes();
    const token = await automationToken('fix-red');
    const overRun = await proxyModelCall(
      depsWith(fakes, {
        allowance: {
          ok: false,
          error: { code: 'over_limit', status: 429, message: 'max-cost-usd reached' },
        },
      }),
      { authorization: `Bearer ${token}`, body: BODY },
    );
    expect(overRun.status).toBe(429);
    fakes.repoSpent = 10;
    const overRepo = await proxyModelCall(depsWith(fakes), {
      authorization: `Bearer ${token}`,
      body: BODY,
    });
    expect(overRepo.status).toBe(429);
    expect(fakes.calls).toEqual([]);
  });

  it('answers 503 without an AI binding and 400 for a body that is not a chat request', async () => {
    const token = await automationToken('fix-red');
    const fakes = freshFakes();
    expect(
      (
        await proxyModelCall(depsWith(fakes, { ai: null }), {
          authorization: `Bearer ${token}`,
          body: BODY,
        })
      ).status,
    ).toBe(503);
    expect(
      (await proxyModelCall(depsWith(fakes), { authorization: `Bearer ${token}`, body: {} }))
        .status,
    ).toBe(400);
  });

  it('counts tokens from either usage shape, and costs nothing for an unknown model', () => {
    expect(usageOf(MODEL, { usage: { input_tokens: 10, output_tokens: 5 } })).toMatchObject({
      inputTokens: 10,
      outputTokens: 5,
    });
    expect(usageOf('@cf/other', COMPLETION).costUsd).toBe(0);
    expect(usageOf(MODEL, {}).calls).toBe(1);
  });
});

async function jobOfToken(token: string): Promise<string | null> {
  const row = await env.FORGE.prepare('SELECT job_id FROM actions_job_tokens WHERE token_hash = ?')
    .bind(await tokenHash(token))
    .first<{ job_id: string }>();
  return row?.job_id ?? null;
}
