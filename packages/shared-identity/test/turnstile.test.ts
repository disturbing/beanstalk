import { describe, expect, it } from 'vitest';

import type { Fetcher, TurnstileVerifier } from '../src/turnstile';
import { turnstileGate, turnstileSetup, verifyTurnstile } from '../src/turnstile';

const VERIFIER: TurnstileVerifier = {
  secret: 'real-secret',
  hostnames: ['beanstalk.test'],
  allowTestKeys: false,
};

/** Siteverify is external HTTP: answered here, and every request it got is kept. */
function siteverify(answer: unknown, status = 200) {
  const requests: URLSearchParams[] = [];
  const fetcher: Fetcher = async (_url, init) => {
    requests.push(new URLSearchParams(init.body instanceof URLSearchParams ? init.body : ''));
    return Response.json(answer, { status });
  };
  return { fetcher, requests };
}

const thrown: Fetcher = async () => {
  throw new TypeError('network');
};

const PASS = { success: true, action: 'signin', hostname: 'beanstalk.test' };

describe('Turnstile setup', () => {
  it('is on only when both the site key and the secret are configured', () => {
    expect(turnstileSetup({}, undefined, 'h')).toEqual({ kind: 'off', missing: null });
    expect(turnstileSetup({ TURNSTILE_SITE_KEY: ' ' }, ' ', 'h')).toEqual({
      kind: 'off',
      missing: null,
    });
    expect(turnstileSetup({}, 'secret', 'h')).toEqual({ kind: 'off', missing: 'site key' });
    expect(turnstileSetup({ TURNSTILE_SITE_KEY: 'site' }, undefined, 'h')).toEqual({
      kind: 'off',
      missing: 'secret',
    });
    expect(turnstileSetup({ TURNSTILE_SITE_KEY: 'site' }, 'secret', 'h').kind).toBe('on');
  });

  it('expects the request host unless hostnames are listed', () => {
    const own = turnstileSetup({ TURNSTILE_SITE_KEY: 'site' }, 's', 'beanstalk.test');
    expect(own.kind === 'on' ? own.verifier.hostnames : []).toEqual(['beanstalk.test']);
    const listed = turnstileSetup(
      { TURNSTILE_SITE_KEY: 'site', TURNSTILE_HOSTNAMES: 'a.test, b.test' },
      's',
      'beanstalk.test',
    );
    expect(listed.kind === 'on' ? listed.verifier.hostnames : []).toEqual(['a.test', 'b.test']);
  });
});

