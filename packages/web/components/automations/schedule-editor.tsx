'use client';

/**
 * The schedule builder: crons from presets or typed, each in words with its next three runs,
 * checked by the parser the gateway schedules with. An invalid line stays in the editor (and
 * out of the file) until it parses.
 */
import { useState } from 'react';

import { CRON_PRESETS, describeCron, nextRuns } from '../../src/automations/cron-text';
import styles from './builder.module.css';

export function ScheduleEditor(props: {
  readonly crons: readonly string[];
  readonly onChange: (crons: readonly string[]) => void;
  readonly nowMs: number;
}) {
  const [typed, setTyped] = useState('');
  const typedWords = typed.trim() === '' ? null : describeCron(typed);
  const add = (cron: string) => {
    if (describeCron(cron) === null || props.crons.includes(cron.trim())) return;
    props.onChange([...props.crons, cron.trim()]);
    setTyped('');
  };
  return (
    <div className={styles.schedule}>
      <p className={styles.sub}>On a schedule (UTC)</p>
      {props.crons.length === 0 ? null : (
        <ul className={styles.crons}>
          {props.crons.map((cron) => (
            <li key={cron}>
              <CronLine cron={cron} nowMs={props.nowMs} />
              <button
                type="button"
                className={styles.remove}
                aria-label={`Remove schedule ${cron}`}
                onClick={() => props.onChange(props.crons.filter((one) => one !== cron))}
              >
                Remove
              </button>
            </li>
          ))}
        </ul>
      )}
      <div className={styles.cronAdd}>
        <select
          className={styles.input}
          aria-label="Add a schedule"
          value=""
          onChange={(event) => add(event.target.value)}
        >
          <option value="">Add a schedule…</option>
          {CRON_PRESETS.map((preset) => (
            <option key={preset.cron} value={preset.cron}>
              {preset.label}
            </option>
          ))}
        </select>
        <input
          className={`${styles.input} ${styles.mono}`}
          aria-label="Cron expression"
          placeholder="or cron: 30 8 * * 1-5"
          value={typed}
          onChange={(event) => setTyped(event.target.value)}
          onKeyDown={(event) => {
            if (event.key !== 'Enter') return;
            event.preventDefault();
            add(typed);
          }}
        />
        <button
          type="button"
          className={styles.button}
          disabled={typedWords === null}
          onClick={() => add(typed)}
        >
          Add
        </button>
      </div>
      {typed.trim() === '' ? null : (
        <p className={typedWords === null ? styles.problem : styles.hint} aria-live="polite">
          {typedWords ?? 'Not valid 5-field cron (minute hour day month weekday).'}
        </p>
      )}
    </div>
  );
}

function CronLine(props: { readonly cron: string; readonly nowMs: number }) {
  const words = describeCron(props.cron);
  const runs = nextRuns(props.cron, props.nowMs, 3);
  return (
    <div className={styles.cronLine}>
      <code>{props.cron}</code>
      <span>{words ?? 'not valid cron'}</span>
      {runs.length === 0 ? null : (
        <small>
          next:{' '}
          {runs.map((run) => (
            <time key={run} dateTime={run}>
              {run.slice(5, 16).replace('T', ' ')}
            </time>
          ))}
        </small>
      )}
    </div>
  );
}
