import { badRequest } from './errors.ts';

export type Body = Record<string, unknown>;

/** Narrow an unknown request body to a plain object, or fail with 400. */
export function asBody(raw: unknown): Body {
  if (raw === null || typeof raw !== 'object' || Array.isArray(raw)) {
    throw badRequest('request body must be a JSON object');
  }
  return raw as Body;
}

export function requireString(body: Body, key: string): string {
  const value = body[key];
  if (typeof value !== 'string' || value.trim() === '') {
    throw badRequest(`${key} is required`);
  }
  return value.trim();
}

export function optionalString(body: Body, key: string): string | undefined {
  const value = body[key];
  if (value === undefined || value === null) return undefined;
  if (typeof value !== 'string') throw badRequest(`${key} must be a string`);
  return value.trim();
}

export function requireInt(body: Body, key: string, min = 0): number {
  const value = body[key];
  if (typeof value !== 'number' || !Number.isInteger(value) || value < min) {
    throw badRequest(`${key} must be an integer >= ${min}`);
  }
  return value;
}
