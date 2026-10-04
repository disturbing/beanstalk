import { Hono } from 'hono';

import type { AppEnv } from '../app-env';
import { livePage } from '../live/live-page';
import { RunParam, validate } from './validation';

/**
 * `GET /runs/:run`: the live page. The page itself holds no run data; it reads the view
 * token from its own `?key=` and uses it for the feed, so the HTML needs no credentials.
 */
export const liveRoutes = new Hono<AppEnv>().get('/:run', validate('param', RunParam), (c) =>
  c.html(livePage(c.req.valid('param').run), 200, {
    'content-security-policy':
      "default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; connect-src 'self'; base-uri 'none'",
    'referrer-policy': 'no-referrer',
  }),
);
