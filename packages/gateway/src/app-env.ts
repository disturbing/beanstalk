import type { TokenClaims } from './auth/tokens';
import type { Deps } from './deps';

/** Who made the request: the admin, or the holder of a run token. */
export type Principal =
  | { readonly kind: 'admin' }
  | { readonly kind: 'token'; readonly claims: TokenClaims };

export type AppEnv = {
  Bindings: Env;
  Variables: {
    requestId: string;
    deps: Deps;
    principal: Principal;
  };
};
