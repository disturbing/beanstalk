import { SELF } from 'cloudflare:test';
import { createLocalJWKSet, jwtVerify } from 'jose';
import { describe, expect, it } from 'vitest';

import { mintIdTokenRequest } from '@gitstalk/shared-oidc/issuer';

import { TEST_REQUEST_SECRET } from './constants';

const ORIGIN = 'https://oidc.test';
const ISSUER = `${ORIGIN}/_actions/oidc`;

const job = {
  jobId: 'job-9',
  runId: 'run-9',
  runNumber: 3,
  runAttempt: 1,
  repository: {
    id: 'repo-9',
    owner: 'acme',
    ownerId: 'own-9',
    name: 'site',
    visibility: 'private' as const,
  },
  workflowPath: '.github/workflows/deploy.yml',
  workflowName: 'Deploy',
  workflowRef: 'refs/heads/stalk',
  actor: 'coop',
  actorId: 'usr-1',
  idTokenWrite: true,
  run: {
    kind: 'stalk' as const,
    event: 'push' as const,
    ref: 'refs/heads/stalk',
    sha: 'a'.repeat(40),
  },
};

describe('the oidc Worker', () => {
  it('serves discovery and a JWKS under the issuer path', async () => {
    const discovery = await SELF.fetch(`${ISSUER}/.well-known/openid-configuration`);
    const jwks = await SELF.fetch(`${ISSUER}/.well-known/jwks`);

    expect(await discovery.json()).toMatchObject({ issuer: ISSUER });
    expect(jwks.status).toBe(200);
  });

  it('issues a token a standard verifier accepts, end to end', async () => {
    const request = await mintIdTokenRequest(job, {
      issuerUrl: ISSUER,
      secrets: { current: TEST_REQUEST_SECRET },
      lifetimeSeconds: 600,
      nowMs: Date.now(),
    });
    if (request === null) throw new Error('expected a request');

    const response = await SELF.fetch(`${request.url}&audience=sts.example`, {
      headers: { Authorization: `bearer ${request.token}` },
    });
    const body: unknown = await response.json();
    const jwt =
      typeof body === 'object' && body !== null && 'value' in body ? String(body.value) : '';
    const keys = createLocalJWKSet(await (await SELF.fetch(`${ISSUER}/.well-known/jwks`)).json());
    const { payload } = await jwtVerify(jwt, keys, { issuer: ISSUER, audience: 'sts.example' });

    expect(payload).toMatchObject({ sub: 'repo:acme/site:ref:refs/heads/stalk', run_id: 'run-9' });
  });

  it('refuses a request without a token', async () => {
    const response = await SELF.fetch(`${ISSUER}/token?api-version=2.0`);

    expect(response.status).toBe(401);
  });
});
