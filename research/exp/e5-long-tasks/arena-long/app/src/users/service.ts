import { hashPassword } from '../auth/password.ts';
import { badRequest, conflict } from '../lib/errors.ts';
import type { AppContext, Address, User } from '../types.ts';

export interface RegisterInput {
  email: string;
  name: string;
  password: string;
}

/** A user as exposed over the API: no credentials. */
export type PublicUser = Omit<User, 'passwordHash' | 'passwordSalt'>;

export function toPublic(user: User): PublicUser {
  const { passwordHash: _hash, passwordSalt: _salt, ...rest } = user;
  return rest;
}

export function findByEmail(ctx: AppContext, email: string): User | undefined {
  return ctx.store.users.findOne((u) => u.email === email.trim());
}

export function registerUser(ctx: AppContext, input: RegisterInput): User {
  const email = input.email.trim();
  if (!email.includes('@')) throw badRequest('email is invalid');
  if (findByEmail(ctx, email)) throw conflict('email is already registered');
  const { hash, salt } = hashPassword(input.password, ctx.config.passwordCost);
  return ctx.store.users.insert({
    id: ctx.store.nextId('usr'),
    email,
    name: input.name.trim(),
    role: 'customer',
    passwordHash: hash,
    passwordSalt: salt,
    addresses: [],
    createdAt: ctx.clock.now().toISOString(),
  });
}

export function updateProfile(ctx: AppContext, userId: string, patch: { name?: string }): User {
  const changes: Partial<User> = {};
  if (patch.name !== undefined) {
    if (patch.name === '') throw badRequest('name cannot be empty');
    changes.name = patch.name;
  }
  return ctx.store.users.update(userId, changes);
}

export function addAddress(ctx: AppContext, userId: string, address: Address): User {
  const user = ctx.store.users.require(userId);
  return ctx.store.users.update(userId, { addresses: [...user.addresses, address] });
}
