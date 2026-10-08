import { createLocalJWKSet, jwtVerify } from 'jose';
import { describe, expect, it } from 'vitest';
import { z } from 'zod';

import type { OidcConfig } from '../src/issuer';
import {
  issuerUrlFor,
  loadOidcConfig,
  mintIdTokenRequest,
  OidcNotConfiguredError,
} from '../src/issuer';
import { signRequestToken } from '../src/request-token';
import { loadSigningKeys, SigningKeysError } from '../src/signing-keys';
import type { IdTokenJob } from '../src/job-identity';
import {
  appFor,
  ISSUER,
  keySetJson,
  makeConfig,
  NOW_MS,
  pathOf,
  prelandJob,
  REQUEST_SECRET,
  stalkJob,
} from './helpers';

async function requestFor(config: OidcConfig, job: IdTokenJob) {
  const minted = await mintIdTokenRequest(job, {
    issuerUrl: config.issuerUrl,
    secrets: config.requestSecrets,
    lifetimeSeconds: 3900,
    nowMs: NOW_MS,
    allowUntrustedPreland: true,
  });
  if (minted === null) throw new Error('expected a request');
  return minted;
}

const TokenBody = z.object({ value: z.string(), count: z.number() });

async function fetchToken(
  config: OidcConfig,
  request: { url: string; token: string },
  audience?: string,
) {
  const suffix = audience === undefined ? '' : `&audience=${encodeURIComponent(audience)}`;
  const response = await appFor(config).request(`${pathOf(request.url)}${suffix}`, {
    headers: { Authorization: `bearer ${request.token}` },
  });
  return {
    status: response.status,
    headers: response.headers,
    json: async () => TokenBody.parse(await response.json()),
  };
}

/** Verifies like a cloud provider: JWKS from the issuer's own endpoint, standard JOSE. */
async function verify(config: OidcConfig, jwt: string, audience: string) {
  const jwks = await appFor(config).request('/.well-known/jwks');
  const keys = createLocalJWKSet(await jwks.json());
  return jwtVerify(jwt, keys, {
    issuer: ISSUER,
    audience,
    currentDate: new Date(NOW_MS + 1000),
  });
}

describe('discovery and JWKS', () => {
  it('publishes an OIDC discovery document pointing at the JWKS', async () => {
    const config = await makeConfig(await keySetJson(['RS256', 'ES256']));
    const response = await appFor(config).request('/.well-known/openid-configuration');
    const document = await response.json();

    expect(response.status).toBe(200);
    expect(document).toMatchObject({
      issuer: ISSUER,
      jwks_uri: `${ISSUER}/.well-known/jwks`,
      id_token_signing_alg_values_supported: ['RS256', 'ES256'],
    });
  });

  it('publishes public keys only', async () => {
    const config = await makeConfig(await keySetJson(['RS256', 'ES256']));
    const body = await (await appFor(config).request('/.well-known/jwks')).text();
    const { keys } = JSON.parse(body);

    expect(keys).toHaveLength(2);
    for (const key of keys) {
      expect(key).toMatchObject({ use: 'sig' });
      for (const secretPart of ['d', 'p', 'q', 'dp', 'dq', 'qi'])
        expect(key).not.toHaveProperty(secretPart);
    }
  });

  it('derives the issuer from the origin unless OIDC_ISSUER_URL is set', () => {
    expect(issuerUrlFor({}, 'https://host.example')).toBe('https://host.example/_actions/oidc');
    expect(issuerUrlFor({ OIDC_ISSUER_URL: 'https://git.corp.example/oidc/' }, 'https://x')).toBe(
      'https://git.corp.example/oidc',
    );
  });

  it('answers 503 while the secrets are missing', async () => {
    const app = (await import('../src/issuer')).createOidcApp((request) =>
      loadOidcConfig({}, new URL(request.url).origin),
    );

    expect((await app.request('/.well-known/jwks')).status).toBe(503);
    await expect(loadOidcConfig({}, 'https://x')).rejects.toBeInstanceOf(OidcNotConfiguredError);
  });
});

