/**
 * `engineFeeds`: what happened lately in repositories' engines, for a person's Home. Each
 * engine answers from its own Durable Object (its counts, the tail of its event log, and its
 * pushed beans for who pushed what), all engines at once; the web app makes one call.
 */
import { z } from 'zod';

import type { EngineFeed, EngineFeedItem, EngineFeedRpc } from '@beanstalk/shared-race/engine-feed';
import { MAX_FEED_ENGINES, MAX_FEED_ITEMS } from '@beanstalk/shared-race/engine-feed';
import { RunId } from '@beanstalk/shared-race/ids';

import type { Deps } from '../deps';

/** Events read from the end of each log: enough for a Home's recent lines. */
const TAIL_EVENTS = 400;

/** Who pushed a bean and what it is called. */
export type PushedBy = { readonly title: string; readonly actor: string };

export function engineFeedRpc(deps: Deps): EngineFeedRpc {
  return {
    async engineFeeds(engineIds, limit) {
      const ids = z.array(z.string()).max(MAX_FEED_ENGINES).safeParse(engineIds);
      if (!ids.success)
        return {
          ok: false,
          error: {
            code: 'invalid_request',
            status: 400,
            message: `at most ${MAX_FEED_ENGINES} engine ids`,
          },
        };
      const items = Math.max(1, Math.min(MAX_FEED_ITEMS, Math.trunc(limit)));
      const feeds = await Promise.all(ids.data.map((id) => engineFeed(deps, id, items)));
      return { ok: true, value: feeds };
    },
  };
}

async function engineFeed(deps: Deps, engineId: string, limit: number): Promise<EngineFeed> {
  const empty: EngineFeed = { engine_id: engineId, tasks: {}, items: [] };
  const id = RunId.safeParse(engineId);
  if (!id.success) return empty;
  const stub = deps.run(id.data);
  const view = await stub.view();
  if (!view.ok) return empty;
  const after = Math.max(0, view.value.events - TAIL_EVENTS);
  const [page, pushed] = await Promise.all([stub.events(after, TAIL_EVENTS), stub.pushedBeans()]);
  const by = new Map(pushed.map((bean) => [bean.bean, { title: bean.title, actor: bean.actor }]));
  const bodies = page.ok ? page.value.bodies : [];
  return {
    engine_id: engineId,
    tasks: view.value.tasks,
    items: feedItems(bodies.map(parseBody), by).toReversed().slice(0, limit),
  };
}

const Envelope = z.object({ seq: z.number(), ts: z.string(), type: z.string() });
const Task = z.object({ task: z.string().nullable().optional() });
const Check = z.object({
  task: z.string(),
  green: z.boolean(),
  inherited: z.boolean().optional(),
  failing_tests: z.array(z.string()).default([]),
});
const Conflict = z.object({ task: z.string().nullable(), files: z.array(z.string()) });
const Land = z.object({ task: z.string().nullable().optional(), sha: z.string() });
const Promote = z.object({ sha: z.string(), tasks: z.array(z.string()) });
const Request = z.object({ card: z.string(), task: z.string(), against: z.array(z.string()) });
const Made = z.object({ card: z.string(), winner: z.string(), oracle: z.string() });
const Stopped = z.object({ task: z.string(), reason: z.string() });

type Line = {
  readonly kind: EngineFeedItem['kind'];
  readonly bean: string | null;
  readonly detail: string;
};

/** How each event type the feed follows becomes lines (a validation may carry several beans). */
const LINES: Readonly<Record<string, (event: unknown) => readonly Line[]>> = {
  'task.start': (event) => {
    const task = Task.safeParse(event).data?.task ?? null;
    return task === null ? [] : [{ kind: 'pushed', bean: task, detail: '' }];
  },
  'preland.check': (event) => {
    const check = Check.safeParse(event);
    if (!check.success || check.data.green || check.data.inherited === true) return [];
    return [{ kind: 'red', bean: check.data.task, detail: check.data.failing_tests.join(', ') }];
  },
  'merge.conflict': (event) => {
    const conflict = Conflict.safeParse(event);
    if (!conflict.success || conflict.data.task === null) return [];
    return [{ kind: 'conflict', bean: conflict.data.task, detail: conflict.data.files.join(', ') }];
  },
  land: (event) => {
    const land = Land.safeParse(event);
    const task = land.data?.task ?? null;
    if (!land.success || task === null) return [];
    return [{ kind: 'landed', bean: task, detail: land.data.sha.slice(0, 7) }];
  },
  'green.promote': (event) => {
    const promote = Promote.safeParse(event);
    if (!promote.success) return [];
    const at = promote.data.sha.slice(0, 7);
    return promote.data.tasks.map((task) => ({
      kind: 'validated' as const,
      bean: task,
      detail: at,
    }));
  },
  'decision.request': (event) => {
    const card = Request.safeParse(event);
    if (!card.success) return [];
    return [
      {
        kind: 'decision',
        bean: card.data.task,
        detail: `${card.data.card}: ${[card.data.task, ...card.data.against].join(' or ')}`,
      },
    ];
  },
  'decision.made': (event) => {
    const made = Made.safeParse(event);
    if (!made.success) return [];
    return [
      {
        kind: 'decided',
        bean: made.data.winner,
        detail: `${made.data.card}: by ${made.data.oracle}`,
      },
    ];
  },
  'task.parked': (event) => stopped(event, 'parked'),
  'task.drop': (event) => stopped(event, 'dropped'),
};

/** The feed lines of `events` (oldest first), named with who pushed each bean. */
export function feedItems(
  events: readonly unknown[],
  pushed: ReadonlyMap<string, PushedBy>,
): EngineFeedItem[] {
  return events.flatMap((event) => {
    const envelope = Envelope.safeParse(event);
    if (!envelope.success) return [];
    const lines = LINES[envelope.data.type]?.(event) ?? [];
    return lines.map((line) => {
      const by = line.bean === null ? undefined : pushed.get(line.bean);
      return {
        seq: envelope.data.seq,
        at: isoOf(envelope.data.ts),
        kind: line.kind,
        bean: line.bean,
        detail: line.detail,
        title: by?.title ?? null,
        actor: by?.actor ?? null,
      };
    });
  });
}

function stopped(event: unknown, kind: 'parked' | 'dropped'): readonly Line[] {
  const parsed = Stopped.safeParse(event);
  return parsed.success ? [{ kind, bean: parsed.data.task, detail: parsed.data.reason }] : [];
}

/** The log's wall clock (`…+00:00`) as a plain ISO instant; unreadable times stay as written. */
function isoOf(ts: string): string {
  const ms = Date.parse(ts);
  return Number.isNaN(ms) ? ts : new Date(ms).toISOString();
}

function parseBody(body: string): unknown {
  try {
    return JSON.parse(body);
  } catch {
    // A line that is not JSON is not an event the feed can show.
    return null;
  }
}
