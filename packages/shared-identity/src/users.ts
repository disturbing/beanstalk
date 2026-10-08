/**
 * People: an id, a unique handle, an email once one is verified, and when they joined.
 * Handles share one namespace with orgs (`orgs.ts`), are case-insensitive and URL-safe.
 */
import { z } from 'zod';

import type { IdentityEnv } from './identity-env';
import { isReservedHandle } from './reserved-handles';

/** What every other package sees of a signed-in person. */
export type SessionUser = {
  readonly id: string;
  readonly handle: string;
  /** Null until an email is verified (passkey sign-ups have none). */
  readonly email: string | null;
};

export type UserRecord = SessionUser & {
  readonly createdAt: number;
};

/** 2–39 characters: lowercase letters, digits and single hyphens, not at either end. */
export const Handle = z
  .string()
  .trim()
  .toLowerCase()
  .regex(
    /^[a-z0-9](?:[a-z0-9]|-(?=[a-z0-9])){1,38}$/,
    'use 2–39 lowercase letters, digits or single hyphens',
  )
  .refine((handle) => !isReservedHandle(handle), 'that handle is reserved');

export const Email = z.string().trim().toLowerCase().pipe(z.email()).pipe(z.string().max(254));

type UserRow = {
  readonly id: string;
  readonly handle: string;
  readonly email: string | null;
  readonly created_at: number;
};

const USER_COLUMNS = 'id, handle, email, created_at';

export async function findUserById(env: IdentityEnv, id: string): Promise<UserRecord | null> {
  const row = await env.IDENTITY_DB.prepare(
    `SELECT ${USER_COLUMNS} FROM users WHERE id = ? AND disabled_at IS NULL`,
  )
    .bind(id)
    .first<UserRow>();
  return row === null ? null : toUser(row);
}

export async function findUserByEmail(env: IdentityEnv, email: string): Promise<UserRecord | null> {
  const row = await env.IDENTITY_DB.prepare(
    `SELECT ${USER_COLUMNS} FROM users WHERE email = ? AND disabled_at IS NULL`,
  )
    .bind(email)
    .first<UserRow>();
  return row === null ? null : toUser(row);
}

/** Whether a person or an org holds `handle` (one namespace, `orgs.ts`). */
export async function isHandleTaken(env: IdentityEnv, handle: string): Promise<boolean> {
  const row = await env.IDENTITY_DB.prepare(
    'SELECT 1 AS taken FROM users WHERE handle = ?1 UNION ALL SELECT 1 FROM orgs WHERE handle = ?1',
  )
    .bind(handle)
    .first<{ taken: number }>();
  return row !== null;
}

/** The statement that inserts a user; callers batch it with the sign-in method's row. */
export function insertUser(
  env: IdentityEnv,
  user: { readonly id: string; readonly handle: string; readonly email: string | null },
  now: number,
): D1PreparedStatement {
  return env.IDENTITY_DB.prepare(
    'INSERT INTO users (id, handle, email, email_verified_at, created_at) VALUES (?, ?, ?, ?, ?)',
  ).bind(user.id, user.handle, user.email, user.email === null ? null : now, now);
}

/** Whether a D1 error is a unique-constraint violation (a handle or email taken meanwhile). */
export function isUniqueViolation(error: unknown): boolean {
  return error instanceof Error && /UNIQUE constraint failed/i.test(error.message);
}

function toUser(row: UserRow): UserRecord {
  return { id: row.id, handle: row.handle, email: row.email, createdAt: row.created_at };
}
