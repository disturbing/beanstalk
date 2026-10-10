import { env } from 'cloudflare:workers';

import { recordAudit } from '@gitstalk/shared-identity/audit';
import { clientIp } from '@gitstalk/shared-identity/request-context';
import {
  getWebSession,
  revokeAllSessions,
  revokeSession,
} from '@gitstalk/shared-identity/sessions';

import { signOut } from '../../../src/auth/sign-out';

/** Signs out this browser, or every browser (`everywhere=1`); see `src/auth/sign-out.ts`. */
export async function POST(request: Request): Promise<Response> {
  return signOut(
    request,
    {
      session: (cookies) => getWebSession(cookies, env),
      revoke: async (sessionHash, now) => {
        await revokeSession(env, sessionHash, now);
      },
      revokeAll: async (userId, now) => {
        await revokeAllSessions(env, userId, now);
      },
      audit: (event, now) =>
        recordAudit(
          env,
          { action: event.action, actorUserId: event.userId, ip: clientIp(request) },
          now,
        ),
    },
    Date.now(),
  );
}
