'use client';

import type { FeedLine, FeedTone } from '../../src/race/race-feed';
import { formatClock } from '../../src/race/race-format';
import styles from './canvas.module.css';

const TONE_CLASS: Readonly<Record<FeedTone, string | undefined>> = {
  good: styles.toneGood,
  bad: styles.toneBad,
  warn: styles.toneWarn,
  human: styles.toneHuman,
  neutral: styles.toneNeutral,
};

/** The newest events first, one sentence each, with a shape per tone. */
export function EventFeed(props: { readonly lines: readonly FeedLine[] }) {
  if (props.lines.length === 0) return <p className={styles.legend}>Nothing has happened yet.</p>;
  return (
    <ol className={styles.feed} aria-label="Event feed, newest first">
      {props.lines.map((line) => (
        <li key={line.seq} className={styles.feedLine}>
          <span className={styles.feedTime}>{formatClock(line.t)}</span>
          <ToneGlyph tone={line.tone} />
          <span className={styles.feedText}>{line.text}</span>
        </li>
      ))}
    </ol>
  );
}

function ToneGlyph({ tone }: { readonly tone: FeedTone }) {
  const shapes: Readonly<Record<FeedTone, React.ReactNode>> = {
    good: <circle cx="6" cy="6" r="4" fill="currentColor" />,
    bad: (
      <path
        d="M2.5 2.5 9.5 9.5M9.5 2.5 2.5 9.5"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
      />
    ),
    warn: (
      <path
        d="M6 1.5 10.5 10h-9Z"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.6"
        strokeLinejoin="round"
      />
    ),
    human: <path d="M6 1.5 10.5 6 6 10.5 1.5 6Z" fill="currentColor" />,
    neutral: <circle cx="6" cy="6" r="2" fill="currentColor" />,
  };
  return (
    <svg width="12" height="12" viewBox="0 0 12 12" className={TONE_CLASS[tone]} aria-hidden="true">
      {shapes[tone]}
    </svg>
  );
}
