'use client';

/**
 * Settings → Secrets and variables → Variables: plain configuration workflows read as
 * `${{ vars.NAME }}`, shown with their values to everyone with a role. Maintainers and the
 * owner add, change and delete the repository's own; the org's that reach it are listed
 * read-only with their source, and a repository variable wins over an org one of the same name.
 */
import { useActionState } from 'react';

import type { InheritableVariable } from '../../src/actions/actions-contract';
import { timeAgo } from '../../src/repositories/when';
import type { ActionsAccess } from '../../src/server/actions-page';
import type { WorkflowFormState } from '../../src/server/workflow-actions';
import { deleteVariableAction, putVariableAction } from '../../src/server/workflow-actions';
import { AccessFields } from './access-fields';
import styles from './actions.module.css';
import { InheritedEntries } from './inherited-entries';
import { FormMessage } from './secrets-settings';

export function VariablesSettings(props: {
  readonly own: readonly InheritableVariable[];
  readonly inherited: readonly InheritableVariable[];
  /** Null for people who may only read. */
  readonly access: ActionsAccess | null;
  readonly nowMs: number;
}) {
  return (
    <>
      <h3 id="variables">Variables</h3>
      <p>
        Workflows read them as <code>{'${{ vars.NAME }}'}</code>. They are not secret: anyone with a
        role on this repository sees their values, and logs print them as they are.
      </p>
      {props.access === null ? null : <AddVariable access={props.access} />}
      {props.own.length === 0 ? (
        <p className={styles.muted}>No repository variables yet.</p>
      ) : (
        <ul className={styles.secrets} aria-label="Variables">
          {props.own.map((variable) => (
            <VariableRow
              key={variable.name}
              variable={variable}
              access={props.access}
              nowMs={props.nowMs}
            />
          ))}
        </ul>
      )}
      <InheritedEntries kind="variable" entries={props.inherited} nowMs={props.nowMs} />
    </>
  );
}

function AddVariable({ access }: { readonly access: ActionsAccess }) {
  const [state, action, pending] = useActionState<WorkflowFormState, FormData>(putVariableAction, {
    kind: 'idle',
  });
  return (
    <form action={action} className={styles.secretForm} autoComplete="off">
      <AccessFields access={access} />
      <label className={styles.field}>
        <span>Name</span>
        <input
          name="variable"
          className={styles.input}
          placeholder="CLOUDFLARE_ACCOUNT_ID"
          required
          maxLength={100}
          spellCheck={false}
          autoCapitalize="characters"
        />
      </label>
      <label className={styles.field}>
        <span>Value</span>
        <input name="value" className={styles.input} spellCheck={false} />
        <small>Saving a name that exists replaces its value.</small>
      </label>
      <div className={styles.formFoot}>
        <button type="submit" className={styles.primary} disabled={pending}>
          {pending ? 'Saving…' : 'Save variable'}
        </button>
        <FormMessage state={state} />
      </div>
    </form>
  );
}

function VariableRow(props: {
  readonly variable: InheritableVariable;
  readonly access: ActionsAccess | null;
  readonly nowMs: number;
}) {
  const { variable, access } = props;
  const [state, remove, deleting] = useActionState<WorkflowFormState, FormData>(
    deleteVariableAction,
    { kind: 'idle' },
  );
  const deleted = state.kind === 'done';
  return (
    <li>
      <div>
        <span className={styles.secretName}>{variable.name}</span>{' '}
        <code className={styles.variableValue}>{variable.value}</code>
        <br />
        <span className={styles.secretMeta}>
          {deleted
            ? 'Deleted'
            : `Updated ${timeAgo(variable.updatedAt, props.nowMs)} by @${variable.updatedBy}`}
        </span>
      </div>
      {access === null || deleted ? null : (
        <div className={styles.secretTools}>
          <form action={remove}>
            <AccessFields access={access} />
            <input type="hidden" name="variable" value={variable.name} />
            <button
              type="submit"
              className={styles.danger}
              disabled={deleting}
              aria-label={`Delete ${variable.name}`}
            >
              Delete
            </button>
          </form>
          <FormMessage state={state} />
        </div>
      )}
    </li>
  );
}
