'use client';

/**
 * A run's buttons for maintainers: Cancel while it can still change, Re-run once it has
 * finished (the workflow dispatched again on the stalk with the same inputs). The page shows
 * them only to maintainers and the owner; the server action and the control plane check again.
 */
import { useActionState } from 'react';

import type { ActionsAccess } from '../../src/server/actions-page';
import type { WorkflowFormState } from '../../src/server/workflow-actions';
import { cancelRunAction, rerunRunAction } from '../../src/server/workflow-actions';
import { AccessFields } from './access-fields';
import styles from './actions.module.css';

export function RunControls(props: {
  readonly runId: string;
  readonly live: boolean;
  readonly canRerun: boolean;
  readonly access: ActionsAccess;
}) {
  const [cancelState, cancel, cancelling] = useActionState<WorkflowFormState, FormData>(
    cancelRunAction,
    { kind: 'idle' },
  );
  const [rerunState, rerun, rerunning] = useActionState<WorkflowFormState, FormData>(
    rerunRunAction,
    { kind: 'idle' },
  );
  const message = [cancelState, rerunState].find((state) => state.kind !== 'idle');
  return (
    <div className={styles.runControls}>
      {props.live ? (
        <form action={cancel}>
          <AccessFields access={props.access} />
          <input type="hidden" name="run" value={props.runId} />
          <button
            type="submit"
            className={styles.danger}
            disabled={cancelling || cancelState.kind === 'done'}
          >
            {cancelling ? 'Cancelling…' : 'Cancel run'}
          </button>
        </form>
      ) : null}
      {!props.live && props.canRerun ? (
        <form action={rerun}>
          <AccessFields access={props.access} />
          <input type="hidden" name="run" value={props.runId} />
          <button type="submit" className={styles.button} disabled={rerunning}>
            {rerunning ? 'Starting…' : 'Re-run'}
          </button>
        </form>
      ) : null}
      {message === undefined ? null : (
        <p className={message.kind === 'refused' ? styles.alert : styles.status} role="status">
          {message.message}
        </p>
      )}
    </div>
  );
}
