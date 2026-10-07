import { describe, expect, it } from 'vitest';

import { parsePublicKey, sshFingerprint, sshGitScopes, sshKeyStore } from './ssh-keys';

const KEY = 'ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAAIIHC3jkKzIOQKqqCzklwU5wRpVYmBoVhimrFpuuRc150';

describe('ssh keys', () => {
  it('computes the fingerprint ssh-keygen prints', async () => {
    const key = parsePublicKey(`${KEY} coop@laptop`);
    expect(key?.algorithm).toBe('ssh-ed25519');
    expect(key === null ? null : await sshFingerprint(key)).toBe(
      'SHA256:O+CEc3U9EWkmw9BOf2FM3jRlkKVlSI65II9p6TrH2rI',
    );
  });

  it('refuses lines that are not public keys', () => {
    expect(parsePublicKey('')).toBeNull();
    expect(parsePublicKey('ssh-dss AAAAB3NzaC1kc3M=')).toBeNull();
    expect(parsePublicKey('ssh-ed25519 ***')).toBeNull();
    // A blob that names another algorithm than the line does.
    expect(parsePublicKey(KEY.replace('ssh-ed25519', 'ssh-rsa'))).toBeNull();
    expect(parsePublicKey(`ssh-ed25519 ${'A'.repeat(20_000)}`)).toBeNull();
  });

  it('gives a key read and push unless its account narrowed it', () => {
    const user = { id: 'u1', handle: 'acme' };
    expect(sshGitScopes({ user, key: { id: 'k' } })).toEqual(['repo:read', 'bean:write']);
    expect(sshGitScopes({ user, key: { id: 'k', scopes: ['read'] } })).toEqual(['repo:read']);
    expect(sshGitScopes({ user, key: { id: 'k', scopes: ['collaborate'] } })).toEqual([]);
  });

  it('knows only the staging keys a stack lists, and nothing when it lists none', async () => {
    const fingerprint = 'SHA256:O+CEc3U9EWkmw9BOf2FM3jRlkKVlSI65II9p6TrH2rI';
    const listed = sshKeyStore({
      SSH_STAGING_KEYS: JSON.stringify({ [fingerprint]: { id: 'u1', handle: 'acme' } }),
    });
    expect(await listed.findUserByKey(fingerprint)).toMatchObject({ user: { handle: 'acme' } });
    expect(await listed.findUserByKey('SHA256:other')).toBeNull();
    expect(await sshKeyStore({ SSH_STAGING_KEYS: '' }).findUserByKey(fingerprint)).toBeNull();
    expect(() => sshKeyStore({ SSH_STAGING_KEYS: '{"not-a-fingerprint":{}}' })).toThrow();
  });
});