describe('verifying a Turnstile token', () => {
  it('accepts a solved token for this action and host, sending the secret and the IP', async () => {
    const { fetcher, requests } = siteverify(PASS);
    const verdict = await verifyTurnstile(VERIFIER, {
      token: 'tok',
      action: 'signin',
      ip: '203.0.113.7',
      fetcher,
    });
    expect(verdict).toEqual({ ok: true });
    expect(requests[0]?.get('secret')).toBe('real-secret');
    expect(requests[0]?.get('response')).toBe('tok');
    expect(requests[0]?.get('remoteip')).toBe('203.0.113.7');
  });

  it('refuses a missing or oversized token without calling Siteverify', async () => {
    const { fetcher, requests } = siteverify(PASS);
    const verdicts = await Promise.all(
      [undefined, '', 'x'.repeat(2049)].map((token) =>
        verifyTurnstile(VERIFIER, { token, action: 'signin', ip: null, fetcher }),
      ),
    );
    expect(verdicts.every((verdict) => !verdict.ok && verdict.reason === 'missing')).toBe(true);
    expect(requests).toHaveLength(0);
  });

  it('refuses a token Siteverify refuses (spent, expired or forged)', async () => {
    const { fetcher } = siteverify({ success: false, 'error-codes': ['timeout-or-duplicate'] });
    expect(
      await verifyTurnstile(VERIFIER, { token: 't', action: 'signin', ip: null, fetcher }),
    ).toEqual({ ok: false, reason: 'refused' });
  });

  it('refuses a token solved for another action or on another host', async () => {
    const other = siteverify({ ...PASS, action: 'signup' });
    expect(
      await verifyTurnstile(VERIFIER, {
        token: 't',
        action: 'signin',
        ip: null,
        fetcher: other.fetcher,
      }),
    ).toEqual({ ok: false, reason: 'wrong_action' });
    const elsewhere = siteverify({ ...PASS, hostname: 'evil.test' });
    expect(
      await verifyTurnstile(VERIFIER, {
        token: 't',
        action: 'signin',
        ip: null,
        fetcher: elsewhere.fetcher,
      }),
    ).toEqual({ ok: false, reason: 'wrong_hostname' });
  });

  it('accepts test-key results only where the deployment allows them', async () => {
    const testing = {
      success: true,
      hostname: 'example.com',
      metadata: { result_with_testing_key: true },
    };
    const { fetcher } = siteverify(testing);
    expect(
      await verifyTurnstile(VERIFIER, { token: 't', action: 'signup', ip: null, fetcher }),
    ).toEqual({ ok: false, reason: 'test_key' });
    expect(
      await verifyTurnstile(
        { ...VERIFIER, allowTestKeys: true },
        { token: 't', action: 'signup', ip: null, fetcher },
      ),
    ).toEqual({ ok: true });
  });

  it('fails closed when Siteverify is down or answers nonsense', async () => {
    const down = siteverify({}, 503);
    expect(
      await verifyTurnstile(VERIFIER, {
        token: 't',
        action: 'signin',
        ip: null,
        fetcher: down.fetcher,
      }),
    ).toEqual({ ok: false, reason: 'unavailable' });
    expect(
      await verifyTurnstile(VERIFIER, { token: 't', action: 'signin', ip: null, fetcher: thrown }),
    ).toEqual({ ok: false, reason: 'unavailable' });
    const nonsense = siteverify({ yes: 1 });
    expect(
      await verifyTurnstile(VERIFIER, {
        token: 't',
        action: 'signin',
        ip: null,
        fetcher: nonsense.fetcher,
      }),
    ).toEqual({ ok: false, reason: 'unavailable' });
  });
});

describe('the sign-in and sign-up gate', () => {
  it('lets every request through without asking Siteverify while Turnstile is unconfigured', async () => {
    const { fetcher, requests } = siteverify({ success: false });
    for (const [siteKey, secret] of [
      [undefined, undefined],
      ['site', undefined],
      [undefined, 'secret'],
    ] as const) {
      const vars = siteKey === undefined ? {} : { TURNSTILE_SITE_KEY: siteKey };
      const setup = turnstileSetup(vars, secret, 'beanstalk.test');
      for (const action of ['signin', 'signup'] as const) {
        // oxlint-disable-next-line no-await-in-loop -- each state in turn
        expect(await turnstileGate(setup, { token: undefined, action, ip: null, fetcher })).toEqual(
          { ok: true },
        );
      }
    }
    expect(requests).toHaveLength(0);
  });

  it('requires a token Siteverify accepts once both keys are configured', async () => {
    const setup = turnstileSetup({ TURNSTILE_SITE_KEY: 'site' }, 'real-secret', 'beanstalk.test');
    const pass = siteverify({ ...PASS, action: 'signup' });
    expect(
      await turnstileGate(setup, {
        token: undefined,
        action: 'signup',
        ip: null,
        fetcher: pass.fetcher,
      }),
    ).toEqual({ ok: false, reason: 'missing' });
    expect(
      await turnstileGate(setup, {
        token: 'tok',
        action: 'signup',
        ip: null,
        fetcher: pass.fetcher,
      }),
    ).toEqual({ ok: true });
    expect(pass.requests).toHaveLength(1);
    const fail = siteverify({ success: false });
    expect(
      await turnstileGate(setup, {
        token: 'tok',
        action: 'signup',
        ip: null,
        fetcher: fail.fetcher,
      }),
    ).toEqual({ ok: false, reason: 'refused' });
  });
});
