'use client';

/**
 * Settings → Actions: this month's minutes against the beta's allowance, and the repository's
 * secrets by name. A value is write-only: typed once, sent once, never shown or returned.
 * Each secret has an "available to pre-land checks" switch, off by default, with the reason
 * it is off. Maintainers and the owner only (the page decides; the server checks again).
 */
import { useActionState, useState } from 'react';

import type { ActionsUsage, SecretSummary } from '../../src/actions/actions-contract';
import { timeAgo } from '../../src/repositories/when';
import type { ActionsAccess } from '../../src/server/actions-page';
import type { WorkflowFormState } from '../../src/server/workflow-actions';
import { deleteSecretAction, putSecretAction } from '../../src/server/workflow-actions';
import { AccessFields } from './access-fields';
import styles from './actions.module.css';

export function SecretsSettings(props: {
  readonly secrets: readonly SecretSummary[] | null;
  readonly error: string | null;
  readonly usage: ActionsUsage | null;
  readonly access: ActionsAccess;
  /** Whether pre-land access can change without the value (else: save the secret again). */
  readonly canToggle: boolean;
  readonly nowMs: number;
}) {
  return (
    <>
      {props.usage === null ? null : <UsageMeter usage={props.usage} />}
      <h3 id="secrets">Secrets</h3>
      <p>
        Workflows read them as <code>{'${{ secrets.NAME }}'}</code>. A value is never shown again
        after you save it, is masked as <code>***</code> in logs, and never reaches agent sessions.
        Pre-land checks get none unless you switch a secret on for them.
      </p>
      <AddSecret access={props.access} />
      {props.secrets === null ? (
        <p className={styles.alert}>Secrets could not be read: {props.error}</p>
      ) : (
        <SecretList
          secrets={props.secrets}
          access={props.access}
          canToggle={props.canToggle}
          nowMs={props.nowMs}
        />
      )}
    </>
  );
}

function UsageMeter({ usage }: { readonly usage: ActionsUsage }) {
  const share = usage.minutesIncluded === 0 ? 1 : usage.minutesUsed / usage.minutesIncluded;
  const level = meterLevel(share);
  return (
    <div className={styles.meter}>
      <div
        className={styles.meterBar}
        data-level={level}
        role="meter"
        aria-label="Actions minutes used this month"
        aria-valuemin={0}
        aria-valuemax={usage.minutesIncluded}
        aria-valuenow={Math.min(usage.minutesUsed, usage.minutesIncluded)}
      >
        <i style={{ width: `${Math.min(100, share * 100)}%` }} />
      </div>
      <p className={styles.meterText}>
        <span>
          <b>
            {usage.minutesUsed} of {usage.minutesIncluded} minutes
          </b>{' '}
          used in {monthName(usage.month)}
        </span>
        <span>Each job stops after {usage.jobTimeoutMinutes} minutes</span>
      </p>
    </div>
  );
}

function AddSecret({ access }: { readonly access: ActionsAccess }) {
  const [state, action, pending] = useActionState<WorkflowFormState, FormData>(putSecretAction, {
    kind: 'idle',
  });
  const [preland, setPreland] = useState(false);
  return (
    <form action={action} className={styles.secretForm} autoComplete="off">
      <AccessFields access={access} />
      <label className={styles.field}>
        <span>Name</span>
        <input
          name="secret"
          className={styles.input}
          placeholder="CLOUDFLARE_API_TOKEN"
          required
          maxLength={100}
          spellCheck={false}
          autoCapitalize="characters"
        />
      </label>
      <label className={styles.field}>
        <span>Value</span>
        <input
          name="value"
          type="password"
          className={styles.input}
          required
          autoComplete="new-password"
          spellCheck={false}
        />
        <small>Saving a name that exists replaces its value.</small>
      </label>
      <label className={styles.check}>
        <input
          type="checkbox"
          name="preland"
          checked={preland}
          onChange={(event) => setPreland(event.target.checked)}
        />
        <span>Available to pre-land checks</span>
      </label>
      {preland ? <PrelandRisk /> : null}
      <div className={styles.formFoot}>
        <button type="submit" className={styles.primary} disabled={pending}>
          {pending ? 'Saving…' : 'Save secret'}
        </button>
        <FormMessage state={state} />
      </div>
    </form>
  );
}

