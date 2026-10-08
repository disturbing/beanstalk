import { describe, expect, it } from 'vitest';

import type { GitGateway } from './git-host';
import { forwardGit } from './git-host';

/** A gateway that records what it was sent and streams a side-band answer back. */
function recordingGateway(): GitGateway & { sent: { url: string; method: string; headers: Headers; body: string }[] } {
  const sent: { url: string; method: string; headers: Headers; body: string }[] = [];
  return {
    sent,
    async fetch(request) {
      sent.push({ url: request.url, method: request.method, headers: request.headers, body: await request.text() });
      const stream = new ReadableStream<Uint8Array>({
        start(controller) {
          controller.enqueue(new TextEncoder().encode('0015\u0002remote: waiting\n'));
          controller.enqueue(new TextEncoder().encode('0000'));
          controller.close();
        },
      });
      return new Response(stream, { headers: { 'content-type': 'application/x-git-receive-pack-result' } });
    },
  };
}

describe('git on the web host', () => {
  it('forwards a ref advertisement with its query and the checkout auth header', async () => {
    const gateway = recordingGateway();
    const auth = `Basic ${btoa('x-access-token:bsj_abc')}`;
    await forwardGit(
      gateway,
      new Request('https://web.test/coop/shop/info/refs?service=git-upload-pack', {
        headers: { authorization: auth, 'git-protocol': 'version=2', 'user-agent': 'git/2.47.0' },
      }),
      { owner: 'coop', repo: 'shop', service: 'info/refs' },
    );
    const [sent] = gateway.sent;
    expect(sent?.url).toBe('https://gateway.internal/git/coop/shop.git/info/refs?service=git-upload-pack');
    expect(sent?.method).toBe('GET');
    expect(sent?.headers.get('authorization')).toBe(auth);
    expect(sent?.headers.get('git-protocol')).toBe('version=2');
  });

  it('forwards a push body (options and pack) as sent and streams the side-band back', async () => {
    const gateway = recordingGateway();
    const body = '00a0... refs/heads/bean/x\u0000report-status side-band-64k push-options\n00000009wait\n0000PACK...';
    const response = await forwardGit(
      gateway,
      new Request('https://web.test/coop/shop.git/git-receive-pack', {
        method: 'POST',
        body,
        headers: { 'content-type': 'application/x-git-receive-pack-request' },
      }),
      { owner: 'coop', repo: 'shop.git', service: 'git-receive-pack' },
    );
    expect(gateway.sent[0]?.url).toBe('https://gateway.internal/git/coop/shop.git/git-receive-pack');
    expect(gateway.sent[0]?.body).toBe(body);
    expect(gateway.sent[0]?.headers.get('content-type')).toBe('application/x-git-receive-pack-request');
    expect(response.headers.get('content-type')).toBe('application/x-git-receive-pack-result');
    expect(await response.text()).toContain('remote: waiting');
  });

  it('refuses dumb HTTP without asking the gateway', async () => {
    const gateway = recordingGateway();
    const response = await forwardGit(gateway, new Request('https://web.test/coop/shop/info/refs'), {
      owner: 'coop',
      repo: 'shop',
      service: 'info/refs',
    });
    expect(response.status).toBe(404);
    expect(gateway.sent).toEqual([]);
  });
});
