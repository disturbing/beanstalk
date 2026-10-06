'use client';

import type { ReactNode } from 'react';
import { createContext, useContext, useEffect, useRef, useState } from 'react';

import type { BeanStreamSummary, BeanStreamView } from '@beanstalk/shared-ask/forge/bean-stream';

/**
 * Streaming diffs (`stream_diffs`) on the repository home: the beans whose agents are writing
 * now, from the live feed. The journey card reads its bean's snapshot through it; the stalk
 * and Growing now read the summaries.
 */
type LiveStreams = {
  readonly run: string;
  readonly streams: ReadonlyMap<string, BeanStreamSummary>;
};

const NO_STREAMS: LiveStreams = { run: '', streams: new Map() };

const LiveStreamsContext = createContext<LiveStreams>(NO_STREAMS);

export function LiveStreamsProvider(props: LiveStreams & { readonly children: ReactNode }) {
  const { run, streams } = props;
  return <LiveStreamsContext value={{ run, streams }}>{props.children}</LiveStreamsContext>;
}

/** The summaries of every bean streaming now, by task. */
export function useLiveStreams(): ReadonlyMap<string, BeanStreamSummary> {
  return useContext(LiveStreamsContext).streams;
}

/**
 * A bean's streamed change: fetched when a newer snapshot is announced (the newest request
 * wins), kept on screen until the next one arrives so the diff updates in place.
 * `writing` is false once the stream ended; the last snapshot stays until the caller has
 * the commit.
 */
export function useBeanStream(bean: string): {
  readonly view: BeanStreamView | null;
  readonly writing: boolean;
} {
  const { run, streams } = useContext(LiveStreamsContext);
  const summary = streams.get(bean);
  const seq = summary === undefined ? null : `${summary.inv}:${summary.seq}`;
  const [view, setView] = useState<BeanStreamView | null>(null);
  const latest = useRef<string | null>(null);
  useEffect(() => {
    if (seq === null || run === '') return undefined;
    latest.current = seq;
    const controller = new AbortController();
    const load = async () => {
      try {
        const next = await fetchStream(run, bean, controller.signal);
        if (latest.current === seq && next !== null) setView(next);
      } catch {
        // An aborted or failed read keeps the last snapshot; the next announcement retries.
      }
    };
    void load();
    return () => controller.abort();
  }, [run, bean, seq]);
  // A new invocation (a rework) starts from its own first snapshot, never the last one's.
  const stale = view !== null && summary !== undefined && view.summary.inv !== summary.inv;
  return { view: stale ? null : view, writing: summary !== undefined };
}

async function fetchStream(
  run: string,
  bean: string,
  signal: AbortSignal,
): Promise<BeanStreamView | null> {
  const response = await fetch(`/api/runs/${run}/beans/${bean}/stream`, {
    signal,
    cache: 'no-store',
  });
  if (!response.ok) return null;
  const body: { readonly stream: BeanStreamView | null } = await response.json();
  return body.stream;
}
