# 28 · Organizations, members and invitations

Built 2026-10-08/09 on a worktree branch from `prototype` at `b3f6bdf` (lane O of three; lanes S and C build on the contract in §2). Backlog `16` Phase 3.1, without teams and email invitations. Collaborators (`22`) stay as they were; an org adds one more fact to the same access rule.

## 1. What a person sees

| Where | What |
|---|---|
| `@handle` menu (header) | Your repositories, each org you belong to, **New organization**, Account settings. A `<details>` menu: no script needed. |
| `/orgs/new` | Handle, name, description. The creator becomes the owner. A handle a person holds (or a reserved one) is refused. |
| `/<org>` | The org's mark (icon, or the handle's first letters), name, handle, description; the repositories the viewer may read; **People** grouped by role (members only); **New repository** (when the viewer may create there) and **Settings**. |
| `/orgs/<org>/settings` | Owners and admins: **General** (name, description; icon upload shown disabled until the uploads API lands), **Members & invitations** (invite by handle with a role; email invitations shown disabled; change role; remove; cancel an invitation), **Repository defaults** (base permission none / read / write, who creates repositories, default visibility), **Audit log**. Everyone in the org: **Leave**. Owners: **Delete this organization** (only once it owns no repositories; type the handle). People outside the org get the 404 page. |
| Home | **An organization invited you** (Accept opens the org, Decline removes it), above repository invitations; **Your organizations** once you belong to one. Org repositories you read appear in Recent activity. |
| New repository | An owner picker: you, or each org whose setting lets your role create there; `/new?owner=<org>` preselects it, and the org's default visibility. |
| Repository Settings | **Transfer**: to yourself or to an org where you are an owner or admin. History, beans, collaborators and deploy tokens move with it; the old URL stops resolving. |

Roles (`ORG_ROLES`): **Owner** (everything, other owners and deletion included; at least one always), **Admin** (settings, secrets, members other than owners, every repository as its owner), **Member** (the base permission on every repository; creates repositories unless the org says admins only), **Viewer** (the base permission capped at read; never creates).

Screenshots: `exp/orgs/` (night, `-day`, `-phone`); the staging transcript is `exp/orgs/walk-transcript.txt`.

## 2. The shared contract (for lanes S and C)

`packages/shared-identity/src/orgs.ts`, committed first (`426ccd2`):

```ts
type Org = { id: OrgId; handle; name; description; iconKey: string | null;
             basePermission: 'none' | 'read' | 'write'; repoCreation: 'members' | 'admins';
             defaultVisibility: 'public' | 'private'; createdAt: number };
orgRole(env: IdentityEnv, orgId, userId): Promise<'owner' | 'admin' | 'member' | 'viewer' | null>
orgStanding(env, orgId, userId): Promise<{ role, basePermission } | null>   // one read, for access
ownerOf(repo): { kind: 'user' | 'org'; id; handle }                         // from a RepositoryRecord
mayInOrg(role, capability): boolean
mayCreateRepository(role, repoCreation): boolean
findOrgByHandle / findOrgById / ownerByHandle / orgsOf
```

Capabilities (`mayInOrg`), the one table both other lanes should ask:

| Capability | Owner | Admin | Member | Viewer |
|---|---|---|---|---|
| `settings` (name, description, icon, repository defaults) | yes | yes | | |
| `secrets` (org Actions secrets and variables) | yes | yes | | |
| `members` (invite, cancel, roles, remove; not owners) | yes | yes | | |
| `owners` (grant, take or remove the owner role) | yes | | | |
| `delete` | yes | | | |
| `audit`, `transfer-in` | yes | yes | | |
| `see-members` | yes | yes | yes | yes |

Icons: orgs store only `iconKey` (`updateOrg(env, actor, orgId, { iconKey }, now)`); `packages/web/src/orgs/org-icon.ts` turns a key into `/api/uploads/<key>`. That path is my guess at lane S's serving route and lives in that one function.

