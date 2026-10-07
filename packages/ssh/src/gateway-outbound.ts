/**
 * The SSH server's only way out of its container: `http://gateway.internal/…`, intercepted by
 * the owning Durable Object and answered here over the GATEWAY service binding (RPC). Two calls:
 *
 * - `POST /ssh/keys/lookup` `{ public_key, confirm }` → `200 { handle }` or `404`: whose key it is;
 * - `/git/<owner>/<repo>.git/…` with the key in `x-beanstalk-ssh-key`: one smart-HTTP request,
 *   which the gateway serves as the key's owner through the same proxy as HTTPS.
 *
 * Nothing else is reachable: the container has no internet access.
 */
import { z } from 'zod';

/** What the gateway's default entrypoint offers git over SSH (its `sshKeyLookup` and `sshGit`). */
export type GatewaySsh = {
  sshKeyLookup(
    publicKey: string,
    confirm: boolean,
  ): Promise<{ readonly handle: string; readonly fingerprint: string } | null>;
  sshGit(publicKey: string, request: Request): Promise<Response>;
};

export const KEY_HEADER = 'x-beanstalk-ssh-key';

const KeyLookup = z.object({
  public_key: z.string().min(1).max(16_384),
  confirm: z.boolean(),
});

/** Answers one request from the container. */
export async function routeOutbound(request: Request, gateway: GatewaySsh): Promise<Response> {
  const url = new URL(request.url);
  if (url.pathname === '/ssh/keys/lookup' && request.method === 'POST')
    return lookupKey(request, gateway);
  if (url.pathname.startsWith('/git/')) return forwardGit(request, gateway);
  return new Response('not found\n', { status: 404 });
}

/** The binding as `GatewaySsh`, or null when it lacks the methods (an older gateway). */
export function gatewaySsh(binding: object): GatewaySsh | null {
  const methods = ['sshKeyLookup', 'sshGit'] as const satisfies readonly (keyof GatewaySsh)[];
  return isGatewaySsh(binding, methods) ? binding : null;
}

async function lookupKey(request: Request, gateway: GatewaySsh): Promise<Response> {
  const parsed = KeyLookup.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return new Response('bad key lookup\n', { status: 400 });
  const owner = await gateway.sshKeyLookup(parsed.data.public_key, parsed.data.confirm);
  return owner === null
    ? new Response('unknown key\n', { status: 404 })
    : Response.json({ handle: owner.handle });
}

async function forwardGit(request: Request, gateway: GatewaySsh): Promise<Response> {
  const key = request.headers.get(KEY_HEADER);
  if (key === null) return new Response('no key\n', { status: 401 });
  const headers = new Headers(request.headers);
  headers.delete(KEY_HEADER);
  const forwarded = new Request(request.url, {
    method: request.method,
    headers,
    body: request.body,
  });
  return gateway.sshGit(key, forwarded);
}

function isGatewaySsh(binding: object, methods: readonly string[]): binding is GatewaySsh {
  return methods.every((method) => typeof Reflect.get(binding, method) === 'function');
}
