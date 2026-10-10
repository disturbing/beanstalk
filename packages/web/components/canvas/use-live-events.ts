'use client';

import { useEffect, useState } from 'react';

import type { RaceEvent } from '@gitstalk/shared-ask/race/race-events';
import { parseRaceEvents } from '@gitstalk/shared-ask/race/race-events';

export type LiveStatus = 'connecting' | 'live' | 'reconnecting' | 'closed';

/**
 * Follows a live run: the server bridges the gateway's WebSocket feed (through the service
 * binding) to Server-Sent Events, which reconnect on their own and resume after the last
 * event seen. Streaming diffs (`stream_diffs`) have their own feed (`useLiveStreams` in
 * `components/home/live-streams.tsx`).
 */
export function useLiveEvents(
  run: string,
  initial: readonly RaceEvent[],
  enabled: boolean,
): {
  readonly events: readonly RaceEvent[];
  readonly status: LiveStatus;
} {
  const [events, setEvents] = useState<readonly RaceEvent[]>(initial);
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
    source.addEventListener('end', () => {
      setStatus('closed');
      source.close();
    });
    return () => source.close();
  }, [run, enabled, initial]);

  return { events, status };
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
