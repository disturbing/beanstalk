import { ok } from '../router.ts';
import type { Handler } from '../router.ts';
import { listNotifications } from './queue.ts';

export const list: Handler = (req, ctx) => ok(listNotifications(ctx, req.user!.id));