describe('the token endpoint', () => {
  it.each(['RS256', 'ES256'] as const)(
    'issues a %s token a standard verifier accepts',
    async (alg) => {
      const config = await makeConfig(await keySetJson([alg]));
      const response = await fetchToken(
        config,
        await requestFor(config, stalkJob()),
        'sts.example',
      );
      const { value, count } = await response.json();

      expect(response.status).toBe(200);
      expect(count).toBe(value.length);
      const verified = await verify(config, value, 'sts.example');
      expect(verified.protectedHeader).toMatchObject({ alg, typ: 'JWT' });
    },
  );

  it('puts the stalk run claims in a push token', async () => {
    const config = await makeConfig(await keySetJson(['RS256']));
    const { value } = await (
      await fetchToken(config, await requestFor(config, stalkJob()), 'a')
    ).json();
    const { payload } = await verify(config, value, 'a');

    expect(payload).toMatchObject({
      iss: ISSUER,
      aud: 'a',
      sub: 'repo:acme/site:ref:refs/heads/stalk',
      repository: 'acme/site',
      repository_owner: 'acme',
      repository_id: 'repo-1',
      ref: 'refs/heads/stalk',
      sha: 'a'.repeat(40),
      workflow: 'Deploy',
      workflow_ref: 'acme/site/.github/workflows/deploy.yml@refs/heads/stalk',
      job_workflow_ref: 'acme/site/.github/workflows/deploy.yml@refs/heads/stalk',
      run_id: 'run-1',
      run_attempt: '1',
      actor: 'coop',
      event_name: 'push',
      runner_environment: 'beanstalk-hosted',
      trust: 'stalk',
    });
    expect(payload).not.toHaveProperty('environment');
  });

  it.each(['workflow_dispatch', 'schedule'] as const)('reports the %s event', async (event) => {
    const config = await makeConfig(await keySetJson(['RS256']));
    const job = stalkJob({
      run: { kind: 'stalk', event, ref: 'refs/heads/stalk', sha: 'c'.repeat(40) },
    });
    const { value } = await (await fetchToken(config, await requestFor(config, job), 'a')).json();

    expect((await verify(config, value, 'a')).payload.event_name).toBe(event);
  });

  it('uses the environment as the subject when the job names one', async () => {
    const config = await makeConfig(await keySetJson(['RS256']));
    const job = stalkJob({ environment: 'production' });
    const { value } = await (await fetchToken(config, await requestFor(config, job), 'a')).json();
    const { payload } = await verify(config, value, 'a');

    expect(payload).toMatchObject({
      sub: 'repo:acme/site:environment:production',
      environment: 'production',
    });
  });

  it('gives a maintainer bean pre-land check the pull_request shape', async () => {
    const config = await makeConfig(await keySetJson(['RS256']));
    const { value } = await (
      await fetchToken(config, await requestFor(config, prelandJob('maintainer')), 'a')
    ).json();
    const { payload } = await verify(config, value, 'a');

    expect(payload).toMatchObject({
      sub: 'repo:acme/site:pull_request',
      event_name: 'pull_request',
      ref: 'refs/heads/bean/fix-nav',
      head_ref: 'bean/fix-nav',
      base_ref: 'main',
      trust: 'preland',
      bean: 'fix-nav',
    });
  });

  it.each(['agent', 'deploy_token', 'collaborator'] as const)(
    'marks a bean pushed by %s as untrusted with a subject no stalk policy matches',
    async (pusher) => {
      const config = await makeConfig(await keySetJson(['RS256']));
      const job = { ...prelandJob(pusher), environment: 'production' };
      const { value } = await (await fetchToken(config, await requestFor(config, job), 'a')).json();
      const { payload } = await verify(config, value, 'a');

      expect(payload).toMatchObject({
        sub: `repo:acme/site:preland-untrusted:${pusher}`,
        trust: 'preland_untrusted',
        pusher,
      });
      expect(payload).not.toHaveProperty('environment');
      expect(String(payload.sub)).not.toMatch(/:(ref|environment):|:pull_request$/);
    },
  );

  it('defaults the audience to the owner URL and takes a custom one', async () => {
    const config = await makeConfig(await keySetJson(['RS256']));
    const request = await requestFor(config, stalkJob());
    const byDefault = await (await fetchToken(config, request)).json();

    expect(
      (await verify(config, byDefault.value, 'https://beanstalk.example/acme')).payload.aud,
    ).toBe('https://beanstalk.example/acme');
  });

  it('refuses an empty or malformed audience', async () => {
    const config = await makeConfig(await keySetJson(['RS256']));
    const request = await requestFor(config, stalkJob());

    expect((await fetchToken(config, request, '')).status).toBe(400);
    expect((await fetchToken(config, request, 'has space')).status).toBe(400);
    expect((await fetchToken(config, request, 'x'.repeat(257))).status).toBe(400);
  });

  it('expires within ten minutes, with nbf equal to iat and a fresh jti each time', async () => {
    const config = await makeConfig(await keySetJson(['RS256']), { tokenTtlSeconds: 99_999 });
    const request = await requestFor(config, stalkJob());
    const first = await (await fetchToken(config, request, 'a')).json();
    const second = await (await fetchToken(config, request, 'a')).json();
    const { payload } = await verify(config, first.value, 'a');
    const other = await verify(config, second.value, 'a');

    expect(payload.iat).toBe(NOW_MS / 1000);
    expect(payload.nbf).toBe(payload.iat);
    expect(Number(payload.exp) - Number(payload.iat)).toBeLessThanOrEqual(600);
    expect(payload.jti).not.toBe(other.payload.jti);
  });

  it('is rejected by the verifier after exp', async () => {
    const config = await makeConfig(await keySetJson(['RS256']));
    const { value } = await (
      await fetchToken(config, await requestFor(config, stalkJob()), 'a')
    ).json();
    const jwks = createLocalJWKSet(
      await (await appFor(config).request('/.well-known/jwks')).json(),
    );

    await expect(
      jwtVerify(value, jwks, { currentDate: new Date(NOW_MS + 11 * 60 * 1000) }),
    ).rejects.toThrow();
  });

  it('is rejected by the verifier for another audience', async () => {
    const config = await makeConfig(await keySetJson(['RS256']));
    const { value } = await (
      await fetchToken(config, await requestFor(config, stalkJob()), 'a')
    ).json();

    await expect(verify(config, value, 'b')).rejects.toThrow();
  });
});

