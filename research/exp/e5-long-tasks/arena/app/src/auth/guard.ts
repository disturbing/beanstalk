import type { Request } from '../router.ts';
import type { AppContext, User } from '../types.ts';
import { findSession } from './sessions.ts';

export function bearerToken(req: Pick<Request, 'headers'>): string | null {
  const header = req.headers.authorization;
  if (!header?.startsWith('Bearer ')) return null;
  return header.slice('Bearer '.length).trim() || null;
}

/** Resolve the user behind a request's bearer token, or null. */
export function authenticateRequest(ctx: AppContext, req: Pick<Request, 'headers'>): User | null {
  const token = bearerToken(req);
  if (!token) return null;
  const session = findSession(ctx, token);
  if (!session) return null;
  return ctx.store.users.get(session.userId) ?? null;
}
