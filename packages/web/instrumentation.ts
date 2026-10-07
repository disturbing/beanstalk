/**
 * Request errors the framework catches (a page that throws while rendering shows the error
 * page) are logged here, so they reach Workers logs instead of disappearing.
 */
import { log } from './src/log';

export function register(): void {
  // Nothing to set up: Workers observability collects the logs.
}

export function onRequestError(
  error: unknown,
  request: { readonly path: string; readonly method: string },
  context: { readonly routePath?: string; readonly routeType?: string },
): void {
  log.error('request failed', {
    path: request.path,
    method: request.method,
    route: context.routePath ?? null,
    kind: context.routeType ?? null,
    error,
    stack: error instanceof Error ? (error.stack ?? null) : null,
  });
}
