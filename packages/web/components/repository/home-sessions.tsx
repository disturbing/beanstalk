'use client';

/**
 * Home's live half (`docs/claude-opus/16` item 1.6): the person's connected agent sessions,
 * asked for every 3 s until one connects (so a session signed in from a terminal shows up
 * within seconds), and the first-visit checklist, which ticks "connect" from the same list.
 */
import Link from 'next/link';
import type { ReactNode } from 'react';
import { createContext, useContext, useEffect, useState } from 'react';
import { z } from 'zod';

import { AgentSession } from '@beanstalk/shared-identity/agent-sessions';

import type { FirstStepId } from '../../src/home/first-steps';
import { firstSteps, isStarted, sessionsPollMs } from '../../src/home/first-steps';
import { timeAgo } from '../../src/repositories/when';
import styles from './repository.module.css';

const SessionsAnswer = z.object({ sessions: AgentSession.array() });

type Live = { readonly sessions: readonly AgentSession[] | null; readonly nowMs: number };

const LiveContext = createContext<Live>({ sessions: null, nowMs: 0 });

/** Keeps the session list fresh while the page is visible. */
export function LiveSessions({
  initial,
  nowMs,
  children,
}: {
  readonly initial: readonly AgentSession[] | null;
  readonly nowMs: number;
  readonly children: ReactNode;
}) {
  const [live, setLive] = useState<Live>({ sessions: initial, nowMs });
  useEffect(() => {
    let timer: ReturnType<typeof setTimeout> | undefined;
    let stopped = false;
    const schedule = (sessions: readonly AgentSession[]) => {
      if (!stopped) timer = setTimeout(() => void refresh(), sessionsPollMs(sessions));
    };
    const refresh = async () => {
      if (document.visibilityState !== 'visible') return schedule([]);
      const sessions = await fetchSessions();
      if (sessions !== null) setLive({ sessions, nowMs: Date.now() });
      schedule(sessions ?? []);
    };
    schedule(initial ?? []);
    return () => {
      stopped = true;
      clearTimeout(timer);
    };
  }, [initial]);
  return <LiveContext value={live}>{children}</LiveContext>;
}

/** The three first steps, until all are done. */
export function FirstSteps(props: {
  readonly repositories: number;
  readonly repositoriesWithBeans: number;
}) {
  const { sessions } = useContext(LiveContext);
  const steps = firstSteps({ sessions: sessions?.length ?? 0, ...props });
  if (isStarted(steps)) return null;
  const done = steps.filter((step) => step.done).length;
  return (
    <section className={styles.panel} aria-labelledby="steps-title">
      <div className={styles.panelHead}>
        <h2 id="steps-title">Get started</h2>
        <span className={styles.muted}>{done} of 3 done</span>
      </div>
      <ol className={styles.steps}>
        {steps.map((step) => (
          <li key={step.id} className={step.done ? styles.stepDone : undefined}>
            <span className={styles.stepMark} aria-hidden="true">
              {step.done ? '✓' : ''}
            </span>
            <div>
              {STEP_TEXT[step.id]}
              {step.done ? <span className="visually-hidden"> (done)</span> : null}
            </div>
          </li>
        ))}
      </ol>
    </section>
  );
}

const STEP_TEXT: Readonly<Record<FirstStepId, ReactNode>> = {
  connect: (
    <>
      <strong>Connect an agent session.</strong> Paste one command into Claude Code or Codex and
      approve it in the browser. <Link href="/signup/agent">Connect an agent</Link>
    </>
  ),
  repository: (
    <>
      <strong>Create or import a repository.</strong> The TypeScript starter has a check every bean
      must pass. <Link href="/new">New repository</Link>
    </>
  ),
  bean: (
    <>
      <strong>Push a first bean.</strong> Ask your agent for a change, or push a{' '}
      <code>bean/&lt;name&gt;</code> branch yourself; it lands when its check is green.
    </>
  ),
};

/** "Your sessions": each connected agent, newest first. */
export function SessionsPanel() {
  const { sessions, nowMs } = useContext(LiveContext);
  return (
    <section className={styles.panel} aria-labelledby="sessions-title">
      <div className={styles.panelHead}>
        <h2 id="sessions-title">Your sessions</h2>
        <Link href="/signup/agent" className={styles.muted}>
          Connect another
        </Link>
      </div>
      <SessionList sessions={sessions} nowMs={nowMs} />
    </section>
  );
}

function SessionList({
  sessions,
  nowMs,
}: {
  readonly sessions: readonly AgentSession[] | null;
  readonly nowMs: number;
}) {
  if (sessions === null)
    return (
      <p className={styles.empty}>Sessions could not be loaded; this list retries by itself.</p>
    );
  if (sessions.length === 0)
    return (
      <p className={styles.empty} aria-live="polite">
        No agent connected yet. <Link href="/signup/agent">Connect Claude Code or Codex</Link>; it
        shows up here as soon as you approve it.
      </p>
    );
  return (
    <ul className={styles.repoList} aria-live="polite">
      {sessions.map((session) => (
        <li key={session.grantId} className={styles.sessionRow}>
          <span className={styles.sessionDot} aria-hidden="true" />
          <div>
            <span className={styles.sessionName}>{session.clientName}</span>
            <p className={styles.repoMeta}>
              {session.settling === true ? 'connecting' : 'connected'}{' '}
              {timeAgo(new Date(session.createdAt).toISOString(), nowMs)} ·{' '}
              {session.scopes.join(', ')}
            </p>
          </div>
        </li>
      ))}
    </ul>
  );
}

async function fetchSessions(): Promise<readonly AgentSession[] | null> {
  try {
    const response = await fetch('/api/sessions', {
      cache: 'no-store',
      signal: AbortSignal.timeout(5000),
    });
    if (!response.ok) return null;
    const parsed = SessionsAnswer.safeParse(await response.json());
    return parsed.success ? parsed.data.sessions : null;
  } catch {
    // Offline or slow: the next tick tries again.
    return null;
  }
}
