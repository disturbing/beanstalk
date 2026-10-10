import { env } from 'cloudflare:test';
import { exports } from 'cloudflare:workers';
import { describe, expect, it } from 'vitest';

import type { RepositoryRecord } from '@gitstalk/shared-race/repos';
import type { RpcResult } from '@gitstalk/shared-race/rpc';

import { call, json } from './helpers';

const gateway = exports.default;
let people = 0;

function owner() {
  people += 1;
  return {
    id: `u_deploy_${people}_${crypto.randomUUID().slice(0, 8)}`,
    handle: `deployer${people}`,
  };
}

function value<T>(result: RpcResult<T>): T {
  if (!result.ok) throw new Error(`${result.error.code}: ${result.error.message}`);
  return result.value;
}

async function repository(
  who: { id: string; handle: string },
  name: string,
): Promise<RepositoryRecord> {
  return value(
    await gateway.createRepository(who, { name, visibility: 'private', start: { kind: 'empty' } }),
  );
}

function refs(
  who: { handle: string },
  name: string,
  service: 'upload' | 'receive',
  token?: string,
) {
  return call('GET', `/git/${who.handle}/${name}.git/info/refs?service=git-${service}-pack`, {
    ...(token === undefined ? {} : { token }),
    headers: { 'user-agent': 'git/2.53.0' },
  });
}

describe('deploy tokens', () => {
  it('opens one repository for reading, and pushing only with write access', async () => {
    const coop = owner();
    const repo = await repository(coop, 'ci-target');
    const other = await repository(coop, 'ci-other');
    const reader = value(
      await gateway.createDeployToken(coop, repo.id, { name: 'CI read', access: 'read', days: 30 }),
    );
    const writer = value(
      await gateway.createDeployToken(coop, repo.id, { name: 'CI push', access: 'write', days: 7 }),
    );
    expect(reader.token).toMatch(/^bsd_[A-Za-z0-9_-]{43}$/);
    expect(reader.summary).toMatchObject({
      name: 'CI read',
      access: 'read',
      createdByHandle: coop.handle,
      lastUsedAt: null,
    });

    expect((await refs(coop, 'ci-target', 'upload', reader.token)).status).toBe(200);
    expect((await refs(coop, 'ci-other', 'upload', reader.token)).status).toBe(404);
    expect((await refs(coop, 'ci-target', 'receive', reader.token)).status).toBe(403);
    expect((await refs(coop, 'ci-target', 'receive', writer.token)).status).toBe(200);
    expect(other.id).not.toBe(repo.id);

    const listed = value(await gateway.listDeployTokens(coop, repo.id));
    expect(listed.map((token) => token.name).toSorted()).toEqual(['CI push', 'CI read']);
    expect(listed.find((token) => token.name === 'CI read')).toMatchObject({
      lastUsedFrom: expect.stringContaining('git/2.53.0'),
    });

    const whoami = await call('GET', '/v1/whoami', { token: writer.token });
    expect(await json(whoami)).toEqual({
      kind: 'deploy',
      engine: repo.engine_id,
      handle: coop.handle,
      scopes: ['repo:read', 'bean:write'],
    });
  });

  it('stops working when revoked, expired, or when its repository is deleted', async () => {
    const coop = owner();
    const repo = await repository(coop, 'short-lived');
    const revoked = value(
      await gateway.createDeployToken(coop, repo.id, { name: 'a', access: 'read', days: 7 }),
    );
    const expired = value(
      await gateway.createDeployToken(coop, repo.id, { name: 'b', access: 'read', days: 7 }),
    );
    const kept = value(
      await gateway.createDeployToken(coop, repo.id, { name: 'c', access: 'read', days: 7 }),
    );
    expect(value(await gateway.revokeDeployToken(coop, repo.id, revoked.summary.id))).toEqual({
      revoked: true,
    });
    await env.FORGE.prepare('UPDATE deploy_tokens SET expires_at = 1 WHERE id = ?')
      .bind(expired.summary.id)
      .run();
    const refused = await Promise.all(
      [revoked.token, expired.token].map(async (token) => {
        const response = await refs(coop, 'short-lived', 'upload', token);
        return { status: response.status, text: await response.text() };
      }),
    );
    for (const answer of refused) {
      expect(answer.status).toBe(401);
      expect(answer.text).toContain('that credential was refused');
    }
    expect((await refs(coop, 'short-lived', 'upload', kept.token)).status).toBe(200);
    value(await gateway.deleteRepository(coop.id, repo.id));
    expect((await call('GET', '/v1/whoami', { token: kept.token })).status).toBe(401);
  });

  it('is made, listed and revoked by the owner only', async () => {
    const coop = owner();
    const dana = owner();
    const repo = await repository(coop, 'mine');
    expect(
      await gateway.createDeployToken(dana, repo.id, { name: 'x', access: 'write', days: 7 }),
    ).toMatchObject({
      ok: false,
      error: { code: 'not_found' },
    });
    expect(await gateway.listDeployTokens(dana, repo.id)).toMatchObject({ ok: false });
    const made = value(
      await gateway.createDeployToken(coop, repo.id, { name: 'x', access: 'write', days: 7 }),
    );
    expect(await gateway.revokeDeployToken(dana, repo.id, made.summary.id)).toMatchObject({
      ok: false,
    });
    expect(
      await gateway.createDeployToken(coop, repo.id, { name: '', access: 'read', days: 3 }),
    ).toMatchObject({
      ok: false,
      error: { code: 'invalid_request' },
    });
  });
});

describe('git without a usable credential', () => {
  it('answers 401 with the three ways to connect, which git prints as remote: lines', async () => {
    const coop = owner();
    await repository(coop, 'hint');
    const missing = await refs(coop, 'hint', 'upload');
    expect(missing.status).toBe(401);
    expect(missing.headers.get('content-type')).toContain('text/plain');
    const text = await missing.text();
    expect(text).toContain('not connected to your account yet');
    expect(text).toContain('/beanstalk:setup');
    expect(text).toContain('/settings/tokens');
    expect(text).toContain('BEANSTALK_TOKEN');
    const refused = await refs(coop, 'hint', 'upload', `bsd_${'z'.repeat(43)}`);
    expect(refused.status).toBe(401);
    expect(await refused.text()).toContain('that credential was refused');
  });
});
