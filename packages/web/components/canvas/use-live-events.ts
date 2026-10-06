'use client';

import { useEffect, useState } from 'react';

import type { BeanStreamSummary } from '@beanstalk/shared-ask/forge/bean-stream';
import { BeanStreamMessage } from '@beanstalk/shared-ask/forge/bean-stream';
import type { RaceEvent } from '@beanstalk/shared-ask/race/race-events';
import { parseRaceEvents } from '@beanstalk/shared-ask/race/race-events';

export type LiveStatus = 'connecting' | 'live' | 'reconnecting' | 'closed';

/**
 * Follows a live run: the server bridges the gateway's WebSocket feed (through the service
 * binding) to Server-Sent Events, which reconnect on their own and resume after the last
 * event seen. Streaming diffs (`stream_diffs`) arrive as `stream` events: the beans whose
 * agents are writing now, latest summary each, by task.
 */
export function useLiveEvents(
  run: string,
  initial: readonly RaceEvent[],
  enabled: boolean,
): {
  readonly events: readonly RaceEvent[];
  readonly status: LiveStatus;
  readonly streams: ReadonlyMap<string, BeanStreamSummary>;
} {
  const [events, setEvents] = useState<readonly RaceEvent[]>(initial);
  const [streams, setStreams] = useState<ReadonlyMap<string, BeanStreamSummary>>(new Map());
  const [status, setStatus] = useState<LiveStatus>(enabled ? 'connecting' : 'closed');

  useEffect(() => {
    if (!enabled) return undefined;
    const after = initial.at(-1)?.seq ?? 0;
    const source = new EventSource(`/api/runs/${run}/live?after=${after}`);
    source.addEventListener('open', () => setStatus('live'));
    source.addEventListener('error', () =>
      setStatus(source.readyState === EventSource.CLOSED ? 'closed' : 'reconnecting'),
    );
    source.addEventListener('events', (message) => {
      const parsed = parseRaceEvents(parseLines(message.data));
      setEvents((current) => appendNew(current, parsed.events));
    });
    source.addEventListener('stream', (message) => {
      const parsed = BeanStreamMessage.safeParse(parseJson(message.data));
      if (parsed.success) setStreams((current) => withStream(current, parsed.data));
    });
    source.addEventListener('end', () => {
      setStatus('closed');
      source.close();
    });
    return () => source.close();
  }, [run, enabled, initial]);

  return { events, status, streams };
}

function withStream(
  current: ReadonlyMap<string, BeanStreamSummary>,
  message: BeanStreamMessage,
): ReadonlyMap<string, BeanStreamSummary> {
  const known = current.get(message.task);
  const next = new Map(current);
  if (message.type === 'bean.streaming.end') {
    if (known === undefined || known.inv !== message.inv) return current;
    next.delete(message.task);
    return next;
  }
  if (known !== undefined && known.inv === message.inv && known.seq >= message.seq) return current;
  next.set(message.task, message);
  return next;
}

function parseJson(data: unknown): unknown {
  if (typeof data !== 'string') return undefined;
  try {
    return JSON.parse(data);
  } catch {
    // A malformed stream message is skipped; the next snapshot replaces it.
    return undefined;
  }
}

function parseLines(data: unknown): readonly unknown[] {
  if (typeof data !== 'string') return [];
  try {
    const value: unknown = JSON.parse(data);
    return Array.isArray(value) ? value : [];
  } catch {
    // A malformed message is skipped; the next one resumes from its own sequence numbers.
    return [];
  }
}

function appendNew(
  current: readonly RaceEvent[],
  incoming: readonly RaceEvent[],
): readonly RaceEvent[] {
  const last = current.at(-1)?.seq ?? 0;
  const fresh = incoming.filter((event) => event.seq > last);
  return fresh.length === 0 ? current : [...current, ...fresh];
}
