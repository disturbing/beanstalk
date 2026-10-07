'use client';

/**
 * Invitations waiting on Home: who invited you to which repository, with which role, and
 * Accept (opens the repository) or Decline. The gateway checks the invitation is yours.
 */
import { useActionState } from 'react';

import type { Invitation } from '../../src/repositories/collaborators-client';
import type { CollaboratorState } from '../../src/server/collaborator-actions';
import { answerInvitationAction } from '../../src/server/collaborator-actions';
import { ROLE_SUMMARY } from './roles';
import styles from './repository.module.css';

export function Invitations(props: {
  readonly invitations: readonly Invitation[];
  readonly csrf: string;
}) {
  if (props.invitations.length === 0) return null;
  return (
    <section className={`${styles.panel} ${styles.invitations}`} aria-labelledby="invites-title">
      <div className={styles.panelHead}>
        <h2 id="invites-title">
          {props.invitations.length === 1
            ? 'An invitation is waiting'
            : `${props.invitations.length} invitations are waiting`}
        </h2>
      </div>
      <ul className={styles.inviteList}>
        {props.invitations.map((invitation) => (
          <InvitationRow key={invitation.id} invitation={invitation} csrf={props.csrf} />
        ))}
      </ul>
    </section>
  );
}

function InvitationRow(props: { readonly invitation: Invitation; readonly csrf: string }) {
  const [state, action, pending] = useActionState<CollaboratorState, FormData>(
    answerInvitationAction,
    { kind: 'idle' },
  );
  const { invitation } = props;
  const fullName = `${invitation.owner_handle}/${invitation.repo_name}`;
  return (
    <li>
      <div>
        <b>@{invitation.invited_by_handle}</b> invited you to{' '}
        <span className={styles.mono}>{fullName}</span> as <b>{invitation.role}</b>
        <br />
        <span className={styles.muted}>{ROLE_SUMMARY[invitation.role]}</span>
        {state.kind === 'refused' ? (
          <p className={styles.error} role="alert">
            {state.message}
          </p>
        ) : null}
        {state.kind === 'done' ? (
          <p className={styles.muted} role="status">
            {state.message}
          </p>
        ) : null}
      </div>
      {state.kind === 'done' ? null : (
        <form action={action} className={styles.inviteActions}>
          <input type="hidden" name="csrf" value={props.csrf} />
          <input type="hidden" name="invitation" value={invitation.id} />
          <button
            type="submit"
            name="answer"
            value="accept"
            className={styles.primary}
            disabled={pending}
          >
            Accept
          </button>
          <button
            type="submit"
            name="answer"
            value="decline"
            className={styles.secondary}
            disabled={pending}
          >
            Decline
          </button>
        </form>
      )}
    </li>
  );
}
