import { asBody, requireString } from '../lib/validate.ts';
import { unauthorized } from '../lib/errors.ts';
import { noContent, ok } from '../router.ts';
import type { Handler } from '../router.ts';
import { findByEmail } from '../users/service.ts';
import { verifyPassword } from './password.ts';
import { bearerToken } from './guard.ts';
import { createSession, destroySession, purgeExpiredSessions } from './sessions.ts';

export const login: Handler = (req, ctx) => {
  const body = asBody(req.body);
  const email = requireString(body, 'email');
  const password = requireString(body, 'password');
  const user = findByEmail(ctx, email);
  if (!user || !verifyPassword(password, user.passwordHash, user.passwordSalt, ctx.config.passwordCost)) {
    throw unauthorized('invalid email or password');
  }
  const session = createSession(ctx, user.id);
  return ok({ token: session.id, expiresAt: session.expiresAt });
};

export const logout: Handler = (req, ctx) => {
  const token = bearerToken(req);
  if (token) destroySession(ctx, token);
  purgeExpiredSessions(ctx);
  return noContent();
};
