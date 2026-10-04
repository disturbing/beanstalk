import { authenticateRequest } from './auth/guard.ts';
import { AppError, forbidden, unauthorized } from './lib/errors.ts';
import type { AppContext, User } from './types.ts';

export interface Request {
  method: string;
  path: string;
  query: Record<string, string>;
  headers: Record<string, string>;
  body: unknown;
  params: Record<string, string>;
  /** Filled in by the router for `user` and `admin` routes. */
  user: User | null;
}

export interface Response {
  status: number;
  headers: Record<string, string>;
  body: unknown;
}

export type Handler = (req: Request, ctx: AppContext) => Response;
export type Access = 'public' | 'user' | 'admin';

interface Route {
  method: string;
  segments: string[];
  access: Access;
  handler: Handler;
}

export function json(status: number, body: unknown, headers: Record<string, string> = {}): Response {
  return { status, headers: { 'content-type': 'application/json', ...headers }, body };
}

export const ok = (body: unknown): Response => json(200, body);
export const created = (body: unknown): Response => json(201, body);
export const noContent = (): Response => ({ status: 204, headers: {}, body: null });

function split(path: string): string[] {
  return path.split('/').filter(Boolean);
}

export class Router {
  private routes: Route[] = [];

  add(method: string, pattern: string, access: Access, handler: Handler): void {
    this.routes.push({ method: method.toUpperCase(), segments: split(pattern), access, handler });
  }

  /** Routes are matched in registration order; the first match wins. */
  handle(ctx: AppContext, input: Partial<Request> & { method: string; path: string }): Response {
    const [path, queryString = ''] = input.path.split('?');
    const query = { ...Object.fromEntries(new URLSearchParams(queryString)), ...input.query };
    const headers = Object.fromEntries(
      Object.entries(input.headers ?? {}).map(([k, v]) => [k.toLowerCase(), v]),
    );
    const parts = split(path);
    for (const route of this.routes) {
      if (route.method !== input.method.toUpperCase()) continue;
      const params = matchSegments(route.segments, parts);
      if (!params) continue;
      const req: Request = {
        method: route.method,
        path,
        query,
        headers,
        body: input.body ?? null,
        params,
        user: null,
      };
      try {
        if (route.access !== 'public') {
          req.user = authenticateRequest(ctx, req);
          if (!req.user) throw unauthorized();
          if (route.access === 'admin' && req.user.role !== 'admin') throw forbidden();
        }
        return route.handler(req, ctx);
      } catch (error) {
        if (error instanceof AppError) {
          return json(error.status, { error: { code: error.code, message: error.message } });
        }
        throw error;
      }
    }
    return json(404, { error: { code: 'not_found', message: `no route for ${input.method} ${path}` } });
  }
}

function matchSegments(pattern: string[], actual: string[]): Record<string, string> | null {
  if (pattern.length !== actual.length) return null;
  const params: Record<string, string> = {};
  for (let i = 0; i < pattern.length; i++) {
    if (pattern[i].startsWith(':')) params[pattern[i].slice(1)] = decodeURIComponent(actual[i]);
    else if (pattern[i] !== actual[i]) return null;
  }
  return params;
}
