import { env } from 'cloudflare:test';
import { describe, expect, it } from 'vitest';

import {
  PersonalTokenInput,
  createPersonalToken,
  mintSessionToken,
  revokeUserToken,
} from '@beanstalk/shared-identity/user-tokens';
import { insertUser } from '@beanstalk/shared-identity/users';
import { RunId } from '@beanstalk/shared-race/ids';

import { mayUseEngine, verifyGitCredential } from '../src/auth/git-credential';
import type { GitCredentialEnv } from '../src/auth/git-credential';
import { ADMIN, call, createRun, gitPath, json, slotToken } from './helpers';

async function person(handle: string): Promise<{ id: string; handle: string }> {
  const user = { id: `u_${handle.replace(/-/g, '')}`, handle };
  await insertUser(env, { ...user, email: null }, Date.now()).run();
  return user;
}

const creds: GitCredentialEnv = {
  tokenSecret: env.RUN_TOKEN_SECRET,
  now: () => Date.now(),
  identity: env,
};

describe('verifyGitCredential', () => {
  it('accepts run tokens as before', async () => {
    const run = await createRun({ agents: 1 });
    const credential = await verifyGitCredential(creds, slotToken(run, 'a0'));
    expect(credential).toMatchObject({
      engine: run.run,
      runPrincipal: { scope: 'slot', sub: 'a0' },
      scopes: ['repo:read', 'bean:write'],
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
    expect(await verifyGitCredential(creds, pat.token)).toEqual({
      user,
      scopes: ['repo:read', 'bean:write'],
      engine: null,
      runPrincipal: null,
    });
    expect(await verifyGitCredential(creds, session.token)).toMatchObject({
      user,
      scopes: ['repo:read'],
      engine: null,
    });
    await revokeUserToken(env, { userId: user.id, tokenId: pat.summary.id });
    expect(await verifyGitCredential(creds, pat.token)).toBeNull();
  });

  it('refuses forged tokens of both kinds', async () => {
    expect(await verifyGitCredential(creds, 'bst1.forged.token')).toBeNull();
    expect(await verifyGitCredential(creds, `bsu_${'x'.repeat(43)}`)).toBeNull();
  });
});

describe('mayUseEngine', () => {
  it("opens a person's own repositories to their token, nobody else's", async () => {
    const user = await person('repo-owner');
    const pat = await createPersonalToken(env, {
      userId: user.id,
      request: PersonalTokenInput.parse({ name: 'cli', scopes: ['write'], days: 7 }),
    });
    const credential = await verifyGitCredential(creds, pat.token);
    if (credential === null) throw new Error('token refused');
    const engine = RunId.parse('repoengine1');
    const of = (ownerHandle: string, visibility: 'public' | 'private' = 'private') => ({
      engine,
      ownerHandle,
      visibility,
    });
    expect(mayUseEngine(credential, of('repo-owner'), 'write')).toBe(true);
    expect(mayUseEngine(credential, of('someone-else'), 'read')).toBe(false);
    // A public repository reads for everyone and still takes beans from its owner only.
    expect(mayUseEngine(credential, of('someone-else', 'public'), 'read')).toBe(true);
    expect(mayUseEngine(credential, of('someone-else', 'public'), 'write')).toBe(false);
  });

  it('keeps run tokens bound to their own engine', async () => {
    const run = await createRun({ agents: 1 });
    const credential = await verifyGitCredential(creds, slotToken(run, 'a0'));
    if (credential === null) throw new Error('token refused');
    const at = (engine: string) => ({
      engine: RunId.parse(engine),
      ownerHandle: 'anyone',
      visibility: 'public' as const,
    });
    expect(mayUseEngine(credential, at(run.run), 'write')).toBe(true);
    expect(mayUseEngine(credential, at('otherrun01'), 'read')).toBe(false);
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
      scopes: ['repo:read'],
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
    expect(await response.text()).toContain('does not open race repos');
    const admin = await call('GET', '/v1/whoami', { token: ADMIN });
    expect(admin.status).toBe(401);
  });
});
