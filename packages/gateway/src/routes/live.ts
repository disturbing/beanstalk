import { Hono } from 'hono';

import type { AppEnv } from '../app-env';
import { GatewayError } from '../errors';
import { livePage } from '../live/live-page';
import { requireReader } from '../middleware/auth';
import { RunParam, validate } from './validation';

/**
 * `GET /runs/:run`: the live page. The page itself holds no run data; it reads the view
 * token from its own `?key=` and uses it for the feed, so the HTML needs no credentials.
 *
 * `GET /runs/:run/streams?key=<view token>`: the run's streaming diffs (`stream_diffs`) as a
 * WebSocket, served by the run's `RunStreamDO` (docs/claude-17-streaming-diffs.md).
 */
export const liveRoutes = new Hono<AppEnv>()
  .get('/:run', validate('param', RunParam), (c) =>
    c.html(livePage(c.req.valid('param').run), 200, {
      'content-security-policy':
        "default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; connect-src 'self'; base-uri 'none'",
      'referrer-policy': 'no-referrer',
    }),
  )
  .get('/:run/streams', requireReader, validate('param', RunParam), async (c) => {
    if (c.req.header('upgrade')?.toLowerCase() !== 'websocket')
      throw new GatewayError('the stream feed is a WebSocket', 'upgrade_required', 400);
    return c.var.deps.streams(c.req.valid('param').run).fetch(c.req.raw);
  });
