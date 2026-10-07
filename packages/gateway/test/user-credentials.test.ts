import { env } from 'cloudflare:test';
import { describe, expect, it } from 'vitest';

import {
  PersonalTokenInput,
  createPersonalToken,
  mintSessionToken,
  revokeUserToken,
} from '@beanstalk/shared-identity/user-tokens';
import { insertUser } from '@beanstalk/shared-identity/users';

import { verifyGitCredential } from '../src/auth/git-credential';
import { ADMIN, call, createRun, gitPath, json, slotToken } from './helpers';

async function person(handle: string): Promise<{ id: string; handle: string }> {
  const user = { id: `u_${handle.replace(/-/g, '')}`, handle };
  await insertUser(env, { ...user, email: null }, Date.now()).run();
  return user;
}

describe('verifyGitCredential', () => {
  it('accepts run tokens as before', async () => {
    const run = await createRun({ agents: 1 });
    const credential = await verifyGitCredential(env, slotToken(run, 'a0'));
    expect(credential).toMatchObject({
      ok: true,
      kind: 'run',
      claims: { run: run.run, scope: 'slot', sub: 'a0' },
    });
  });

  it('accepts personal and session tokens with their owner and scopes', async () => {
    const user = await person('git-person');
    const pat = await createPersonalToken(env, {
      userId: user.id,
      request: PersonalTokenInput.parse({ name: 'laptop', scopes: ['read', 'write'], days: 30 }),
    });
    const session = await mintSessionToken(env, {
      userId: user.id,
      label: 'Claude Code',
      scopes: ['read'],
    });
    expect(await verifyGitCredential(env, pat.token)).toEqual({
      ok: true,
      kind: 'user',
      user: { ...user, email: null },
      scopes: ['read', 'write'],
      tokenKind: 'personal',
    });
    expect(await verifyGitCredential(env, session.token)).toMatchObject({
      ok: true,
      kind: 'user',
      scopes: ['read'],
      tokenKind: 'session',
    });
    await revokeUserToken(env, { userId: user.id, tokenId: pat.summary.id });
    expect(await verifyGitCredential(env, pat.token)).toEqual({
      ok: false,
      reason: 'unknown_user_token',
    });
  });

  it('refuses forged tokens of both kinds', async () => {
    expect(await verifyGitCredential(env, 'bst1.forged.token')).toEqual({
      ok: false,
      reason: 'malformed',
    });
    expect(await verifyGitCredential(env, `bsu_${'x'.repeat(43)}`)).toEqual({
      ok: false,
      reason: 'unknown_user_token',
    });
  });
});

describe('user tokens over HTTP', () => {
  it('whoami names the person behind a token sent as the git password', async () => {
    const user = await person('whoami-person');
    const { token } = await createPersonalToken(env, {
      userId: user.id,
      request: PersonalTokenInput.parse({ name: 'cli', scopes: ['read'], days: 7 }),
    });
    const basic = `Basic ${btoa(`anything:${token}`)}`;
    const response = await call('GET', '/v1/whoami', { headers: { authorization: basic } });
    expect(await json(response)).toEqual({
      kind: 'user',
      handle: 'whoami-person',
      token: 'personal',
      scopes: ['read'],
    });
    const refused = await call('GET', '/v1/whoami', { token: `bsu_${'y'.repeat(43)}` });
    expect(refused.status).toBe(401);
  });

  it('refuses a user token on a race repo with 403, not 401', async () => {
    const run = await createRun({ agents: 1 });
    const user = await person('race-reader');
    const { token } = await createPersonalToken(env, {
      userId: user.id,
      request: PersonalTokenInput.parse({ name: 'cli', scopes: ['read'], days: 7 }),
    });
    const response = await call(
      'GET',
      `${gitPath(run.repo.name, 'info/refs')}?service=git-upload-pack`,
      { token },
    );
    expect(response.status).toBe(403);
    expect(await response.text()).toContain('race repos take run tokens');
    const admin = await call('GET', '/v1/whoami', { token: ADMIN });
    expect(admin.status).toBe(401);
  });
});