describe('request token authentication', () => {
  it('refuses a call without a bearer token', async () => {
    const config = await makeConfig(await keySetJson(['RS256']));
    const response = await appFor(config).request('/token?api-version=2.0');

    expect(response.status).toBe(401);
    expect(response.headers.get('WWW-Authenticate')).toContain('Bearer');
  });

  it('refuses garbage and a token signed with another secret', async () => {
    const config = await makeConfig(await keySetJson(['RS256']));
    const forged = await signRequestToken(
      stalkJob(),
      { current: 'x'.repeat(40) },
      NOW_MS / 1000 + 600,
    );

    expect(
      (await fetchToken(config, { url: `${ISSUER}/token?api-version=2.0`, token: 'nonsense' }))
        .status,
    ).toBe(401);
    expect(
      (await fetchToken(config, { url: `${ISSUER}/token?api-version=2.0`, token: forged })).status,
    ).toBe(401);
  });

  it('refuses an expired request token', async () => {
    const config = await makeConfig(await keySetJson(['RS256']));
    const request = await requestFor(config, stalkJob());
    const later = { ...config, nowMs: () => NOW_MS + 3901 * 1000 };

    expect((await fetchToken(later, request, 'a')).status).toBe(401);
  });

  it('refuses a token whose payload was swapped for another job', async () => {
    const config = await makeConfig(await keySetJson(['RS256']));
    const mine = await requestFor(config, stalkJob());
    const theirs = await requestFor(config, stalkJob({ jobId: 'job-2', runId: 'run-2' }));
    const [prefix, , mac] = mine.token.split('.');
    const swapped = `${prefix}.${theirs.token.split('.')[1]}.${mac}`;

    expect((await fetchToken(config, { url: mine.url, token: swapped })).status).toBe(401);
  });

  it('only ever yields claims of the job the token was minted for', async () => {
    const config = await makeConfig(await keySetJson(['RS256']));
    const one = await requestFor(config, stalkJob({ jobId: 'job-1', runId: 'run-1' }));
    const two = await requestFor(config, stalkJob({ jobId: 'job-2', runId: 'run-2' }));
    const first = await (await fetchToken(config, one, 'a')).json();
    const second = await (await fetchToken(config, two, 'a')).json();

    expect((await verify(config, first.value, 'a')).payload.run_id).toBe('run-1');
    expect((await verify(config, second.value, 'a')).payload.run_id).toBe('run-2');
  });

  it('refuses a request token once its job is no longer active', async () => {
    const ended = new Set<string>();
    const config = await makeConfig(await keySetJson(['RS256']), {
      isJobActive: (jobId) => Promise.resolve(!ended.has(jobId)),
    });
    const request = await requestFor(config, stalkJob());

    expect((await fetchToken(config, request, 'a')).status).toBe(200);
    ended.add('job-1');
    expect((await fetchToken(config, request, 'a')).status).toBe(403);
  });

  it('keeps accepting tokens signed with the previous request secret', async () => {
    const config = await makeConfig(await keySetJson(['RS256']));
    const old = await requestFor(config, stalkJob());
    const rotated = {
      ...config,
      requestSecrets: { current: 'n'.repeat(40), previous: REQUEST_SECRET },
    };

    expect((await fetchToken(rotated, old, 'a')).status).toBe(200);
    expect(
      (await fetchToken({ ...rotated, requestSecrets: { current: 'n'.repeat(40) } }, old, 'a'))
        .status,
    ).toBe(401);
  });

  it('mints nothing without id-token: write, and nothing for untrusted pre-land runs by default', async () => {
    const options = {
      issuerUrl: ISSUER,
      secrets: { current: REQUEST_SECRET },
      lifetimeSeconds: 600,
      nowMs: NOW_MS,
    };

    expect(await mintIdTokenRequest(stalkJob({ idTokenWrite: false }), options)).toBeNull();
    expect(await mintIdTokenRequest(prelandJob('agent'), options)).toBeNull();
    expect(await mintIdTokenRequest(prelandJob('maintainer'), options)).not.toBeNull();
    expect(
      await mintIdTokenRequest(prelandJob('agent'), { ...options, allowUntrustedPreland: true }),
    ).not.toBeNull();
  });

  it('gives a request URL that already has a query string, as core.getIDToken expects', async () => {
    const config = await makeConfig(await keySetJson(['RS256']));
    const { url } = await requestFor(config, stalkJob());

    expect(url).toBe(`${ISSUER}/token?api-version=2.0`);
  });
});

