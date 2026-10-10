import { env } from 'cloudflare:test';
import { describe, expect, it } from 'vitest';

import { ActionsRunId } from '@gitstalk/shared-race/actions';

import { mintJobToken, revokeJobTokens } from '../src/actions/job-tokens';
import { oidcJobEnv } from '../src/actions/oidc';
import type { JobRow, RunRecord } from '../src/actions/run-store';
import { ORIGIN, call } from './helpers';

/**
 * The Actions OIDC issuer mounted on the gateway: a job with `id-token: write` gets GitHub's
 * two variables, exchanges them for a signed identity token while it runs, and is refused once
 * its job token is revoked (the job ended).
 */
describe('Actions OIDC', () => {
  it('serves discovery and JWKS under /_actions/oidc', async () => {
    const discovery = await (
      await call('GET', '/_actions/oidc/.well-known/openid-configuration')
    ).json<{
      issuer: string;
      jwks_uri: string;
    }>();
    expect(discovery.issuer).toBe(`${ORIGIN}/_actions/oidc`);
    const jwks = await (
      await call('GET', '/_actions/oidc/.well-known/jwks')
    ).json<{ keys: { kid: string }[] }>();
    expect(jwks.keys.map((key) => key.kid)).toEqual(['test-key']);
    expect(JSON.stringify(jwks)).not.toContain('"d"');
  });

  it('mints request variables only for id-token: write, and issues tokens while the job runs', async () => {
    const run = runRecord();
    const job = jobRow({ idTokenWrite: true });
    expect(
      await oidcJobEnv({
        env,
        publicUrl: ORIGIN,
        run,
        job: jobRow({ idTokenWrite: false }),
        nowMs: Date.now(),
      }),
    ).toEqual({});
    const vars = await oidcJobEnv({ env, publicUrl: ORIGIN, run, job, nowMs: Date.now() });
    const url = vars['ACTIONS_ID_TOKEN_REQUEST_URL'] ?? '';
    const token = vars['ACTIONS_ID_TOKEN_REQUEST_TOKEN'] ?? '';
    expect(url).toBe(`${ORIGIN}/_actions/oidc/token?api-version=2.0`);
    const path = `${new URL(url).pathname}${new URL(url).search}&audience=sts.amazonaws.com`;

    // No running job holds a job token yet: refused.
    expect((await call('GET', path, { token })).status).toBe(403);
    await mintJobToken(env.FORGE, {
      repoId: 'r-oidc',
      engineId: 'rengineoidc0001',
      runId: run.request.runId,
      jobId: job.id,
      canPush: false,
      expiresMs: Date.now() + 60_000,
    });
    const issued = await call('GET', path, { token });
    expect(issued.status).toBe(200);
    const { value } = await issued.json<{ value: string }>();
    const claims = JSON.parse(
      atob((value.split('.')[1] ?? '').replaceAll('-', '+').replaceAll('_', '/')),
    ) as Record<string, unknown>;
    expect(claims).toMatchObject({
      iss: `${ORIGIN}/_actions/oidc`,
      aud: 'sts.amazonaws.com',
      repository: 'coop/shop',
      ref: 'refs/heads/main',
    });
    expect(String(claims['sub'])).toContain('repo:coop/shop');

    await revokeJobTokens(env.FORGE, job.id, Date.now());
    expect((await call('GET', path, { token })).status).toBe(403);
  });
});

function runRecord(): RunRecord {
  return {
    request: {
      runId: ActionsRunId.parse(crypto.randomUUID()),
      number: 7,
      repo: {
        id: 'r-oidc',
        ownerId: 'u-coop',
        ownerHandle: 'coop',
        name: 'shop',
        engineId: 'rengineoidc0001',
        defaultBranch: 'stalk',
        visibility: 'private',
      },
      workflow: { path: '.github/workflows/deploy.yml', source: '' },
      event: 'push',
      eventPayload: {},
      sha: 'a'.repeat(40),
      actor: 'coop',
      inputs: {},
      origin: { kind: 'stalk' },
      refused: null,
      createdMs: Date.now(),
    },
    workflowName: 'Deploy',
    status: 'in_progress',
    conclusion: null,
    reason: null,
    startedMs: Date.now(),
    completedMs: null,
    cancelRequested: false,
    vars: {},
    modelUsage: { calls: 0, inputTokens: 0, outputTokens: 0, costUsd: 0 },
  };
}

function jobRow(input: { readonly idTokenWrite: boolean }): JobRow {
  return {
    id: crypto.randomUUID(),
    key: 'deploy',
    name: 'deploy',
    matrix: null,
    needs: [],
    condition: 'success()',
    image: 'ubuntu-24.04',
    timeoutMinutes: 60,
    steps: [],
    outputs: {},
    secretNames: [],
    contentsWrite: false,
    idTokenWrite: input.idTokenWrite,
    status: 'in_progress',
    conclusion: null,
    reason: null,
    stepStates: [],
    outputValues: {},
    startedMs: Date.now(),
    completedMs: null,
    minutes: 0,
    reportHash: null,
    waitingSinceMs: null,
    lastSeq: 0,
  };
}
