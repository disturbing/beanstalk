/**
 * Email magic links through Cloudflare Email Service (the `send_email` binding). Built and
 * tested, but off until a sender domain is onboarded: `EMAIL_SENDER_DOMAIN` empty (the
 * default) or no `EMAIL` binding means `emailSignInConfig` answers null and the web app hides
 * every email control.
 *
 * A link is 32 random bytes, stored hashed, single use, 15 minutes, and bound to the browser
 * that asked (the `__Host-bs_preauth` cookie), so a forwarded link signs nobody else in. The
 * request never says whether an email has an account: the mail does.
 */
import { auditStatement, recordAudit } from './audit';
import type { IdentityEnv } from './identity-env';
import { hashSecret, isSameSecret, randomId, randomSecret } from './secrets';
import type { NewSession } from './sessions';
import { SESSION_SECONDS, sessionInsert } from './sessions';
import type { SessionUser } from './users';
import { findUserByEmail, insertUser, isHandleTaken, isUniqueViolation } from './users';

export const MAGIC_LINK_SECONDS = 15 * 60;
export const MAGIC_LINK_PATH = '/auth/email';

/** The email sender: the Email Service binding, or a fake in tests. */
export type EmailSender = Pick<SendEmail, 'send'>;

export type EmailSignInConfig = {
  readonly sender: EmailSender;
  /** `Gitstalk <signin@domain>`. */
  readonly from: { readonly email: string; readonly name: string };
};

export type MagicLinkRequest = {
  readonly email: string;
  /** Required to create an account; ignored when the email already has one. */
  readonly handle: string | null;
  /** The site origin the link points at. */
  readonly origin: string;
  /** The requesting browser's pre-auth cookie secret. */
  readonly browserSecret: string;
  readonly ip: string | null;
  readonly now: number;
};

export type MagicLinkOutcome =
  | {
      readonly ok: true;
      readonly user: SessionUser;
      readonly session: NewSession;
      readonly created: boolean;
    }
  | { readonly ok: false; readonly reason: 'invalid' | 'other_browser' | 'handle_taken' };

/**
 * Email sign-in, or null while it is switched off. On only when both a sender domain and the
 * EMAIL binding are configured.
 */
export function emailSignInConfig(env: {
  readonly EMAIL_SENDER_DOMAIN?: string;
  readonly EMAIL?: EmailSender;
}): EmailSignInConfig | null {
  const domain = env.EMAIL_SENDER_DOMAIN?.trim() ?? '';
  if (domain === '' || env.EMAIL === undefined) return null;
  return { sender: env.EMAIL, from: { email: `signin@${domain}`, name: 'Gitstalk' } };
}

/** Sends a sign-in (or sign-up) link, or a "no account yet" note when there is no handle. */
export async function requestMagicLink(
  env: IdentityEnv,
  config: EmailSignInConfig,
  request: MagicLinkRequest,
): Promise<void> {
  const existing = await findUserByEmail(env, request.email);
  const purpose = existing === null ? 'signup' : 'signin';
  if (purpose === 'signup' && request.handle === null) {
    await sendNoAccount(config, request);
    return;
  }
  const token = randomSecret();
  await env.IDENTITY_DB.batch([
    env.IDENTITY_DB.prepare('DELETE FROM magic_links WHERE expires_at <= ?').bind(request.now),
    env.IDENTITY_DB.prepare(
      'INSERT INTO magic_links (token_hash, email, purpose, handle, browser_hash, expires_at) VALUES (?, ?, ?, ?, ?, ?)',
    ).bind(
      await hashSecret(token),
      request.email,
      purpose,
      purpose === 'signup' ? request.handle : null,
      await hashSecret(request.browserSecret),
      request.now + MAGIC_LINK_SECONDS * 1000,
    ),
    await auditStatement(
      env,
      {
        action: 'magic_link.request',
        actorUserId: existing?.id ?? null,
        ip: request.ip,
        detail: { purpose },
      },
      request.now,
    ),
  ]);
  const link = `${request.origin}${MAGIC_LINK_PATH}?token=${encodeURIComponent(token)}`;
  await config.sender.send({
    from: config.from,
    to: request.email,
    subject: purpose === 'signin' ? 'Sign in to Gitstalk' : 'Finish signing up for Gitstalk',
    text: linkText(purpose, link),
    html: linkHtml(purpose, link),
  });
}

