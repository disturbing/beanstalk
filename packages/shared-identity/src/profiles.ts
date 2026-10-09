/**
 * A person's public profile (display name, bio, website, picture) and their handle. A handle
 * change retires the old one: it keeps redirecting to the person (`resolveRetiredHandle`) and
 * nobody else can sign up with it or take it, but its owner can take it back.
 */
import { z } from 'zod';

import { auditStatement } from './audit';
import type { IdentityEnv } from './identity-env';
import { Handle, isUniqueViolation } from './users';

export type Profile = {
  readonly id: string;
  readonly handle: string;
  readonly displayName: string;
  readonly bio: string;
  readonly website: string;
  /** R2 key of the uploaded picture (`users/<id>/avatar/<hash>`), or null: the fallback. */
  readonly avatarKey: string | null;
  readonly createdAt: number;
  /** When the handle last changed, or null if never. */
  readonly handleChangedAt: number | null;
};

export const MAX_DISPLAY_NAME = 64;
export const MAX_BIO = 160;
export const MAX_WEBSITE = 200;
/** A handle can change once a day, so a freed handle cannot be bounced between accounts. */
export const HANDLE_CHANGE_COOLDOWN_MS = 24 * 3600 * 1000;

/** Printable text on one line: no control characters (they would break layouts and logs). */
const OneLine = z
  .string()
  .trim()
  .refine((text) => !/\p{Cc}/u.test(text), 'Use plain text on one line.');