Changing orgs: `org-admin.ts` (`createOrg`, `updateOrg`, `deleteOrg`, `requireCapability`) and `org-members.ts` (`inviteToOrg`, `orgInvitationsFor`, `pendingOrgInvitations`, `answerOrgInvitation`, `cancelOrgInvitation`, `setOrgMemberRole`, `removeOrgMember`, `orgMembers`); results are `{ ok, value } | { ok: false, error: { code, message } }` with codes `invalid`, `handle_taken`, `not_found`, `forbidden`, `last_owner`, `unknown_handle`, `already_member`. `org-audit.ts` writes and lists the org's log.

## 3. One rule

`mayUseEngine` (`gateway/src/auth/git-credential.ts`) is still the only place repository access is decided. `RepositoryAccess` gains `org: OrgStanding | null` (the asking person's role in the owning org and its base permission; null for a person's repository or someone outside the org), gathered by `accessFacts` (`repos/access.ts`) in parallel with the collaborator role. `roleOf` returns the strongest of: owner of the record, collaborator role, and `orgRepositoryRole(org)`:

| Org role | base none | base read | base write |
|---|---|---|---|
| owner, admin | owner | owner | owner |
| member | none | read | write |
| viewer | none | read | read |

Everything after that is unchanged: no role on a private repository is `not-found` (so a private org repository 404s for non-members on every transport), tokens and agent sessions are capped by their scopes and never decide or administer, archived repositories are read-only. Because HTTPS and SSH git, MCP (`agentRepositoryAccess`), the web (registry, collaborators, deploy tokens, run routes) and the Actions RPC all reach `accessFacts` through `d1Collaborators(forge, now, identity)`, the org fact applies everywhere at once. Role and base permission changes take effect on the next request (nothing is cached).

