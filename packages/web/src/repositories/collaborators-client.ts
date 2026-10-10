/**
 * Collaborators through the GATEWAY binding (`CollaboratorsRpc`), every answer validated. A
 * binding without the methods (an older gateway) reads as "unavailable", and for engine access
 * as "no repository", so race pages keep working against it.
 */
import { z } from 'zod';

import type {
  CollaboratorsRpc,
  InviteInput,
  RepoRole,
  RepositoryAction,
} from '@gitstalk/shared-race/collaborators';
import type { RepoOwner, Viewer } from '@gitstalk/shared-race/repos';
import type { RpcResult } from '@gitstalk/shared-race/rpc';

import type { Outcome } from './registry-client';
import { RepositoryForViewer, ViewerRole } from './registry-client';

const Role = z.enum(['read', 'write', 'maintain']);

export const Collaborator = z.object({
  user_id: z.string(),
  handle: z.string(),
  role: ViewerRole,
  since: z.string(),
});
export type Collaborator = z.infer<typeof Collaborator>;

export const Invitation = z.object({
  id: z.string(),
  repo_id: z.string(),
  owner_handle: z.string(),
  repo_name: z.string(),
  invitee_id: z.string(),
  invitee_handle: z.string(),
  role: Role,
  invited_by_handle: z.string(),
  created_at: z.string(),
  expires_at: z.string(),
});
export type Invitation = z.infer<typeof Invitation>;

export const RepositorySession = z.object({
  handle: z.string(),
  via: z.enum(['personal-token', 'agent-session', 'ssh-key', 'deploy-token', 'mcp']),
  label: z.string(),
  last_read_at: z.string().nullable(),
  last_push_at: z.string().nullable(),
  pushes: z.number(),
});
export type RepositorySession = z.infer<typeof RepositorySession>;

export const AuditEvent = z.object({
  at: z.string(),
  actor_handle: z.string(),
  action: z.string(),
  target_handle: z.string().nullable(),
  detail: z.string(),
});
export type AuditEvent = z.infer<typeof AuditEvent>;

export const RepositoryPeople = z.object({
  viewer_role: ViewerRole,
  collaborators: z.array(Collaborator),
  invitations: z.array(Invitation),
  sessions: z.array(RepositorySession),
  audit: z.array(AuditEvent),
});
export type RepositoryPeople = z.infer<typeof RepositoryPeople>;

export type CollaboratorsClient = {
  people(repoId: string, viewer: Viewer): Promise<Outcome<RepositoryPeople>>;
  invite(actor: RepoOwner, repoId: string, input: InviteInput): Promise<Outcome<Invitation>>;
  cancel(actor: RepoOwner, repoId: string, invitationId: string): Promise<Outcome<unknown>>;
  setRole(
    actor: RepoOwner,
    repoId: string,
    userId: string,
    role: RepoRole,
  ): Promise<Outcome<Collaborator>>;
  remove(actor: RepoOwner, repoId: string, userId: string): Promise<Outcome<unknown>>;
  invitations(userId: string): Promise<Outcome<readonly Invitation[]>>;
  answer(
    user: RepoOwner,
    invitationId: string,
    answer: 'accept' | 'decline',
  ): Promise<Outcome<{ readonly owner_handle: string; readonly repo_name: string }>>;
  shared(userId: string): Promise<Outcome<readonly RepositoryForViewer[]>>;
  /** Null repository: the engine is a race (no repository); refusals come back as failures. */
  engineAccess(
    engineId: string,
    viewer: Viewer,
    action: RepositoryAction,
  ): Promise<Outcome<{ readonly repository: RepositoryForViewer | null }>>;
};

const METHODS = [
  'repositoryPeople',
  'inviteCollaborator',
  'cancelInvitation',
  'setCollaboratorRole',
  'removeCollaborator',
  'myInvitations',
  'answerInvitation',
  'sharedRepositories',
  'engineAccess',
] as const satisfies readonly (keyof CollaboratorsRpc)[];

export function collaboratorsClient(binding: object): CollaboratorsClient {
  const rpc = isCollaboratorsRpc(binding) ? binding : null;
  const call = async <S extends z.ZodType>(
    schema: S,
    use: (collaborators: CollaboratorsRpc) => Promise<RpcResult<unknown>>,
  ): Promise<Outcome<z.infer<S>>> => {
    if (rpc === null)
      return {
        ok: false,
        error: {
          code: 'unavailable',
          message: 'Collaborators are not available on this deployment.',
        },
      };
    const result = await use(rpc);
    if (!result.ok)
      return { ok: false, error: { code: result.error.code, message: result.error.message } };
    return { ok: true, value: schema.parse(result.value) };
  };
  return {
    people: (repoId, viewer) => call(RepositoryPeople, (r) => r.repositoryPeople(repoId, viewer)),
    invite: (actor, repoId, input) =>
      call(Invitation, (r) => r.inviteCollaborator(actor, repoId, input)),
    cancel: (actor, repoId, id) => call(z.unknown(), (r) => r.cancelInvitation(actor, repoId, id)),
    setRole: (actor, repoId, userId, role) =>
      call(Collaborator, (r) => r.setCollaboratorRole(actor, repoId, userId, role)),
    remove: (actor, repoId, userId) =>
      call(z.unknown(), (r) => r.removeCollaborator(actor, repoId, userId)),
    invitations: (userId) => call(z.array(Invitation), (r) => r.myInvitations(userId)),
    answer: (user, id, answer) =>
      call(z.object({ owner_handle: z.string(), repo_name: z.string() }), (r) =>
        r.answerInvitation(user, id, answer),
      ),
    shared: (userId) => call(z.array(RepositoryForViewer), (r) => r.sharedRepositories(userId)),
    async engineAccess(engineId, viewer, action) {
      if (rpc === null) return { ok: true, value: { repository: null } };
      return call(z.object({ repository: RepositoryForViewer.nullable() }), (r) =>
        r.engineAccess(engineId, viewer, action),
      );
    },
  };
}

function isCollaboratorsRpc(binding: object): binding is CollaboratorsRpc {
  return METHODS.every((method) => typeof Reflect.get(binding, method) === 'function');
}
