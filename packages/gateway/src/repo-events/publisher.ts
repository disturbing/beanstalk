/**
 * The engine's side of `repo-events`: a repository engine's Durable Object sends its event
 * log to the queue from a cursor kept beside the log. The cursor moves only after a send
 * succeeded, so a failed send is retried by the next publish (the next step, the next alarm,
 * or a reader that finds the index behind), and a repository that grew before the queue
 * existed sends its whole history the first time. The consumer is idempotent, so a send
 * that is repeated after a crash between send and cursor write does no harm.
 */
import type { RepoEvent, RepoEventsMessage } from '@gitstalk/shared-race/repo-events';

import type { BeanLookup, StoredEvent } from './map-events';
import { repoEventsOf } from './map-events';

/** Where the cursor lives in the Durable Object's key-value storage. */
export const REPO_EVENTS_CURSOR_KEY = 'repo-events-cursor';
/** Rows of the event log read per round. */
const PAGE_ROWS = 500;
/** Repository events per queue message (the message schema allows 100). */
const EVENTS_PER_MESSAGE = 50;
/**
 * Messages per `sendBatch`: a batch may hold 100 messages but only 256 KB, and a message of
 * 50 events stays under about 20 KB.
 */
const MESSAGES_PER_BATCH = 10;

export type PublishHost = {
  readonly engine: string;
  readonly cursor: () => number;
  readonly setCursor: (seq: number) => void;
  /** Event rows of the published types after `after`, in order, at most `limit`. */
  readonly rows: (after: number, limit: number) => readonly StoredEvent[];
  readonly lookup: BeanLookup;
  readonly queue: Queue;
};

export type PublishOutcome = { readonly sent: number; readonly cursor: number };

/**
 * Sends everything after the cursor and moves it. Throws when a send fails, leaving the
 * cursor at the last batch that went out.
 */
export async function publishRepoEvents(host: PublishHost): Promise<PublishOutcome> {
  let cursor = host.cursor();
  let sent = 0;
  for (;;) {
    const rows = host.rows(cursor, PAGE_ROWS);
    const last = rows.at(-1);
    if (last === undefined) return { sent, cursor };
    const events = repoEventsOf(rows, host.lookup);
    // oxlint-disable-next-line no-await-in-loop -- pages go out in order; the cursor follows each
    await sendAll(host.queue, messagesOf(host.engine, events));
    cursor = last.seq;
    host.setCursor(cursor);
    sent += events.length;
    if (rows.length < PAGE_ROWS) return { sent, cursor };
  }
}

/** The events in messages of at most 50, in order. */
export function messagesOf(engine: string, events: readonly RepoEvent[]): RepoEventsMessage[] {
  const messages: RepoEventsMessage[] = [];
  for (let start = 0; start < events.length; start += EVENTS_PER_MESSAGE)
    messages.push({ v: 1, engine, events: events.slice(start, start + EVENTS_PER_MESSAGE) });
  return messages;
}

async function sendAll(queue: Queue, messages: readonly RepoEventsMessage[]): Promise<void> {
  for (let start = 0; start < messages.length; start += MESSAGES_PER_BATCH) {
    const batch = messages.slice(start, start + MESSAGES_PER_BATCH).map((body) => ({ body }));
    // oxlint-disable-next-line no-await-in-loop -- batches go out in order
    await queue.sendBatch(batch);
  }
}
