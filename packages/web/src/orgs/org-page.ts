/**
 * What the org pages read: the org by handle, the viewer's role in it, and for people who may
 * see them its members, pending invitations and audit log. Reads the identity database
 * directly (orgs live there); repositories come from the gateway. Server-only.
 */
import { env } from 'cloudflare:workers';

import type { OrgAuditEvent } from '@beanstalk/shared-identity/org-audit';
import { listOrgAudit } from '@beanstalk/shared-identity/org-audit';
import type { OrgInvitation, OrgMember } from '@beanstalk/shared-identity/org-members';
import { orgMembers, pendingOrgInvitations } from '@beanstalk/shared-identity/org-members';
import type { Org, OrgRole } from '@beanstalk/shared-identity/orgs';
import {
  findOrgByHandle,
  mayCreateRepository,
  mayInOrg,
  orgRole,
  orgsOf,
} from '@beanstalk/shared-identity/orgs';

export type OrgPage = {
  readonly org: Org;
  readonly role: OrgRole | null;
  /** Empty unless the viewer may see members. */
  readonly members: readonly OrgMember[];
  /** Empty unless the viewer manages members. */
  readonly invitations: readonly OrgInvitation[];
  /** Empty unless the viewer reads the audit log. */
  readonly audit: readonly OrgAuditEvent[];
};

export async function orgPage(handle: string, viewerId: string | null): Promise<OrgPage | null> {
  const org = await findOrgByHandle(env, handle);
  if (org === null) return null;
  const role = viewerId === null ? null : await orgRole(env, org.id, viewerId);
  const now = Date.now();
  const [members, invitations, audit] = await Promise.all([
    mayInOrg(role, 'see-members') ? orgMembers(env, org.id) : [],
    mayInOrg(role, 'members') ? pendingOrgInvitations(env, org.id, now) : [],
    mayInOrg(role, 'audit') ? listOrgAudit(env, org.id) : [],
  ]);
  return { org, role, members, invitations, audit };
}

/** A namespace a person may create repositories in: their own, then their orgs. */
export type Namespace = {
  readonly handle: string;
  readonly kind: 'user' | 'org';
  readonly name: string;
  readonly iconKey: string | null;
  readonly defaultVisibility: 'public' | 'private';
};

/** Where `user` may create a repository (New repository's owner picker). */
export async function creatableNamespaces(user: {
  readonly id: string;
  readonly handle: string;
}): Promise<readonly Namespace[]> {
  const memberships = await orgsOf(env, user.id);
  const orgs = memberships
    .filter(({ org, role }) => mayCreateRepository(role, org.repoCreation))
    .map(({ org }) => orgNamespace(org));
  const own: Namespace = {
    handle: user.handle,
    kind: 'user',
    name: user.handle,
    iconKey: null,
    defaultVisibility: 'private',
  };
  return [own, ...orgs];
}

/** Orgs `userId` may move repositories into (owners and admins). */
export async function transferTargets(userId: string): Promise<readonly Org[]> {
  const memberships = await orgsOf(env, userId);
  return memberships.filter(({ role }) => mayInOrg(role, 'transfer-in')).map(({ org }) => org);
}

function orgNamespace(org: Org): Namespace {
  return {
    handle: org.handle,
    kind: 'org',
    name: org.name,
    iconKey: org.iconKey,
    defaultVisibility: org.defaultVisibility,
  };
}
