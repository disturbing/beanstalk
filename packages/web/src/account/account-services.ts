/**
 * The account flows' ports over this Worker's bindings: accounts in IDENTITY_DB, the registry
 * on GATEWAY (`AccountsRpc`), agents on MCP and pictures in MEDIA. Server-only.
 */
import { env } from 'cloudflare:workers';

import { deleteUser } from '@beanstalk/shared-identity/account-deletion';
import type { OwnedOrganization } from '@beanstalk/shared-identity/account-deletion';
import { orgMembers } from '@beanstalk/shared-identity/org-members';
import { orgsOf } from '@beanstalk/shared-identity/orgs';
import {
  changeHandle,
  getProfile,
  revertHandleChange,
  setAvatarKey,
} from '@beanstalk/shared-identity/profiles';
import type { AccountsRpc } from '@beanstalk/shared-race/accounts';
import { isAccountsRpc } from '@beanstalk/shared-race/accounts';
import type { MediaStore } from '@beanstalk/shared-media/images';
import { mediaStore } from '@beanstalk/shared-media/images';

import { agentSessionsRpc } from '../auth/services';
import { registryClient } from '../repositories/registry-client';
import type { DeletionPorts, HandlePorts, PicturePorts } from './account-flows';

/** The R2 picture store, re-encoding through Images when the binding is there. */
export function webMedia(): MediaStore {
  return mediaStore(env);
}

export function handlePorts(): HandlePorts {
  const accounts = accountsRpc();
  return {
    changeHandle: (input) => changeHandle(env, input),
    revertHandleChange: (input) => revertHandleChange(env, input),
    previousChangeAt: async (userId) => (await getProfile(env, userId))?.handleChangedAt ?? null,
    renameOwner: (userId, handle) =>
      accounts === null ? Promise.resolve(UNAVAILABLE) : accounts.renameOwner(userId, handle),
  };
}

export function avatarPorts(actor: {
  readonly id: string;
  readonly ip: string | null;
}): PicturePorts {
  const media = webMedia();
  return {
    upload: (kind, ownerId, file) => media.uploadImage(kind, ownerId, file),
    save: (key) => setAvatarKey(env, { userId: actor.id, key, ip: actor.ip, now: Date.now() }),
    prune: (kind, ownerId, keep) => media.pruneImages(kind, ownerId, keep),
  };
}

export function deletionPorts(): DeletionPorts {
  const accounts = accountsRpc();
  const media = webMedia();
  return {
    facts: async (actor) => {
      const registry = registryClient(env.GATEWAY);
      const [active, archived, organizations] = await Promise.all([
        registry.list(actor.id, actor.id),
        registry.list(actor.id, actor.id, 'archived'),
        ownedOrganizations(actor.id),
      ]);
      const names = [...(active.ok ? active.value : []), ...(archived.ok ? archived.value : [])];
      return { handle: actor.handle, organizations, repositories: names.map((repo) => repo.name) };
    },
    closeAccount: (userId) =>
      accounts === null ? Promise.resolve(UNAVAILABLE) : accounts.closeAccount(userId),
    disconnectAgents: async (userId) => {
      const agents = agentSessionsRpc();
      const sessions = await agents.agentSessions(userId);
      await Promise.all(
        sessions
          .filter((session) => session.settling !== true)
          .map((session) => agents.revokeAgentSession(userId, session.grantId, null)),
      );
    },
    deleteMedia: (kind, ownerId) => media.deleteOwnerMedia(kind, ownerId),
    deleteUser: (actor) => deleteUser(env, { userId: actor.id, ip: actor.ip, now: actor.now }),
  };
}

/**
 * The organisations the person owns (`docs/claude-opus/28-organizations.md`), with how many
 * other owners each has: the deletion guard (`deletionPlan`) blocks the sole owner.
 */
export async function ownedOrganizations(userId: string): Promise<readonly OwnedOrganization[]> {
  const owned = (await orgsOf(env, userId)).filter((membership) => membership.role === 'owner');
  return Promise.all(
    owned.map(async ({ org }) => {
      const members = await orgMembers(env, org.id);
      const otherOwners = members.filter(
        (member) => member.role === 'owner' && member.userId !== userId,
      ).length;
      return { handle: org.handle, otherOwners };
    }),
  );
}

const UNAVAILABLE = {
  ok: false,
  error: { message: 'the repository registry is not reachable from this deployment' },
} as const;

function accountsRpc(): AccountsRpc | null {
  const binding: unknown = env.GATEWAY;
  return isAccountsRpc(binding) ? binding : null;
}
