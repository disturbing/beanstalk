import type { Logger } from './log';

export type AppEnv = {
  Bindings: Env;
  Variables: { log: Logger };
};
