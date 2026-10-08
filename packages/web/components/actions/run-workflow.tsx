'use client';

/**
 * "Run workflow": a menu with the workflow's `workflow_dispatch` inputs (a choice as a
 * select, a boolean as a checkbox, the rest as text), run on the stalk. Maintainers only (the
 * page decides; the server action and the control plane check again). A run that starts
 * opens its page.
 */
import { useActionState } from 'react';

import type { DispatchInput } from '../../src/actions/actions-contract';
import type { ActionsAccess } from '../../src/server/actions-page';
import type { WorkflowFormState } from '../../src/server/workflow-actions';
import { dispatchWorkflowAction } from '../../src/server/workflow-actions';
import styles from './actions.module.css';
import { AccessFields } from './access-fields';

export function RunWorkflow(props: {
  readonly workflowId: string;
  readonly workflowName: string;
  readonly inputs: readonly DispatchInput[];
  readonly access: ActionsAccess;
}) {
  const [state, action, pending] = useActionState<WorkflowFormState, FormData>(
    dispatchWorkflowAction,
    { kind: 'idle' },
  );
  return (
    <details className={styles.menu}>
      <summary className={styles.primary}>Run workflow</summary>
      <form action={action} className={styles.dispatch}>
        <AccessFields access={props.access} />
        <input type="hidden" name="workflow" value={props.workflowId} />
        <p>
          Runs <b>{props.workflowName}</b> on the stalk&rsquo;s head, with its secrets.
        </p>
        {props.inputs.map((input) => (
          <InputField key={input.name} input={input} />
        ))}
        <button type="submit" className={styles.primary} disabled={pending}>
          {pending ? 'Starting…' : 'Run workflow'}
        </button>
        {state.kind === 'refused' ? (
          <p className={styles.alert} role="alert">
            {state.message}
          </p>
        ) : null}
      </form>
    </details>
  );
}

function InputField({ input }: { readonly input: DispatchInput }) {
  const name = `input:${input.name}`;
  const hint = input.description === null ? null : <small>{input.description}</small>;
  if (input.type === 'boolean')
    return (
      <label className={styles.check}>
        <input type="checkbox" name={name} value="true" defaultChecked={input.default === 'true'} />
        <span>
          <b className={styles.mono}>{input.name}</b>
          {hint === null ? null : <br />}
          {hint}
        </span>
      </label>
    );
  return (
    <label className={styles.field}>
      <span className={styles.mono}>
        {input.name}
        {input.required ? ' *' : ''}
      </span>
      {input.type === 'choice' ? (
        <select
          name={name}
          className={styles.input}
          defaultValue={input.default ?? input.options[0]}
        >
          {input.options.map((option) => (
            <option key={option} value={option}>
              {option}
            </option>
          ))}
        </select>
      ) : (
        <input
          name={name}
          className={styles.input}
          defaultValue={input.default ?? ''}
          required={input.required}
          inputMode={input.type === 'number' ? 'decimal' : undefined}
        />
      )}
      {hint}
    </label>
  );
}
