'use client';

/**
 * An org's people: Settings → Members & invitations (invite by handle, change a role, remove,
 * cancel an invitation), Leave, and the invitations waiting on the invitee's Home.
 */
import { useActionState } from 'react';

import type { OrgState } from '../../src/server/org-actions';
import {
  answerOrgInvitationAction,
  cancelOrgInvitationAction,
  inviteOrgMemberAction,
  removeOrgMemberAction,
  setOrgRoleAction,
} from '../../src/server/org-actions';
import repo from '../repository/repository.module.css';
import { Status } from './org-forms';
import { OrgMark } from './org-mark';

const IDLE: OrgState = { kind: 'idle' };
const DATE = new Intl.DateTimeFormat('en', { dateStyle: 'medium', timeZone: 'UTC' });

type OrgRole = 'owner' | 'admin' | 'member' | 'viewer';
const ROLES: readonly OrgRole[] = ['owner', 'admin', 'member', 'viewer'];

export const ORG_ROLE_SUMMARY: Readonly<Record<OrgRole, string>> = {
  owner: 'Everything, including owners and deleting the organization.',
  admin: 'Settings, secrets, members and every repository.',
  member: 'The base permission on every repository; creates repositories if allowed.',
  viewer: 'At most read on every repository.',
};

export type MemberView = {
  readonly userId: string;
  readonly handle: string;
  readonly role: OrgRole;
  readonly since: number;
};

export type InvitationView = {
  readonly id: string;
  readonly orgId: string;
  readonly orgHandle: string;
  readonly orgName: string;
  readonly inviteeHandle: string;
  readonly role: OrgRole;
  readonly invitedByHandle: string;
  readonly expiresAt: number;
};

type Access = {
  readonly orgId: string;
  readonly csrf: string;
  readonly path: string;
  /** Owners grant and take the owner role; admins manage everyone else. */
  readonly viewerRole: OrgRole;
};

export function OrgMembersSettings(props: {
  readonly orgHandle: string;
  readonly members: readonly MemberView[];
  readonly invitations: readonly InvitationView[];
  readonly viewerId: string;
  readonly access: Access;
}) {
  const [state, invite, pending] = useActionState(inviteOrgMemberAction, IDLE);
  const grantable = props.access.viewerRole === 'owner' ? ROLES : ROLES.slice(1);
  return (
    <section
      className={`${repo.panel} ${repo.settingsSection}`}
      aria-labelledby="org-members-title"
      id="members"
    >
      <h2 id="org-members-title">Members &amp; invitations</h2>
      <p className={repo.sub}>
        {ROLES.map((role) => (
          <span key={role}>
            <b>{role}</b>: {ORG_ROLE_SUMMARY[role].toLowerCase()}{' '}
          </span>
        ))}
      </p>
      <form action={invite} className={repo.deployForm}>
        <Hidden access={props.access} />
        <input
          name="handle"
          className={repo.input}
          placeholder="handle"
          aria-label="Invite by handle"
          autoComplete="off"
          spellCheck={false}
          required
        />
        <select name="role" className={repo.input} defaultValue="member" aria-label="Role">
          {grantable.map((role) => (
            <option key={role} value={role}>
              {role}
            </option>
          ))}
        </select>
        <button type="submit" className={repo.primary} disabled={pending}>
          {pending ? 'Inviting…' : 'Invite'}
        </button>
      </form>
      <div className={repo.deployForm}>
        <input
          className={repo.input}
          placeholder="name@example.com"
          aria-label="Invite by email"
          disabled
        />
        <button type="button" className={repo.secondary} disabled>
          Invite by email
        </button>
      </div>
      <p className={repo.hint}>Email invitations arrive once Beanstalk sends mail.</p>
      <Status state={state} />
      <ul className={repo.deployList} aria-label="Members">
        {props.members.map((member) => (
          <MemberRow
            key={member.userId}
            member={member}
            isYou={member.userId === props.viewerId}
            grantable={grantable}
            access={props.access}
          />
        ))}
        {props.invitations.map((invitation) => (
          <InvitationRow key={invitation.id} invitation={invitation} access={props.access} />
        ))}
      </ul>
    </section>
  );
}

