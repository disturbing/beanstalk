import { env } from 'cloudflare:test';
import { describe, expect, it } from 'vitest';

import { maskTermsOf, maskText } from './mask';
import { d1Secrets, secretsForRun, SecretsNotConfiguredError } from './secrets';

const STORED = [
  { name: 'DEPLOY', prelandAllowed: false },
  { name: 'TEST_KEY', prelandAllowed: true },
];

describe('D4: which runs get which secrets', () => {
  it('gives stalk, dispatch and schedule runs every secret their job names that exists', () => {
    for (const kind of ['stalk', 'dispatch', 'schedule'] as const)
      expect(secretsForRun({ kind }, ['DEPLOY', 'TEST_KEY', 'MISSING'], STORED)).toEqual(['DEPLOY', 'TEST_KEY']);
  });

  it('gives a maintainer’s pre-land run its secrets, and anyone else’s only the toggled ones', () => {
    expect(secretsForRun({ kind: 'preland', pushedBy: 'maintainer' }, ['DEPLOY', 'TEST_KEY'], STORED)).toEqual(['DEPLOY', 'TEST_KEY']);
    for (const pushedBy of ['agent-session', 'deploy-token', 'collaborator'] as const)
      expect(secretsForRun({ kind: 'preland', pushedBy }, ['DEPLOY', 'TEST_KEY'], STORED)).toEqual(['TEST_KEY']);
  });

  it('gives nothing a job does not name', () => {
    expect(secretsForRun({ kind: 'stalk' }, [], STORED)).toEqual([]);
  });
});

describe('secrets at rest', () => {
  const key = Reflect.get(env, 'ACTIONS_SECRETS_KEY');
  const store = d1Secrets(env.FORGE, typeof key === 'string' ? key : null);

  it('stores AES-GCM ciphertext, lists names only, and reveals only for its repository', async () => {
    const value = 'cf-token-1234567890';
    const saved = await store.put('repo-sec-1', { name: 'deploy_token', value, prelandAllowed: false }, { actor: 'coop', at: '2026-10-08T00:00:00Z' });
    expect(saved).toEqual({ name: 'DEPLOY_TOKEN', prelandAllowed: false, updatedAt: '2026-10-08T00:00:00Z', updatedBy: 'coop' });
    const row = await env.FORGE.prepare('SELECT ciphertext FROM actions_secrets WHERE repo_id = ?').bind('repo-sec-1').first<{ ciphertext: string }>();
    expect(row?.ciphertext).not.toContain(value);
    expect(JSON.stringify(await store.list('repo-sec-1'))).not.toContain(value);
    expect(await store.reveal('repo-sec-1', ['DEPLOY_TOKEN'])).toEqual({ DEPLOY_TOKEN: value });
    // A row copied to another repository does not decrypt (the repository is in the AAD).
    await env.FORGE.prepare(
      `INSERT INTO actions_secrets (repo_id, name, ciphertext, iv, key_version, preland_allowed, updated_at, updated_by)
       SELECT 'repo-sec-2', name, ciphertext, iv, key_version, preland_allowed, updated_at, updated_by FROM actions_secrets WHERE repo_id = 'repo-sec-1'`,
    ).run();
    await expect(store.reveal('repo-sec-2', ['DEPLOY_TOKEN'])).rejects.toThrow();
    expect(await store.delete('repo-sec-1', 'deploy_token')).toBe(true);
    expect(await store.list('repo-sec-1')).toEqual([]);
  });

  it('refuses to store without a key', async () => {
    await expect(
      d1Secrets(env.FORGE, null).put('r', { name: 'X', value: 'y', prelandAllowed: false }, { actor: 'a', at: 'now' }),
    ).rejects.toBeInstanceOf(SecretsNotConfiguredError);
  });
});

describe('masking', () => {
  it('masks values, their base64 and URL forms, and leaves short values alone', () => {
    const terms = maskTermsOf(['s3cr3t value', 'ab']);
    expect(maskText(`a s3cr3t value b ${btoa('s3cr3t value')} ${encodeURIComponent('s3cr3t value')} ab`, terms)).toBe('a *** b *** *** ab');
  });
});