function PrelandRisk() {
  return (
    <p className={styles.risk} role="note">
      Pre-land checks run the code in a bean before anyone has reviewed it, including beans pushed
      by agent sessions. Any test in such a bean can read this secret and send it anywhere. Turn it
      on only for values that are safe to leak, such as a test database.
    </p>
  );
}

function SecretList(props: {
  readonly secrets: readonly SecretSummary[];
  readonly access: ActionsAccess;
  readonly canToggle: boolean;
  readonly nowMs: number;
}) {
  if (props.secrets.length === 0) return <p className={styles.muted}>No secrets yet.</p>;
  return (
    <ul className={styles.secrets} aria-label="Secrets">
      {props.secrets.map((secret) => (
        <SecretRow
          key={secret.name}
          secret={secret}
          access={props.access}
          canToggle={props.canToggle}
          nowMs={props.nowMs}
        />
      ))}
    </ul>
  );
}

function SecretRow(props: {
  readonly secret: SecretSummary;
  readonly access: ActionsAccess;
  readonly canToggle: boolean;
  readonly nowMs: number;
}) {
  const { secret, access } = props;
  const [toggleState, toggle, toggling] = useActionState<WorkflowFormState, FormData>(
    putSecretAction,
    { kind: 'idle' },
  );
  const [deleteState, remove, deleting] = useActionState<WorkflowFormState, FormData>(
    deleteSecretAction,
    { kind: 'idle' },
  );
  const deleted = deleteState.kind === 'done';
  return (
    <li>
      <div>
        <span className={styles.secretName}>{secret.name}</span>
        <br />
        <span className={styles.secretMeta}>
          {deleted
            ? 'Deleted'
            : `Updated ${timeAgo(secret.updatedAt, props.nowMs)} by @${secret.updatedBy}`}
          {secret.availableToPreland ? ' · available to pre-land checks' : ''}
        </span>
      </div>
      {deleted ? null : (
        <div className={styles.secretTools}>
          {props.canToggle ? (
            <form action={toggle}>
              <AccessFields access={access} />
              <input type="hidden" name="mode" value="toggle" />
              <input type="hidden" name="secret" value={secret.name} />
              <input
                type="hidden"
                name="preland"
                value={secret.availableToPreland ? 'false' : 'true'}
              />
              <button
                type="submit"
                className={styles.iconButton}
                disabled={toggling}
                aria-pressed={secret.availableToPreland}
                title={
                  secret.availableToPreland
                    ? 'Stop giving this secret to pre-land checks'
                    : 'Give this secret to pre-land checks (unreviewed code can read it)'
                }
              >
                Pre-land: {secret.availableToPreland ? 'on' : 'off'}
              </button>
            </form>
          ) : null}
          <form action={remove}>
            <AccessFields access={access} />
            <input type="hidden" name="secret" value={secret.name} />
            <button
              type="submit"
              className={styles.danger}
              disabled={deleting}
              aria-label={`Delete ${secret.name}`}
            >
              Delete
            </button>
          </form>
          <FormMessage state={toggleState.kind === 'refused' ? toggleState : deleteState} />
        </div>
      )}
    </li>
  );
}

function FormMessage({ state }: { readonly state: WorkflowFormState }) {
  if (state.kind === 'idle') return null;
  return (
    <span className={state.kind === 'refused' ? styles.alert : styles.status} role="status">
      {state.message}
    </span>
  );
}

function meterLevel(share: number): 'ok' | 'high' | 'over' {
  if (share >= 1) return 'over';
  return share >= 0.8 ? 'high' : 'ok';
}

function monthName(month: string): string {
  const date = new Date(`${month}-01T00:00:00Z`);
  return Number.isNaN(date.getTime())
    ? month
    : date.toLocaleString('en', { month: 'long', year: 'numeric', timeZone: 'UTC' });
}
