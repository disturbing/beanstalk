import { exports } from 'cloudflare:workers';
import { describe, expect, it } from 'vitest';

import { ADMIN, call, json, pkt, sha } from './helpers';

/**
 * Git over SSH, the gateway's half: the `beanstalk-ssh` Worker calls these two RPC methods with
 * the client's public key once the SSH server has checked its signature. The test stack's
 * `SSH_STAGING_KEYS` (vitest.config.ts) registers ACME_KEY to @acme; OTHER_KEY is nobody's.
 */
const gateway = exports.default;

const ACME_KEY =
  'ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAAIIHC3jkKzIOQKqqCzklwU5wRpVYmBoVhimrFpuuRc150';
/** As `ssh-keygen -lf` prints it for ACME_KEY. */
const ACME_FINGERPRINT = 'SHA256:O+CEc3U9EWkmw9BOf2FM3jRlkKVlSI65II9p6TrH2rI';
const OTHER_KEY =
  'ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAAIGi6Zk1I7+Ej4DwhyafmTEha4T4GOsMQpqv8GnrSnyAx';
const ZERO = '0'.repeat(40);
const INTERNAL = 'http://gateway.internal';

async function openRepo(repo: string, owner = 'acme'): Promise<string> {
  const response = await call('POST', '/v1/repos', {
    token: ADMIN,
    body: {
      repoName: repo,
      artifactsRepo: `repo-${repo}`,
      owner: { id: `u-${owner}`, handle: owner },
      create_artifacts_repo: true,
    },
  });
  expect(response.status).toBe(201);
  return (await json<{ git_path: string }>(response)).git_path;
}

/** What the SSH server sends for `GET info/refs`. */
function advertise(key: string, path: string, service: string): Promise<Response> {
  const request = new Request(`${INTERNAL}${path}/info/refs?service=${service}`, {
    headers: { 'user-agent': 'git/2.47.0' },
  });
  return gateway.sshGit(key, request);
}

/** What the SSH server sends for a push: the client's bytes, unchanged. */
function push(key: string, path: string, input: { ref: string; options?: string[] }) {
  const options = input.options ?? [];
  const caps = `report-status side-band-64k${options.length > 0 ? ' push-options' : ''}`;
  const optionSection = options.length > 0 ? `${options.map((o) => pkt(`${o}\n`)).join('')}0000` : '';
  return async (newSha: string): Promise<Response> => {
    const commits = { [newSha]: { message: 'Add a total helper', parents: [], files: {} } };
    const body = `${pkt(`${ZERO} ${newSha} ${input.ref}\0${caps}\n`)}0000${optionSection}PACK${JSON.stringify({ commits })}`;
    const request = new Request(`${INTERNAL}${path}/git-receive-pack`, {
      method: 'POST',
      body,
      headers: {
        'user-agent': 'git/2.47.0',
        'content-type': 'application/x-git-receive-pack-request',
      },
    });
    return gateway.sshGit(key, request);
  };
}

/** The side-band answer's `remote:` lines (band 2). */
async function remoteLines(response: Response): Promise<string> {
  const text = await response.text();
  let remote = '';
  for (let offset = 0; offset + 4 <= text.length; ) {
    const length = Number.parseInt(text.slice(offset, offset + 4), 16);
    if (length === 0) {
      offset += 4;
      continue;
    }
    if (text.charCodeAt(offset + 4) === 2) remote += text.slice(offset + 5, offset + length);
    offset += length;
  }
  return remote;
}

describe('git over SSH: keys', () => {
  it('names the owner of a registered key and its OpenSSH fingerprint', async () => {
    expect(await gateway.sshKeyLookup(`${ACME_KEY} laptop`, false)).toEqual({
      handle: 'acme',
      fingerprint: ACME_FINGERPRINT,
    });
    expect(await gateway.sshKeyLookup(ACME_KEY, true)).toMatchObject({ handle: 'acme' });
  });

  it('knows nothing of an unregistered key or a line that is no key', async () => {
    expect(await gateway.sshKeyLookup(OTHER_KEY, false)).toBeNull();
    expect(await gateway.sshKeyLookup('ssh-ed25519 not-base64!', false)).toBeNull();
    expect(await gateway.sshKeyLookup('password hunter2', false)).toBeNull();
  });
});

describe('git over SSH: the same flow as HTTPS', () => {
  it('clones the owner’s repository with a v2 advertisement passed through', async () => {
    const path = await openRepo('ssh-clone');
    const response = await advertise(ACME_KEY, path, 'git-upload-pack');
    expect(response.status).toBe(200);
    expect(await response.text()).toContain('refs/heads/sprout');
  });

  it('advertises push options, so -o wait works over SSH', async () => {
    const path = await openRepo('ssh-adverts');
    const response = await advertise(ACME_KEY, path, 'git-receive-pack');
    expect(await response.text()).toMatch(/report-status side-band-64k.* push-options/);
  });

  it('turns a push to bean/<name> into a bean and prints its verdict with -o wait', async () => {
    const path = await openRepo('ssh-push');
    const response = await push(ACME_KEY, path, {
      ref: 'refs/heads/bean/ssh-total',
      options: ['wait'],
    })(await sha('ssh-1'));
    expect(response.status).toBe(200);
    const remote = await remoteLines(response);
    expect(remote).toContain('new bean ssh-total received');
    expect(remote).toContain('LANDED: ssh-total');
  });

  it('refuses a push to the sprout in the protocol, with the same words', async () => {
    const path = await openRepo('ssh-sprout');
    const response = await push(ACME_KEY, path, { ref: 'refs/heads/sprout' })(await sha('s-1'));
    expect(response.status).toBe(200);
    expect(await remoteLines(response)).toContain('landing is never a push');
  });

  it('answers 401 for a key nobody registered', async () => {
    const path = await openRepo('ssh-unknown');
    const response = await advertise(OTHER_KEY, path, 'git-upload-pack');
    expect(response.status).toBe(401);
  });

  it('hides another person’s private repository as missing', async () => {
    const path = await openRepo('ssh-private', 'dana');
    const response = await advertise(ACME_KEY, path, 'git-upload-pack');
    expect(response.status).toBe(404);
    expect(await response.text()).toContain('no repository dana/ssh-private');
  });

  it('serves no race repository over SSH', async () => {
    const response = await advertise(ACME_KEY, '/git/beanstalk-race/race-r1.git', 'git-upload-pack');
    expect(response.status).toBe(404);
    expect(await response.text()).toContain('race repos are served over HTTPS');
  });
});
