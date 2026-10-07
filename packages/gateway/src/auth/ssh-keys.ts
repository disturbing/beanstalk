/**
 * SSH public keys people registered, as git over SSH asks about them (one adapter, so the
 * accounts work can land its store without touching the SSH path). The accounts side provides
 * `findUserByKey(fingerprint) → { user, key } | null` and `touchKey(keyId)` in
 * `@beanstalk/shared-identity`; until it does, no account key is known and only a stack's
 * `SSH_STAGING_KEYS` (a test and staging affordance, empty in production) opens a door.
 *
 * Fingerprints are OpenSSH's: `SHA256:` and the unpadded base64 of the SHA-256 of the key blob.
 */
import { z } from 'zod';

import type { Scope } from '@beanstalk/shared-identity/scopes';

import type { GitScope, GitUser } from './git-credential';

/** A registered key and its owner. `scopes` absent means read and write, as a key gives on any forge. */
export type SshKeyOwner = {
  readonly user: GitUser;
  readonly key: { readonly id: string; readonly scopes?: readonly Scope[] };
};

/** The accounts side's key lookup (the interface `@beanstalk/shared-identity` implements). */
export type SshKeyStore = {
  findUserByKey(fingerprint: string): Promise<SshKeyOwner | null>;
  /** Records that the key was used (signature checked); best effort. */
  touchKey(keyId: string): Promise<void>;
};

/** An OpenSSH public key line: `<algorithm> <base64 blob> [comment]`. */
export type SshPublicKey = { readonly algorithm: string; readonly blob: Uint8Array };

const KEY_ALGORITHMS = new Set([
  'ssh-ed25519',
  'ssh-rsa',
  'ecdsa-sha2-nistp256',
  'ecdsa-sha2-nistp384',
  'ecdsa-sha2-nistp521',
  'sk-ssh-ed25519@openssh.com',
  'sk-ecdsa-sha2-nistp256@openssh.com',
]);
const MAX_KEY_LINE = 16 * 1024;

/** Parses an OpenSSH public key line; null when it is not one. */
export function parsePublicKey(line: string): SshPublicKey | null {
  if (line.length > MAX_KEY_LINE) return null;
  const [algorithm, encoded] = line.trim().split(/\s+/, 3);
  if (algorithm === undefined || encoded === undefined || !KEY_ALGORITHMS.has(algorithm))
    return null;
  const blob = decodeBase64(encoded);
  if (blob === null || !blobNamesAlgorithm(blob, algorithm)) return null;
  return { algorithm, blob };
}

/** `SHA256:…`, as `ssh-keygen -lf` and `ssh` print it. */
export async function sshFingerprint(key: SshPublicKey): Promise<string> {
  const digest = new Uint8Array(await crypto.subtle.digest('SHA-256', key.blob));
  return `SHA256:${btoa(String.fromCharCode(...digest)).replace(/=+$/, '')}`;
}

/** The git scopes a key carries: read and push beans unless the account narrowed it. */
export function sshGitScopes(owner: SshKeyOwner): GitScope[] {
  const scopes = owner.key.scopes ?? ['read', 'write'];
  const git: GitScope[] = [];
  if (scopes.includes('read') || scopes.includes('write')) git.push('repo:read');
  if (scopes.includes('write')) git.push('bean:write');
  return git;
}

const StagingKeys = z.record(
  z.string().startsWith('SHA256:'),
  z.object({ id: z.string().min(1), handle: z.string().min(1).max(63) }),
);

/**
 * The key store for this deployment: the accounts store when it exists, then the stack's
 * `SSH_STAGING_KEYS` (JSON `{ "SHA256:…": { "id", "handle" } }`). Throws on a malformed
 * `SSH_STAGING_KEYS`: a misconfigured stack, not a request error.
 */
export function sshKeyStore(env: { readonly SSH_STAGING_KEYS: string }): SshKeyStore {
  const raw = env.SSH_STAGING_KEYS.trim();
  const staging = raw === '' ? {} : StagingKeys.parse(JSON.parse(raw));
  return {
    async findUserByKey(fingerprint) {
      const fromAccounts = await accountKeys.findUserByKey(fingerprint);
      if (fromAccounts !== null) return fromAccounts;
      const user = staging[fingerprint];
      return user === undefined ? null : { user, key: { id: `staging:${fingerprint}` } };
    },
    async touchKey(keyId) {
      if (!keyId.startsWith('staging:')) await accountKeys.touchKey(keyId);
    },
  };
}

/**
 * Where `@beanstalk/shared-identity`'s `findUserByKey` and `touchKey` plug in. They are not
 * exported yet, so no account key is known; replacing this object is the whole integration.
 */
const accountKeys: SshKeyStore = {
  findUserByKey: () => Promise.resolve(null),
  touchKey: () => Promise.resolve(),
};

function decodeBase64(encoded: string): Uint8Array | null {
  if (!/^[A-Za-z0-9+/]+={0,2}$/.test(encoded)) return null;
  try {
    return Uint8Array.from(atob(encoded), (char) => char.charCodeAt(0));
  } catch {
    // Not base64 after all (a bad length): not a key.
    return null;
  }
}

/** The blob starts with its own algorithm name (a uint32 length, then the name). */
function blobNamesAlgorithm(blob: Uint8Array, algorithm: string): boolean {
  if (blob.length < 4) return false;
  const view = new DataView(blob.buffer, blob.byteOffset, blob.byteLength);
  const length = view.getUint32(0);
  if (length !== algorithm.length || blob.length < 4 + length) return false;
  return new TextDecoder().decode(blob.subarray(4, 4 + length)) === algorithm;
}