function MemberRow(props: {
  readonly member: MemberView;
  readonly isYou: boolean;
  readonly grantable: readonly OrgRole[];
  readonly access: Access;
}) {
  const [roleState, changeRole, changing] = useActionState(setOrgRoleAction, IDLE);
  const [removeState, remove, removing] = useActionState(removeOrgMemberAction, IDLE);
  const { member } = props;
  const mayManage = props.access.viewerRole === 'owner' || member.role !== 'owner';
  if (removeState.kind === 'done') return null;
  return (
    <li>
      <div>
        <b>@{member.handle}</b> <span className={repo.pill}>{member.role}</span>{' '}
        <span className={repo.muted}>
          {props.isYou ? 'you · ' : ''}since {DATE.format(new Date(member.since))}
        </span>
        <Status state={roleState.kind === 'idle' ? removeState : roleState} />
      </div>
      {mayManage && !props.isYou ? (
        <div className={repo.inviteActions}>
          <form action={changeRole} className={repo.inviteActions}>
            <Hidden access={props.access} />
            <input type="hidden" name="user" value={member.userId} />
            <select
              name="role"
              className={repo.input}
              defaultValue={member.role}
              aria-label={`Role of @${member.handle}`}
            >
              {props.grantable.map((role) => (
                <option key={role} value={role}>
                  {role}
                </option>
              ))}
            </select>
            <button type="submit" className={repo.secondary} disabled={changing}>
              Change role
            </button>
          </form>
          <form action={remove}>
            <Hidden access={props.access} />
            <input type="hidden" name="user" value={member.userId} />
            <button type="submit" className={repo.danger} disabled={removing}>
              Remove
            </button>
          </form>
        </div>
      ) : null}
    </li>
  );
}

function InvitationRow(props: { readonly invitation: InvitationView; readonly access: Access }) {
  const [state, cancel, pending] = useActionState(cancelOrgInvitationAction, IDLE);
  const { invitation } = props;
  if (state.kind === 'done') return null;
  return (
    <li>
      <div>
        <b>@{invitation.inviteeHandle}</b> <span className={repo.pill}>invited</span>{' '}
        <span className={repo.muted}>
          as {invitation.role} · until {DATE.format(new Date(invitation.expiresAt))}
        </span>
        <Status state={state} />
      </div>
      <form action={cancel}>
        <Hidden access={props.access} />
        <input type="hidden" name="invitation" value={invitation.id} />
        <button type="submit" className={repo.secondary} disabled={pending}>
          Cancel invitation
        </button>
      </form>
    </li>
  );
}

/** Leave the org (then Home); the last owner is told to name another owner first. */
export function LeaveOrg(props: {
  readonly orgId: string;
  readonly orgHandle: string;
  readonly userId: string;
  readonly csrf: string;
}) {
  const [state, leave, pending] = useActionState(removeOrgMemberAction, IDLE);
  return (
    <form action={leave} className={repo.inviteActions}>
      <input type="hidden" name="csrf" value={props.csrf} />
      <input type="hidden" name="org" value={props.orgId} />
      <input type="hidden" name="user" value={props.userId} />
      <input type="hidden" name="orgHandle" value={props.orgHandle} />
      <button type="submit" className={repo.danger} disabled={pending}>
        Leave {props.orgHandle}
      </button>
      <Status state={state} />
    </form>
  );
}

/** Org invitations waiting on Home: Accept opens the org, Decline removes it. */
export function OrgInvitations(props: {
  readonly invitations: readonly InvitationView[];
  readonly csrf: string;
}) {
  if (props.invitations.length === 0) return null;
  return (
    <section className={`${repo.panel} ${repo.invitations}`} aria-labelledby="org-invites-title">
      <div className={repo.panelHead}>
        <h2 id="org-invites-title">
          {props.invitations.length === 1
            ? 'An organization invited you'
            : `${props.invitations.length} organizations invited you`}
        </h2>
      </div>
      <ul className={repo.inviteList}>
        {props.invitations.map((invitation) => (
          <HomeInvitation key={invitation.id} invitation={invitation} csrf={props.csrf} />
        ))}
      </ul>
    </section>
  );
}

function HomeInvitation(props: { readonly invitation: InvitationView; readonly csrf: string }) {
  const [state, action, pending] = useActionState(answerOrgInvitationAction, IDLE);
  const { invitation } = props;
  return (
    <li>
      <div>
        <OrgMark handle={invitation.orgHandle} iconKey={null} size={22} />{' '}
        <b>@{invitation.invitedByHandle}</b> invited you to <b>{invitation.orgName}</b>{' '}
        <span className={repo.mono}>({invitation.orgHandle})</span> as <b>{invitation.role}</b>
        <br />
        <span className={repo.muted}>{ORG_ROLE_SUMMARY[invitation.role]}</span>
        <Status state={state} />
      </div>
      {state.kind === 'done' ? null : (
        <form action={action} className={repo.inviteActions}>
          <input type="hidden" name="csrf" value={props.csrf} />
          <input type="hidden" name="invitation" value={invitation.id} />
          <button
            type="submit"
            name="answer"
            value="accept"
            className={repo.primary}
            disabled={pending}
          >
            Accept
          </button>
          <button
            type="submit"
            name="answer"
            value="decline"
            className={repo.secondary}
            disabled={pending}
          >
            Decline
          </button>
        </form>
      )}
    </li>
  );
}

function Hidden({ access }: { readonly access: Access }) {
  return (
    <>
      <input type="hidden" name="csrf" value={access.csrf} />
      <input type="hidden" name="org" value={access.orgId} />
      <input type="hidden" name="path" value={access.path} />
    </>
  );
}
