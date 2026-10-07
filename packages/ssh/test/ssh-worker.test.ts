import { SELF, env } from 'cloudflare:test';
import { describe, expect, it } from 'vitest';

import { poolInstance, readConfig } from '../src/config';
import type { GatewaySsh } from '../src/gateway-outbound';
import { KEY_HEADER, gatewaySsh, routeOutbound } from '../src/gateway-outbound';
import { pipeBothWays } from '../src/socket-pipe';
import { webSocketDuplex } from '../src/tunnel';

const KNOWN = 'ssh-ed25519 KNOWNKEY';

/** The GATEWAY binding (a fake with the gateway's two SSH RPC methods). */
function binding(): GatewaySsh {
  const gateway = gatewaySsh(env.GATEWAY);
  if (gateway === null) throw new Error('the fake gateway lacks the SSH methods');
  return gateway;
}

function lookup(body: unknown): Request {
  return new Request('http://gateway.internal/ssh/keys/lookup', {
    method: 'POST',
    body: JSON.stringify(body),
    headers: { 'content-type': 'application/json' },
  });
}

describe('the container’s way out (gateway.internal)', () => {
  it('answers a key lookup with the owner’s handle', async () => {
    const response = await routeOutbound(lookup({ public_key: KNOWN, confirm: true }), binding());
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ handle: 'acme' });
  });

  it('answers 404 for a key nobody registered and 400 for a malformed lookup', async () => {
    const unknown = await routeOutbound(
      lookup({ public_key: 'ssh-rsa X', confirm: false }),
      binding(),
    );
    expect(unknown.status).toBe(404);
    const malformed = await routeOutbound(lookup({ key: KNOWN }), binding());
    expect(malformed.status).toBe(400);
  });

  it('hands a git request to the gateway with the key as the argument, not a header', async () => {
    const request = new Request('http://gateway.internal/git/acme/greeter.git/git-receive-pack', {
      method: 'POST',
      body: '0000PACK',
      headers: { [KEY_HEADER]: KNOWN, 'content-type': 'application/x-git-receive-pack-request' },
    });
    const response = await routeOutbound(request, binding());
    expect(await response.json()).toEqual({
      publicKey: KNOWN,
      url: 'http://gateway.internal/git/acme/greeter.git/git-receive-pack',
      method: 'POST',
      key: null,
      body: '0000PACK',
    });
  });

  it('refuses a git request without a key and anything that is not git', async () => {
    const keyless = new Request('http://gateway.internal/git/acme/greeter.git/info/refs');
    expect((await routeOutbound(keyless, binding())).status).toBe(401);
    const elsewhere = new Request('http://gateway.internal/v1/runs', {
      headers: { [KEY_HEADER]: KNOWN },
    });
    expect((await routeOutbound(elsewhere, binding())).status).toBe(404);
  });

  it('reads a binding without the SSH methods as no gateway', () => {
    expect(gatewaySsh({})).toBeNull();
  });
});

describe('connection plumbing', () => {
  it('spreads connections over the pool and stays inside it', () => {
    expect(poolInstance(2, () => 0)).toBe('ssh-0');
    expect(poolInstance(2, () => 0.99)).toBe('ssh-1');
    expect(poolInstance(2, () => 1)).toBe('ssh-1');
    expect(poolInstance(1, Math.random)).toBe('ssh-0');
  });

  it('pipes both ways, counts the bytes and ends when the client hangs up', async () => {
    const fromClient = new TransformStream<Uint8Array, Uint8Array>();
    const toClient = new TransformStream<Uint8Array, Uint8Array>();
    const echo = new TransformStream<Uint8Array, Uint8Array>();
    let activity = 0;
    const piping = pipeBothWays(
      { readable: fromClient.readable, writable: toClient.writable },
      { readable: echo.readable, writable: echo.writable },
      { signal: AbortSignal.timeout(5000), onActivity: () => (activity += 1) },
    );
    const writer = fromClient.writable.getWriter();
    await writer.write(new TextEncoder().encode('SSH-2.0-test\r\n'));
    const reader = toClient.readable.getReader();
    const echoed = await reader.read();
    expect(new TextDecoder().decode(echoed.value)).toBe('SSH-2.0-test\r\n');
    await writer.close();
    expect(await piping).toEqual({ bytesIn: 14, bytesOut: 14 });
    expect(activity).toBe(2);
  });

  it('carries tunnel bytes both ways over a WebSocket', async () => {
    const [client, server] = Object.values(new WebSocketPair());
    if (client === undefined || server === undefined) throw new Error('no websocket pair');
    server.accept();
    client.accept();
    const tunnel = webSocketDuplex(server);
    const received = new Promise<string>((resolve) => {
      client.addEventListener('message', (event) => {
        // A binary message may be a Blob here, as on the tunnel's server end.
        resolve(new Response(event.data).text());
      });
    });
    client.send(new TextEncoder().encode('SSH-2.0-client\r\n'));
    const reader = tunnel.readable.getReader();
    const first = await reader.read();
    expect(new TextDecoder().decode(first.value)).toBe('SSH-2.0-client\r\n');
    const writer = tunnel.writable.getWriter();
    await writer.write(new TextEncoder().encode('SSH-2.0-beanstalk\r\n'));
    expect(await received).toBe('SSH-2.0-beanstalk\r\n');
  });

  it('reads its settings, with the tunnel off by default', () => {
    expect(readConfig(env)).toMatchObject({ poolSize: 2, maxConnections: 64, tunnel: 'off' });
  });
});

describe('the Worker over HTTP', () => {
  it('is healthy', async () => {
    const response = await SELF.fetch('https://ssh.test/healthz');
    expect(response.status).toBe(200);
  });

  it('has no tunnel unless the stack turns it on', async () => {
    const response = await SELF.fetch('https://ssh.test/tunnel', {
      headers: { upgrade: 'websocket' },
    });
    expect(response.status).toBe(404);
  });

  it('says so when no host key fingerprint is published', async () => {
    const response = await SELF.fetch('https://ssh.test/host-key');
    expect(response.status).toBe(404);
  });
});
