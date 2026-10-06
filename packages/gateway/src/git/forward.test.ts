import { afterEach, describe, expect, it, vi } from 'vitest';

import { UpstreamError } from '../errors';
import { forwardGit } from './forward';
import type { GitPath } from './git-path';

const path: GitPath = {
  namespace: 'ns',
  repo: 'run',
  rest: 'git-upload-pack',
  service: 'git-upload-pack',
};

function forward(): Promise<Response> {
  return forwardGit(new Request('https://gateway.test/git/x', { method: 'POST' }), {
    upstream: 'https://artifacts.test/repo.git',
    path,
    token: 'secret',
    body: null,
  });
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe('forwardGit', () => {
  it('turns a redirect from the remote into an upstream failure without its location', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(null, { status: 302, headers: { location: 'https://evil.test/' } }),
    );

    await expect(forward()).rejects.toBeInstanceOf(UpstreamError);
  });

  it('streams a normal answer back and drops credential challenges', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response('pack', { status: 200, headers: { 'www-authenticate': 'Basic' } }),
    );

    const response = await forward();

    expect(await response.text()).toBe('pack');
    expect(response.headers.get('www-authenticate')).toBeNull();
  });
});