/** Opens the link: signs in, or creates the account it was asked for. Single use. */
export async function consumeMagicLink(
  env: IdentityEnv,
  input: {
    readonly token: string;
    readonly browserSecret: string | null;
    readonly userAgent: string | null;
    readonly ip: string | null;
    readonly now: number;
  },
): Promise<MagicLinkOutcome> {
  if (input.token.length > 64) return { ok: false, reason: 'invalid' };
  const tokenHash = await hashSecret(input.token);
  const row = await env.IDENTITY_DB.prepare(
    'SELECT email, purpose, handle, browser_hash FROM magic_links WHERE token_hash = ? AND used_at IS NULL AND expires_at > ?',
  )
    .bind(tokenHash, input.now)
    .first<{
      email: string;
      purpose: 'signin' | 'signup';
      handle: string | null;
      browser_hash: string;
    }>();
  if (row === null) return { ok: false, reason: 'invalid' };
  const browserHash = input.browserSecret === null ? '' : await hashSecret(input.browserSecret);
  if (!(await isSameSecret(browserHash, row.browser_hash)))
    return { ok: false, reason: 'other_browser' };
  const claimed = await env.IDENTITY_DB.prepare(
    'UPDATE magic_links SET used_at = ? WHERE token_hash = ? AND used_at IS NULL',
  )
    .bind(input.now, tokenHash)
    .run();
  if (claimed.meta.changes === 0) return { ok: false, reason: 'invalid' };
  const existing = await findUserByEmail(env, row.email);
  if (existing !== null) return signIn(env, { ...input, user: existing, created: false });
  if (row.handle === null) return { ok: false, reason: 'invalid' };
  return signUp(env, { ...input, email: row.email, handle: row.handle });
}

async function signIn(
  env: IdentityEnv,
  input: {
    readonly user: SessionUser;
    readonly created: boolean;
    readonly userAgent: string | null;
    readonly ip: string | null;
    readonly now: number;
  },
): Promise<MagicLinkOutcome> {
  const session = { secret: randomSecret(), expiresAt: input.now + SESSION_SECONDS * 1000 };
  await (
    await sessionInsert(
      env,
      { userId: input.user.id, userAgent: input.userAgent, ...session },
      input.now,
    )
  ).run();
  await recordAudit(
    env,
    {
      action: 'session.signin',
      actorUserId: input.user.id,
      ip: input.ip,
      detail: { method: 'email' },
    },
    input.now,
  );
  const user = { id: input.user.id, handle: input.user.handle, email: input.user.email };
  return { ok: true, user, session, created: input.created };
}

async function signUp(
  env: IdentityEnv,
  input: {
    readonly email: string;
    readonly handle: string;
    readonly userAgent: string | null;
    readonly ip: string | null;
    readonly now: number;
  },
): Promise<MagicLinkOutcome> {
  if (await isHandleTaken(env, input.handle)) return { ok: false, reason: 'handle_taken' };
  const user = { id: randomId('u'), handle: input.handle, email: input.email };
  const session = { secret: randomSecret(), expiresAt: input.now + SESSION_SECONDS * 1000 };
  try {
    await env.IDENTITY_DB.batch([
      insertUser(env, user, input.now),
      await sessionInsert(
        env,
        { userId: user.id, userAgent: input.userAgent, ...session },
        input.now,
      ),
      await auditStatement(
        env,
        {
          action: 'user.signup',
          actorUserId: user.id,
          target: user.handle,
          ip: input.ip,
          detail: { method: 'email' },
        },
        input.now,
      ),
    ]);
  } catch (error: unknown) {
    if (isUniqueViolation(error)) return { ok: false, reason: 'handle_taken' };
    throw error;
  }
  return { ok: true, user, session, created: true };
}

async function sendNoAccount(config: EmailSignInConfig, request: MagicLinkRequest): Promise<void> {
  const signup = `${request.origin}/signup`;
  await config.sender.send({
    from: config.from,
    to: request.email,
    subject: 'Sign in to Gitstalk',
    text: `Someone asked to sign in to Gitstalk with this address, but it has no account yet.\n\nSign up here: ${signup}\n\nIf it was not you, ignore this email.`,
    html: `<p>Someone asked to sign in to Gitstalk with this address, but it has no account yet.</p><p><a href="${signup}">Sign up</a></p><p>If it was not you, ignore this email.</p>`,
  });
}

function linkText(purpose: 'signin' | 'signup', link: string): string {
  const action = purpose === 'signin' ? 'sign in' : 'finish signing up';
  return `Open this link to ${action} to Gitstalk. It works once, for 15 minutes, in the browser you asked from:\n\n${link}\n\nIf you did not ask for it, ignore this email.`;
}

function linkHtml(purpose: 'signin' | 'signup', link: string): string {
  const action = purpose === 'signin' ? 'Sign in' : 'Finish signing up';
  return `<p><a href="${link}">${action} to Gitstalk</a></p><p>The link works once, for 15 minutes, in the browser you asked from. If you did not ask for it, ignore this email.</p>`;
}