Creating under an org (`createRepository`'s input takes `owner: <org handle>`): the org must exist and the creator's role must pass `mayCreateRepository`; outsiders get 404, a viewer or a member of an admins-only org 403. `transferRepository(actorId, repoId, toHandle)`: the actor must administer the repository; the target is themself or an org where `mayInOrg(role, 'transfer-in')`; a name clash is `name_taken`. Audit lines go to the repository's log (`repository.transfer`) and to each org's (`repository.transfer_in`, `_out`, `repository.create`).

## 4. Data

- **Identity D1** (`shared-identity/migrations/0004_orgs.sql`): `orgs` (handle unique, case-insensitive; base permission, repository creation, default visibility, `icon_key`), `org_members`, `org_invitations` (one per person and org, 14 days, a new one replaces the old), `org_audit` (kept after deletion). Two triggers make the handle namespace atomic: inserting an org whose handle a person holds, or a person whose handle an org holds, fails with a unique-constraint error, which sign-up already reports as "taken". `isHandleTaken` checks both tables.
- **Forge D1** (`gateway/migrations/0006_org_owners.sql`): `repositories.owner_kind` (`user` default, `org`). For an org's repository `owner_id` is the org's id (`org_…`) and `owner_handle` its handle; the per-owner name uniqueness index works unchanged.
- The last owner is kept inside the write: the role change and removal statements only match when another owner exists, so two owners leaving at once cannot both succeed.

## 5. Verified

- **shared-identity** `test/orgs.test.ts` (11): the namespace both ways and in any case, reserved and malformed handles, roles and standing, the capability table, invitations (only the invitee answers, decline, cancel, unknown handle, already a member, expiry after two weeks), admins may not invite owners, members invite nobody, outsiders get not found, the last owner can neither leave nor be demoted until another owner exists, admins remove members, members leave, settings by admins with the audit detail, deletion by owners only and the handle freed.
- **gateway** `test/orgs.test.ts` (360): the **matrix**, org role (owner, admin, member, viewer, member + write collaborator, viewer + maintain collaborator, outsider, anonymous) × base permission (none, read, write) × visibility × transport (HTTPS git read/write, SSH via `sshGit` read/write, MCP read/write, web read/administer), **354 cases** from one expectation table; plus flows: members create when allowed, viewers never, outsiders 404, admins-only refuses members; base permission change, demotion to viewer and removal on the next git request; the org's list for a non-member; org repositories in a member's activity and gone with base none; transfer to an org and back with git following the new name and the audit on both sides; refusals (org not administered, another person, unknown handle, taken name). The existing collaborators matrix (128) and the rest of the gateway suite pass unchanged.
- **web** `src/orgs/orgs.test.ts`: the owner picker's field, its echo on errors, the icon path.
- **Staging** (`beanstalk-{gateway,web,mcp}-staging-org` on the devaccounts workers.dev subdomain; D1 `beanstalk-forge-staging-org` with 0001 to 0006 and `beanstalk-identity-staging-org` with 0001 to 0004; KV `beanstalk-oauth-staging-org`; queue `beanstalk-repo-events-staging-org`; Artifacts `beanstalk-race-staging-org` / `beanstalk-repos-staging-org`; R2 `beanstalk-actions-logs-staging-org`; no runner container and Actions on the stub executor, so pushes were not landed, only git's ref advertisements checked), headless Chrome with a CDP virtual authenticator per person, **29 of 29**: three passkey sign-ups with personal tokens; New organization; a person's handle refused for an org; invitations by handle as member and viewer; accept on Home (ben), decline on Home (cal); a private repository from the owner picker; git as member with base read (fetch 200, push 403), declined outsider 404, anonymous 401; the outsider's 404 page; re-invite and accept; base write (member push 200, viewer push 403, viewer fetch 200); base none (member and viewer 404, owner push 200); member promoted to admin (push 200); a personal repository transferred into the org (admin push 200 at the new name); the last owner's Leave refused with the sentence; phone width with no sideways scroll on the org page, its settings and New repository; an admin sees the audit log; a viewer sees only Leave on Settings. Accounts `ada-mbqh`, `ben-mbqh`, `cal-mbqh` and org `acme-mbqh` are left on staging (and an earlier `-r70w` set whose one failing check was the script's own 404 wording). The stack is left up for review; tear it down with `wrangler delete` on the three Workers and `wrangler d1|kv|queues|r2 … delete` on the resources above.

**Live** since 2026-10-09 (migrations identity `0004`, forge `0006`; gateway `939da9ee`, web `25652551`, MCP `92547d7c`). Smoke test on the hosted service: create an org, invite, accept, the base-permission matrix over git (member read/write/none, an outsider and the not-yet-accepted invitee 404), org icon; transcript and screenshots in `exp/live-orgs-settings/`. The staging stack above has been torn down.

## 6. Open

- **Migration numbers.** Identity `0004_orgs.sql` and forge `0006_org_owners.sql`; lanes S and C may add migrations with the same numbers. Whoever integrates renumbers; the files only add tables, triggers and one defaulted column.
- **Live rollout order:** apply identity `0004` and forge `0006` (`wrangler d1 migrations apply beanstalk-identity --remote` from `packages/web`, `beanstalk-forge --remote` from `packages/gateway`), then deploy the gateway, then web and MCP. Existing repositories read as people's (`owner_kind` defaults to `user`). An older gateway behind the new web shows no transfer (the client reads it as unavailable) and ignores the owner picker's org.
- **Icon serving path** (§2) is an assumption until lane S publishes its route.
- **Email invitations** wait for the sender domain (`19` §6); the field is shown disabled.
- **Teams** (backlog 3.1) would be one more fact in `RepositoryAccess`, like `org`.
- **Renaming an org's handle** is not offered (it is in every clone URL); transfers do not leave a redirect at the old URL.
- **Viewer** is "base permission, at most read": with base none a viewer sees only repositories they are invited to, the same as a member. If Coop wants viewers to read every repository regardless (auditors), it is one line in `orgRepositoryRole`.
- **Home** lists org repositories through the org (Your organizations) and Recent activity, not in Your repositories.
