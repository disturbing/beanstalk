import { randomBytes, scryptSync, timingSafeEqual } from 'node:crypto';

const KEY_LENGTH = 32;

export function hashPassword(
  password: string,
  cost: number,
  salt: string = randomBytes(16).toString('hex'),
): { hash: string; salt: string } {
  const hash = scryptSync(password, salt, KEY_LENGTH, { N: cost }).toString('hex');
  return { hash, salt };
}

export function verifyPassword(password: string, hash: string, salt: string, cost: number): boolean {
  const candidate = Buffer.from(hashPassword(password, cost, salt).hash, 'hex');
  const expected = Buffer.from(hash, 'hex');
  return candidate.length === expected.length && timingSafeEqual(candidate, expected);
}
