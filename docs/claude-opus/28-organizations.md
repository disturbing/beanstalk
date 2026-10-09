# 28 · Organizations, members and invitations

Built 2026-10-08/09 on a worktree branch from `prototype` at `b3f6bdf` (lane O of three; lanes S and C build on the contract in §2). Backlog `16` Phase 3.1, without teams and email invitations. Collaborators (`22`) stay as they were; an org adds one more fact to the same access rule.

## 1. What a person sees

| Where | What |
|---|---|
| `@handle` menu (header) | Your repositories, each org you belong to, **New organization**, Account settings. A `<details>` menu: no script needed. |
| `/orgs/new` | Handle, name, description. The creator becomes the owner. A handle a person holds (or a reserved one) is refused. |
| `/<org>` | The org's mark (icon, or the handle's first letters), name, handle, description; the repositories the viewer may read; **People** grouped by role (members only); **New repository** (when the viewer may create there) and **Settings**. |
| `/orgs/<org>/settings` | Owners and admins: **General** (name, description; icon upload shown disabled until the uploads API lands), **Members & invitations** (invite by handle with a role; email invitations shown disabled; change role; remove; cancel an invitation), **Repository defaults** (base permission **none (default)** / read / write, who creates repositories, default visibility public or private), **Audit log**. Everyone in the org: **Leave**. Owners: **Delete this organization** (only once it owns no repositories; type the handle). People outside the org get the 404 page. |
| Home | **An organization invited you** (Accept opens the org, Decline removes it), above repository invitations; **Your organizations** once you belong to one. Org repositories you read appear in Recent activity. |
| New repository | An owner picker: you, or each org whose setting lets your role create there; `/new?owner=<org>` preselects it, and the org's default visibility. Visibility is public, private or (for an org only) **internal**; switching the owner to yourself turns internal into private. |
| Repository Settings | **Visibility**: public, private, and internal for an org's repository. **Transfer**: to yourself or to an org where you are an owner or admin. History, beans, collaborators and deploy tokens move with it; the old address keeps working (§6.3). An internal repository moved to a person becomes private, and the form says so. |

Roles (`ORG_ROLES`): **Owner** (everything, other owners and deletion included; at least one always), **Admin** (settings, secrets, members other than owners, every repository as its owner), **Member** (the base permission on every repository, none by default; creates repositories unless the org says admins only), **Viewer** (the base permission capped at read; never creates). Every role reads the org's internal repositories (§6.2).

Screenshots: `exp/orgs/` (night, `-day`, `-phone`); the staging transcript is `exp/orgs/walk-transcript.txt`.

## 2. The shared contract (for lanes S and C)

`packages/shared-identity/src/orgs.ts`, committed first (`426ccd2`):

