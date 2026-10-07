/** What each role may do, in a person's words: one vocabulary for invitations, settings, people. */
export const ROLE_SUMMARY = {
  read: 'Clone, fetch and view.',
  write: 'Also push beans.',
  maintain: 'Also answer decision cards and manage deploy tokens.',
  owner: 'Everything, including settings and deletion.',
} as const;

export const COLLABORATOR_ROLES = ['read', 'write', 'maintain'] as const;
