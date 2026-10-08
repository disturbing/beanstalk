/**
 * Which Actions control plane a request talks to: the actions Worker's binding (`ACTIONS`,
 * or the gateway when it carries the methods), else the fixture fake when this deployment
 * says so (`ACTIONS_SOURCE=fixtures`, staging only), else none. The fake's overlay rides in a
 * cookie, so a staging walk can dispatch, cancel and name secrets with no store. Server-only.
 */
import { env } from 'cloudflare:workers';
import { cookies } from 'next/headers';

import type { ActionsClient } from '../actions/actions-client';
import { actionsClient, asActionsRpc } from '../actions/actions-client';
import type { ActionsActor } from '../actions/actions-contract';
import { fakeControlPlane } from '../actions/fake/fake-control-plane';
import type { FakeOverlay } from '../actions/fake/fake-overlay';
import { decodeOverlay, encodeOverlay } from '../actions/fake/fake-overlay';

const FAKE_COOKIE = 'bs_actions_fixtures';
const FAKE_COOKIE_DAYS = 7;

type Scope = { readonly actor: ActionsActor; readonly repoId: string };

/** The client, and how to keep what the fake changed (a no-op for the real control plane). */
export type ActionsSession = {
  readonly client: ActionsClient;
  readonly persist: () => Promise<void>;
};

/** For pages and server actions (cookies through next/headers). */
export async function actionsSession(scope: Scope): Promise<ActionsSession | null> {
  const jar = await cookies();
  return sessionFrom(scope, jar.get(FAKE_COOKIE)?.value, async (value) => {
    (await cookies()).set(FAKE_COOKIE, value, {
      httpOnly: true,
      secure: true,
      sameSite: 'lax',
      path: '/',
      maxAge: FAKE_COOKIE_DAYS * 86_400,
    });
  });
}

/** For route handlers, which read the request's own cookie header (they never write). */
export function actionsSessionFor(request: Request, scope: Scope): ActionsSession | null {
  const cookie = request.headers.get('cookie') ?? '';
  const value = cookie
    .split(';')
    .map((part) => part.trim())
    .find((part) => part.startsWith(`${FAKE_COOKIE}=`))
    ?.slice(FAKE_COOKIE.length + 1);
  return sessionFrom(scope, value, async () => {});
}

function sessionFrom(
  scope: Scope,
  cookieValue: string | undefined,
  writeCookie: (value: string) => Promise<void>,
): ActionsSession | null {
  const rpc = asActionsRpc(Reflect.get(env, 'ACTIONS')) ?? asActionsRpc(env.GATEWAY);
  if (rpc !== null)
    return { client: actionsClient(rpc, { ...scope, mode: 'live' }), persist: async () => {} };
  if (env.ACTIONS_SOURCE !== 'fixtures') return null;
  let overlay: FakeOverlay = decodeOverlay(cookieValue);
  let changed = false;
  const fake = fakeControlPlane({
    store: {
      read: () => overlay,
      write: (next) => {
        overlay = next;
        changed = true;
      },
    },
    nowMs: () => Date.now(),
  });
  return {
    client: actionsClient(fake, { ...scope, mode: 'fixtures' }),
    persist: async () => {
      if (changed) await writeCookie(encodeOverlay(overlay));
    },
  };
}