describe('key rotation', () => {
  it('publishes both keys, signs with the active one and keeps old tokens verifiable', async () => {
    const set = JSON.parse(await keySetJson(['RS256', 'RS256']));
    const beforeConfig = await makeConfig(JSON.stringify({ ...set, active: set.keys[0].kid }));
    const afterConfig = await makeConfig(JSON.stringify({ ...set, active: set.keys[1].kid }));
    const request = await requestFor(beforeConfig, stalkJob());
    const before = await (await fetchToken(beforeConfig, request, 'a')).json();
    const after = await (await fetchToken(afterConfig, request, 'a')).json();

    expect((await verify(beforeConfig, before.value, 'a')).protectedHeader.kid).toBe(
      set.keys[0].kid,
    );
    expect((await verify(afterConfig, after.value, 'a')).protectedHeader.kid).toBe(set.keys[1].kid);
    // The old token still verifies against the rotated JWKS: it lists both keys.
    expect((await verify(afterConfig, before.value, 'a')).payload.run_id).toBe('run-1');
  });

  it('refuses a key set that is malformed, has duplicate kids or an unknown active key', async () => {
    const set = JSON.parse(await keySetJson(['RS256', 'ES256']));

    await expect(loadSigningKeys('{}')).rejects.toBeInstanceOf(SigningKeysError);
    await expect(
      loadSigningKeys(JSON.stringify({ ...set, active: 'missing' })),
    ).rejects.toBeInstanceOf(SigningKeysError);
    await expect(
      loadSigningKeys(JSON.stringify({ ...set, keys: [set.keys[0], set.keys[0]] })),
    ).rejects.toBeInstanceOf(SigningKeysError);
  });

  it('does not put key material in the error for a bad key set', async () => {
    const set = JSON.parse(await keySetJson(['RS256']));
    const broken = JSON.stringify({ ...set, keys: [{ ...set.keys[0], d: 'secret-material-123' }] });
    const failure = await loadSigningKeys(broken).catch((error: unknown) => error);

    expect(String(failure)).not.toContain('secret-material-123');
  });
});