```ts
type Org = { id: OrgId; handle; name; description; iconKey: string | null;
             basePermission: 'none' | 'read' | 'write'; repoCreation: 'members' | 'admins';
             defaultVisibility: 'public' | 'private'; createdAt: number };
DEFAULT_BASE_PERMISSION = 'none'                                            // new orgs (§6.1)
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

`mayUseEngine` (`gateway/src/auth/git-credential.ts`) is still the only place repository access is decided. `RepositoryAccess` gains `org: OrgStanding | null` (the asking person's role in the owning org and its base permission; null for a person's repository or someone outside the org), gathered by `accessFacts` (`repos/access.ts`) in parallel with the collaborator role. `roleOf` returns the strongest of: owner of the record, collaborator role, `orgRepositoryRole(org)` and `internalRole(visibility, org)` (read for any member on an internal repository, §6.2):

| Org role | base none | base read | base write |
|---|---|---|---|
| owner, admin | owner | owner | owner |
| member | none | read | write |
| viewer | none | read | read |

Everything after that is unchanged: no role on a private or internal repository is `not-found` (so a private or internal org repository 404s for non-members on every transport), tokens and agent sessions are capped by their scopes and never decide or administer, archived repositories are read-only. Because HTTPS and SSH git, MCP (`agentRepositoryAccess`), the web (registry, collaborators, deploy tokens, run routes) and the Actions RPC all reach `accessFacts` through `d1Collaborators(forge, now, identity)`, the org fact applies everywhere at once. Role and base permission changes take effect on the next request (nothing is cached).

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

## 6. Owner's decisions 2026-10-09: default access, internal, old addresses

> "by default members of an org cannot access other repos unless they are invited, admins of the org can see all other repos. Repos within an org can be set to public, private or internal." And: "moved repo old url must redirect, we dont want to lose old installations".

### 6.1 Default access: base permission none

- New orgs are created with base permission `none` (`DEFAULT_BASE_PERMISSION`, written explicitly by `createOrg`; `0004`'s column default stays `read` because SQLite cannot change a default without rebuilding the table).
- Identity migration `0006_org_base_none.sql` moves every org still on `read` (the old default) to `none`. An org that had chosen `read` on purpose cannot be told apart and moves too; its owners can set it back in Repository defaults. Orgs on `write` are untouched.
- **The setting stays** (GitHub keeps it): none (labelled the default), read, write. Keeping it costs nothing (the table in §3 already has the column) and lets an org that wants every member reading opt in.

The final access table (the strongest of the row and a collaborator role counts; "404" is not-found on every transport):

| Who | private | internal | public |
|---|---|---|---|
| org owner, admin | owner | owner | owner |
| member, base none (default) | 404 | read | read |
| member, base read | read | read | read |
| member, base write | write | write | write |
| viewer, base none | 404 | read | read |
| viewer, base read or write | read | read | read |
| invited collaborator (any org role or none) | their role | their role (at least read if a member) | their role |
| outsider, signed in | 404 | 404 | read |
| anonymous | 404 (HTTPS git: 401, asks for a credential) | 404 / 401 | read |

Reading is clone, fetch, the web pages and the MCP read tools; writing (push beans) needs write; deciding, deploy tokens and Actions need maintain; settings need owner. Tokens and agent sessions are capped by their scopes as before.

### 6.2 Internal visibility

- `RepoVisibility` is `public | private | internal` (`shared-race/repos.ts`). Internal: every member of the owning org, any role (viewer included), reads it: clone, fetch, the web pages, the MCP read tools, the org page's list, Home activity. Writing still needs a collaborator role, base permission write, or admin/owner. Non-members get 404 exactly like private.
- Only an org's repository can be internal: `createRepository` and `updateRepository` refuse it for a person's repository (400, "only an organization's repository can be internal"). **Transferred to a person, an internal repository becomes private** (GitHub does the same); the registry writes a `visibility` activity line and the Transfer form says so beforehand. Transferred to another org it stays internal to that org.
- **Storage** (forge migration `0009_internal_and_redirects.sql`): `0001`'s CHECK allows only `public` and `private`, and changing a CHECK means rebuilding the table, so the migration only adds `repositories.internal INTEGER NOT NULL DEFAULT 0`; an internal repository is stored as `visibility = 'private', internal = 1`. A gateway from before the migration reads it as private: it fails closed.
- Everywhere visibility is checked goes through `mayUseEngine` (HTTPS and SSH git, the web, MCP, the Actions RPC, `listRepositories` for the org page and people's pages), so internal applies on all of them at once. There is no repository search yet.
- **Actions**: an org secret or variable with the policy "private repositories" reaches internal ones too, as on GitHub (`entry-policy.ts`; the picker now says "Private and internal repositories"). Event payloads carry `repository.private: true` and `repository.visibility: "internal"`, and the OIDC claim `repository_visibility` is `internal`.
- Org default visibility stays public or private (`orgs.default_visibility` has the same CHECK); choose internal per repository.

### 6.3 Old addresses: transfers and renames redirect

A rename or a transfer leaves a row in `repository_redirects` (forge `0009`): old owner handle + old name → repository id, with the old owner's id. `Registry.resolve(owner, name)` is the one lookup by address: the current name, else a redirect, else (when `owner` is a retired handle, `29` §3) the same two under the person's new handle. `getRepository` (the web), `agentRepositoryAccess` and the MCP tools (`openRepository`), and the git proxy (HTTPS and SSH) all use it.

- **Chains** (A → B → C) land on the current name: every row points at the id, not at the next name.
- **A new repository at an old address takes it over**: creating, renaming or transferring a repository to exactly that owner and name drops the redirect in the same batch (GitHub does this too). Renaming back to an old name drops that row and adds one for the name it left.
- **Deleting** a repository deletes its redirects.
- **Handle changes compose**: `renameOwner` moves the person's redirect rows to the new handle, and `resolve` follows a retired handle, so an old handle plus an old name, the new handle plus an old name, and the old handle plus the new name all land.
- **Access is unchanged**: a redirect resolves to the record and `mayUseEngine` decides as usual; an outsider gets 404 at the old address of a private repository, the same as for a missing one.
- **New engines are keyed by the repository, not the address** (`registryEngineId(artifactsRepo)`): engines used to be derived from `<owner>/<repo>`, so a new repository at an address another one had left (renamed, moved, or deleted) collided with the old engine (`engine … drives another repo`). Existing repositories keep the engine id their record holds. This also fixes "a deleted repository's name cannot be reused" (`20`).

Per transport:

| Transport | At an old address |
|---|---|
| Web pages | 307 to the repository's home at its current address (`repositoryPage`), the same as an old handle (`29` §3) |
| Git HTTPS `info/refs`, `git-upload-pack`, `git-receive-pack` | Served in place, no redirect: git follows a redirect only on its first GET (`http.followRedirects=initial`), never on a POST, so a push to an old remote would fail; serving in place keeps every existing clone fetching and pushing. A push to an old address adds two `remote:` lines: where the repository is now and the `git remote set-url` to use. (An old *handle* still answers `info/refs` with a 301 first, as before; the redirected base then resolves here.) |
| SSH (`git@host:old-owner/repo.git`) | Served in place (the SSH server forwards to the same git proxy) |
| MCP tools taking `owner/name` | Resolved; answers name the current `owner/name` |
| Org handle rename | **Not built** (next): orgs have no handle change yet. It needs a retired-handle table for orgs (`retired_handles.user_id` references people), `renameOwner` for an org id, and the UI; the redirect table here already composes with it. |

### 6.4 Verified

- **gateway** `test/orgs.test.ts`: the matrix now covers org role (owner, admin, member, viewer, member + write collaborator, viewer + maintain collaborator, outsider, anonymous) × base permission (none, read, write) × visibility (public, private, internal) × transport (HTTPS git read/write, SSH read/write, MCP read/write, web read/administer, and `list`: the org page's repository list), **603 cases**; flows: base none for a new org (member 404), read, write, demotion and removal; activity empty on none, an internal repository in it; internal refused for a person's repository on create and on change; internal readable, cloneable and listed for a viewer, push 403 for a member, 404 for an outsider, absent from an outsider's and an anonymous list, `private → internal` in the audit.
- **gateway** `test/redirects.test.ts` (8): rename then registry, clone (`info/refs`, `git-upload-pack` POST) and push at the old name (with the moved notice); a chain A → B → C, a new repository at A taking it over, renaming back, deletion forgetting the redirects; an outsider's 404 at a private repository's old name; a transfer to an org answering at the old owner over HTTPS, SSH, MCP and a push, then back to the person with both old addresses landing; internal → private on transfer to a person with its activity line; an old handle + old name, new handle + old name, old handle + new name after a rename and a handle change, and a push at the oldest; a deleted repository's name reused.
- **shared-identity** `test/orgs.test.ts`: a new org's standing is base none; migration `0006` moves read to none and leaves write and none.
- **web**: the create form reads internal; `isOldAddress` (case ignored, `.git` ignored).

## 7. Open

- **Migration numbers.** Identity `0004_orgs.sql` and forge `0006_org_owners.sql`; lanes S and C may add migrations with the same numbers. Whoever integrates renumbers; the files only add tables, triggers and one defaulted column.
- **Live rollout order:** apply identity `0004` and forge `0006` (`wrangler d1 migrations apply beanstalk-identity --remote` from `packages/web`, `beanstalk-forge --remote` from `packages/gateway`), then deploy the gateway, then web and MCP. Existing repositories read as people's (`owner_kind` defaults to `user`). An older gateway behind the new web shows no transfer (the client reads it as unavailable) and ignores the owner picker's org.
- **Icon serving path** (§2) is an assumption until lane S publishes its route.
- **Email invitations** wait for the sender domain (`19` §6); the field is shown disabled.
- **Teams** (backlog 3.1) would be one more fact in `RepositoryAccess`, like `org`.
- **Renaming an org's handle** is not offered yet (§6.3 says what it needs); transfers and repository renames now leave a redirect (§6.3).
- **Viewer** is "base permission, at most read": with base none a viewer sees the repositories they are invited to plus the internal and public ones, the same as a member. If Coop wants viewers to read every repository regardless (auditors), it is one line in `orgRepositoryRole`.
- **Migration numbers** of §6: identity `0006_org_base_none.sql`, forge `0009_internal_and_redirects.sql`; a parallel lane adding the same numbers renumbers on merge. Apply both before deploying the gateway; the web and MCP need no migration.
- **Home** lists org repositories through the org (Your organizations) and Recent activity, not in Your repositories.
