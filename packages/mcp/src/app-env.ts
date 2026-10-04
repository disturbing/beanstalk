import type { Deps } from './deps';
import type { ViewerClaims } from './auth/bearer';

/** Hono's environment: the generated bindings plus what middleware sets per request. */
export type AppEnv = {
  readonly Bindings: Env;
  readonly Variables: { readonly deps: Deps; readonly viewer: ViewerClaims };
};