/** A website: empty, or an http(s) URL; a bare domain gets https:// in front. */
export const Website = z
  .string()
  .trim()
  .max(MAX_WEBSITE, `Keep the website under ${MAX_WEBSITE + 1} characters.`)
  .transform((text) => (text === '' || /^https?:\/\//i.test(text) ? text : `https://${text}`))
  .refine(
    (text) => text === '' || isWebUrl(text),
    'Enter a web address such as https://example.com.',
  );

export const ProfileInput = z.object({
  displayName: OneLine.pipe(
    z.string().max(MAX_DISPLAY_NAME, `Keep the name under ${MAX_DISPLAY_NAME + 1} characters.`),
  ),
  bio: z
    .string()
    // Browsers send a textarea's line breaks as CRLF; store plain LF.
    .transform((text) => text.replace(/\r\n?/g, '\n').trim())
    .pipe(
      z
        .string()
        .max(MAX_BIO, `Keep the bio under ${MAX_BIO + 1} characters.`)
        .refine((text) => !/[\p{Cc}--[\n]]/v.test(text), 'Use plain text.'),
    ),
  website: Website,
});
export type ProfileInput = z.input<typeof ProfileInput>;

type Actor = { readonly userId: string; readonly ip: string | null; readonly now: number };

const PROFILE_COLUMNS =
  'id, handle, display_name, bio, website, avatar_key, created_at, handle_changed_at';

type ProfileRow = {
  readonly id: string;
  readonly handle: string;
  readonly display_name: string;
  readonly bio: string;
  readonly website: string;
  readonly avatar_key: string | null;
  readonly created_at: number;
  readonly handle_changed_at: number | null;
};

export async function getProfile(env: IdentityEnv, userId: string): Promise<Profile | null> {
  const row = await env.IDENTITY_DB.prepare(
    `SELECT ${PROFILE_COLUMNS} FROM users WHERE id = ? AND disabled_at IS NULL`,
  )
    .bind(userId)
    .first<ProfileRow>();
  return row === null ? null : toProfile(row);
}

/** A person by their current handle (any case), for their public page. */
export async function findProfileByHandle(
  env: IdentityEnv,
  handle: string,
): Promise<Profile | null> {
  const row = await env.IDENTITY_DB.prepare(
    `SELECT ${PROFILE_COLUMNS} FROM users WHERE handle = ? AND disabled_at IS NULL`,
  )
    .bind(handle.trim())
    .first<ProfileRow>();
  return row === null ? null : toProfile(row);
}

export type ProfileUpdate =
  | { readonly ok: true; readonly profile: Profile }
  | { readonly ok: false; readonly field: keyof ProfileInput; readonly message: string };

export async function updateProfile(
  env: IdentityEnv,
  input: Actor & { readonly profile: ProfileInput },
): Promise<ProfileUpdate> {
  const parsed = ProfileInput.safeParse(input.profile);
  if (!parsed.success) {
    const issue = parsed.error.issues[0];
    const field = ProfileInput.keyof().safeParse(issue?.path[0]);
    return {
      ok: false,
      field: field.success ? field.data : 'displayName',
      message: issue?.message ?? 'Check the form.',
    };
  }
  const { displayName, bio, website } = parsed.data;
  await env.IDENTITY_DB.batch([
    env.IDENTITY_DB.prepare(
      'UPDATE users SET display_name = ?, bio = ?, website = ? WHERE id = ?',
    ).bind(displayName, bio, website, input.userId),
    await auditStatement(
      env,
      { action: 'profile.update', actorUserId: input.userId, ip: input.ip },
      input.now,
    ),
  ]);
  const profile = await getProfile(env, input.userId);
  if (profile === null) throw new Error(`profile of ${input.userId} vanished during an update`);
  return { ok: true, profile };
}

/**
 * Points the person's picture at an uploaded key (or null: back to the fallback) and answers
 * the previous key, which the caller deletes from R2 once this is saved.
 */
export async function setAvatarKey(
  env: IdentityEnv,
  input: Actor & { readonly key: string | null },
): Promise<{ readonly previous: string | null }> {
  const before = await getProfile(env, input.userId);
  if (before === null) throw new Error(`no profile for ${input.userId}`);
  await env.IDENTITY_DB.batch([
    env.IDENTITY_DB.prepare('UPDATE users SET avatar_key = ? WHERE id = ?').bind(
      input.key,
      input.userId,
    ),
    await auditStatement(
      env,
      {
        action: 'avatar.set',
        actorUserId: input.userId,
        ip: input.ip,
        detail: { removed: input.key === null },
      },
      input.now,
    ),
  ]);
  return { previous: before.avatarKey === input.key ? null : before.avatarKey };
}

export type HandleChange =
  | { readonly ok: true; readonly from: string; readonly to: string }
  | {
      readonly ok: false;
      readonly reason: 'invalid' | 'unchanged' | 'taken' | 'too_soon';
      readonly message: string;
    };

/**
 * Changes a handle. Refused when the new one is malformed or reserved, is someone's current or
 * retired handle, or the last change was under a day ago. The old handle is retired to this
 * person in the same batch; taking back one's own retired handle frees that row.
 */
export async function changeHandle(
  env: IdentityEnv,
  input: Actor & { readonly handle: string },
): Promise<HandleChange> {
  const parsed = Handle.safeParse(input.handle);
  if (!parsed.success)
    return refuseHandle('invalid', capitalised(parsed.error.issues[0]?.message ?? 'invalid'));
  const to = parsed.data;
  const profile = await getProfile(env, input.userId);
  if (profile === null) throw new Error(`no profile for ${input.userId}`);
  if (to === profile.handle.toLowerCase())
    return refuseHandle('unchanged', `You are already @${to}.`);
  const since = profile.handleChangedAt === null ? Infinity : input.now - profile.handleChangedAt;
  if (since < HANDLE_CHANGE_COOLDOWN_MS)
    return refuseHandle('too_soon', 'You changed your handle in the last day. Try again tomorrow.');
  if (await isHeldByAnother(env, to, input.userId))
    return refuseHandle('taken', `@${to} is taken.`);
  try {
    await env.IDENTITY_DB.batch(await handleStatements(env, input, { from: profile.handle, to }));
  } catch (error: unknown) {
    if (isUniqueViolation(error)) return refuseHandle('taken', `@${to} is taken.`);
    throw error;
  }
  return { ok: true, from: profile.handle, to };
}

/**
 * Undoes a change whose follow-up failed (the repositories could not move): the person is
 * `from` again, `to` is free, and the cooldown is as it was.
 */
export async function revertHandleChange(
  env: IdentityEnv,
  input: Actor & { readonly from: string; readonly to: string; readonly changedAt: number | null },
): Promise<void> {
  const db = env.IDENTITY_DB;
  await db.batch([
    db
      .prepare('DELETE FROM retired_handles WHERE handle = ? AND user_id = ?')
      .bind(input.from, input.userId),
    db
      .prepare('UPDATE users SET handle = ?, handle_changed_at = ? WHERE id = ? AND handle = ?')
      .bind(input.from, input.changedAt, input.userId, input.to),
  ]);
}

/** The person's current handle when `handle` is one they retired, else null. */
export async function resolveRetiredHandle(
  env: IdentityEnv,
  handle: string,
): Promise<string | null> {
  const row = await env.IDENTITY_DB.prepare(
    `SELECT u.handle FROM retired_handles r JOIN users u ON u.id = r.user_id
      WHERE r.handle = ? AND u.disabled_at IS NULL`,
  )
    .bind(handle.trim())
    .first<{ handle: string }>();
  return row?.handle ?? null;
}

/** The handles a person used before, newest first (shown under the handle field). */
export async function retiredHandles(env: IdentityEnv, userId: string): Promise<readonly string[]> {
  const { results } = await env.IDENTITY_DB.prepare(
    'SELECT handle FROM retired_handles WHERE user_id = ? ORDER BY retired_at DESC',
  )
    .bind(userId)
    .all<{ handle: string }>();
  return results.map((row) => row.handle);
}

async function isHeldByAnother(env: IdentityEnv, handle: string, userId: string): Promise<boolean> {
  const row = await env.IDENTITY_DB.prepare(
    `SELECT 1 AS held FROM users WHERE handle = ?1 AND id <> ?2
     UNION ALL SELECT 1 FROM orgs WHERE handle = ?1
     UNION ALL SELECT 1 FROM retired_handles WHERE handle = ?1 AND user_id <> ?2 LIMIT 1`,
  )
    .bind(handle, userId)
    .first<{ held: number }>();
  return row !== null;
}

async function handleStatements(
  env: IdentityEnv,
  input: Actor,
  change: { readonly from: string; readonly to: string },
): Promise<D1PreparedStatement[]> {
  const db = env.IDENTITY_DB;
  return [
    db
      .prepare('DELETE FROM retired_handles WHERE handle = ? AND user_id = ?')
      .bind(change.to, input.userId),
    db
      .prepare('INSERT INTO retired_handles (handle, user_id, retired_at) VALUES (?, ?, ?)')
      .bind(change.from, input.userId, input.now),
    db
      .prepare('UPDATE users SET handle = ?, handle_changed_at = ? WHERE id = ?')
      .bind(change.to, input.now, input.userId),
    await auditStatement(
      env,
      {
        action: 'handle.change',
        actorUserId: input.userId,
        ip: input.ip,
        detail: { from: change.from, to: change.to },
      },
      input.now,
    ),
  ];
}

function toProfile(row: ProfileRow): Profile {
  return {
    id: row.id,
    handle: row.handle,
    displayName: row.display_name,
    bio: row.bio,
    website: row.website,
    avatarKey: row.avatar_key,
    createdAt: row.created_at,
    handleChangedAt: row.handle_changed_at,
  };
}

function isWebUrl(text: string): boolean {
  if (!URL.canParse(text)) return false;
  const url = new URL(text);
  return (url.protocol === 'https:' || url.protocol === 'http:') && url.hostname.includes('.');
}

function refuseHandle(
  reason: Extract<HandleChange, { ok: false }>['reason'],
  message: string,
): HandleChange {
  return { ok: false, reason, message };
}

function capitalised(text: string): string {
  const sentence = text.charAt(0).toUpperCase() + text.slice(1);
  return sentence.endsWith('.') ? sentence : `${sentence}.`;
}
