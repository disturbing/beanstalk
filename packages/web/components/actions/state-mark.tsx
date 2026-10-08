/**
 * A run's, job's or step's state as a small mark: a filled disc with a tick (succeeded) or a
 * cross (failed, timed out), a turning arc (running), a dotted ring (queued), a slashed ring
 * (cancelled, runner lost) and a dash (skipped). Shape carries the state as well as colour.
 */
import type { RunState } from '../../src/actions/run-view';
import { STATE_WORDS } from '../../src/actions/run-view';
import styles from './actions.module.css';

export function StateMark(props: { readonly state: RunState; readonly size?: number }) {
  const size = props.size ?? 16;
  return (
    <svg
      className={styles.mark}
      data-state={props.state}
      width={size}
      height={size}
      viewBox="0 0 16 16"
      role="img"
      aria-label={STATE_WORDS[props.state]}
    >
      {shapeOf(props.state)}
    </svg>
  );
}

function shapeOf(state: RunState) {
  switch (state) {
    case 'success':
      return (
        <>
          <circle cx="8" cy="8" r="7" fill="currentColor" />
          <path d="M4.6 8.2 7 10.5l4.4-4.8" fill="none" stroke="var(--sheet)" strokeWidth="1.8" />
        </>
      );
    case 'failure':
    case 'timed_out':
    case 'startup_failure':
      return (
        <>
          <circle cx="8" cy="8" r="7" fill="currentColor" />
          <path d="m5.3 5.3 5.4 5.4m0-5.4-5.4 5.4" stroke="var(--sheet)" strokeWidth="1.8" />
        </>
      );
    case 'running':
      return (
        <>
          <circle
            cx="8"
            cy="8"
            r="6"
            fill="none"
            stroke="currentColor"
            strokeOpacity="0.3"
            strokeWidth="2"
          />
          <path
            className={styles.spin}
            d="M8 2a6 6 0 0 1 6 6"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
          />
          <circle cx="8" cy="8" r="2" fill="currentColor" />
        </>
      );
    case 'queued':
      return (
        <circle
          cx="8"
          cy="8"
          r="6"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.6"
          strokeDasharray="2 2.7"
        />
      );
    case 'cancelled':
    case 'infra_lost':
      return (
        <>
          <circle cx="8" cy="8" r="6" fill="none" stroke="currentColor" strokeWidth="1.6" />
          <path d="m4 12 8-8" stroke="currentColor" strokeWidth="1.6" />
        </>
      );
    case 'skipped':
      return <path d="M4 8h8" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />;
    default:
      return null;
  }
}
