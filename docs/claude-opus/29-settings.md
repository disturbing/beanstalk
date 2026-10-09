# 27 · Settings, profiles and uploads

Built 2026-10-09 on a worktree branch from `prototype` at `b3f6bdf` (lane S of three: settings; lane O builds organisations, lane C collaborators). People get a profile with a picture, a handle they can change, and a delete button; repositories get a website, topics and a social image; both settings areas share one GitHub-like layout in the Nightshift skin.

## 1. What a person sees

| Where | What |
|---|---|
| `/settings` Public profile | Picture (upload, remove; the generated one otherwise), name, bio (160), website |
| `/settings/account` | Handle change (rules below, earlier handles listed), delete account (what happens, typed confirmation, blocked for the sole owner of an organisation) |
| `/settings/emails` | The verified address, if any; adding one waits for email sending (`19` §6) |
| `/settings/passkeys` | List, rename inline, add another, remove (the last one's Remove is disabled) |
| `/settings/sessions` | Connected agents (Disconnect), signed-in browsers ("this browser", Sign out per browser), sign out here / everywhere |
| `/settings/keys`, `/settings/tokens` | As before (`19` §9), inside the shell |
| `/settings/notifications` | Placeholder: what will be sent, all switches disabled, "nothing is sent today" |
| `/<owner>/<repo>/settings` | The same shell, an anchor nav: General (name, description, website, topics), Social image, Visibility, Branches (stalk fixed, sprout, `bean/*`), Checks, Features (placeholder), Collaborators, Actions, Deploy tokens, Archive, Delete |
| `/<handle>` | The person's page: picture, name, bio, website, then their repositories (public ones for everyone; archived ones only for themselves) |
| Header | The picture beside `@handle` |

Shell: `components/settings/settings-shell.tsx` (`SettingsShell`, `SettingsSection`, `SaveStatus`, `SoonPill`), left nav at 220 px, folded into wrapped chips under 760 px. Text forms are server actions (`src/server/account-actions.ts`, origin + session + CSRF checked by `signedInForm`) with a "Saving… / saved / error" line (`role=status` / `alert`); uploads are plain multipart POSTs to route handlers, so they work without JavaScript.

## 2. Uploads (`@beanstalk/shared-media`)

**Contract** (lane O uses it for organisation icons):

```ts
mediaStore(env).uploadImage(kind: 'user' | 'org' | 'repo', ownerId, file: Blob)
  → { ok: true, image: { key, url, width, height, normalized } } | { ok: false, error: { code, message } }
imageUrl(key, size?)            // '/media/<key>' or '/media/<key>/<width>'
mediaStore(env).pruneImages(kind, ownerId, keepKey | null)   // after the new key is saved
mediaStore(env).deleteOwnerMedia(kind, ownerId)              // account or organisation deletion
serveImage(env, request, path)  // GET /media/<path>
isImageKeyOf(key, kind, ownerId), fallbackAvatar(seed, label)
```

- **Where:** the web Worker, not the gateway. Uploads come from a signed-in browser to the web host with its session cookie, and the pictures are served by the same host (`/media/…`), so a gateway hop would add latency and a second place that checks the session. The gateway stays the git and engine plane; it only stores a repository's social image key (validated as `repos/<that id>/social/<hash>`).
- **Bucket** `beanstalk-media` (binding `MEDIA`). Keys `users/<id>/avatar/<hash>`, `orgs/<id>/icon/<hash>`, `repos/<id>/social/<hash>`; the hash is 128 bits of SHA-256 of the uploaded bytes, so a new picture is a new URL and the same file is the same key.
- **Validation from bytes**, never the file name or the browser's type: PNG, JPEG, WebP (VP8, VP8L, VP8X), GIF; SVG refused by name ("can carry scripts"); 2 MB (checked from `Content-Length` before the form is parsed, then from the file); 16 to 4096 px a side; owner ids `[A-Za-z0-9_-]{1,64}`.
- **Normalised with the Cloudflare Images binding** (`IMAGES`): avatars and icons at 460, 128 and 64 px square, social images at 1280×640 and 640×320, WebP, first frame only (`anim: false`), metadata gone. The object at the key is the largest size, `<key>/<width>` the others. **Verified on workers.dev** (account `devaccounts`): a probe Worker with only the binding transformed a 300×200 PNG to a 64×64 WebP; on staging the three avatar sizes were 2.8 KB, 528 B and 264 B. `cf.image` on `fetch` needs a zone with transformations and was not used.
- **Without the binding** (or when Images refuses, e.g. out of transformations): the original is stored once, with PNG `tEXt/zTXt/iTXt/eXIf/tIME` chunks and JPEG EXIF/XMP/comments removed, the EXIF orientation written back alone so photos stay upright; it is served for every size. Animated GIFs stay animated on that path, and WebP metadata is kept.
- **Serving:** `app/media/[...path]/route.ts`: `cache-control: public, max-age=31536000, immutable`, ETag with 304, `x-content-type-options: nosniff`, `content-security-policy: default-src 'none'; sandbox`, only the four image types; anything that is not an image key or a stored width is a 404 cached a minute. `media` is a reserved handle.
- **Replace and delete:** upload → save the key (profile row or repository record) → prune everything else in that slot; a failed save leaves an orphan that the next prune removes. Removing a picture saves null and prunes the slot. Deleting an account deletes `users/<id>/` and each deleted repository's `repos/<id>/`.
- **Fallback avatars:** `fallbackAvatar(seed, label)` gives initials (people) and a mirrored 5×5 identicon (organisations), the hue from the account id so a handle change keeps the colour; drawn inline as SVG by `components/account/avatar.tsx` (no user text except escaped initials).
- **Private repositories' social images** are served to anyone with the URL; the URL holds a 128-bit content hash, which cannot be guessed without the image.

## 3. Handles

`changeHandle` (`shared-identity/profiles.ts`): the new handle passes `Handle` (format and reserved list), is not anyone's current handle and not someone else's retired one, and the last change was over 24 hours ago. In one D1 batch the old handle goes to `retired_handles` (owned by the person), the person's own retired row for the new handle (taking one back) is removed, the user row changes, and `handle.change` is audited.

- **Retired handles stay the person's**: sign-up refuses them (`isHandleTaken` checks both tables), they redirect `/<old>` and `/<old>/<repo>/…` (page loader, to the repository home) and git's `info/refs` (301 with path and query kept; git follows a redirect on its first request and uses the new base for the rest). They are freed only when the account is deleted. Whether to expire them after N days is open (§7).
- **The registry moves with it:** `AccountsRpc.renameOwner(userId, handle)` on the gateway updates `repositories.owner_handle`, members, sessions and pending invitations in one batch. The web changes accounts first, then the registry; if the registry fails it reverts the handle (and the cooldown) and says nothing changed (`changeHandleFlow`).
- **Agents:** OAuth grants carry the handle of the day; the MCP Worker now reads the person's current handle from `IDENTITY_DB` on every request and answers 401 `invalid_token` when the account is gone.

## 4. Deleting an account

`deletionPlan(facts)` blocks the sole owner of an organisation (named in the message). Otherwise, after the handle is typed: `AccountsRpc.closeAccount` deletes the person's repositories (active and archived: registry, engine, Artifacts) and their memberships and invitations elsewhere; every agent grant is revoked; pictures are deleted; then `deleteUser` removes the user row, whose cascade takes passkeys, sessions, tokens, SSH keys and retired handles (audit rows stay). A registry failure stops before anything else and says so. The organisation facts come from `ownedOrganizations` in `web/src/account/account-services.ts` (lane O's `orgsOf` and `orgMembers`). Deleting an organisation deletes its icon too.

## 5. Data

- Identity D1 migration `0005_profiles.sql`: `users.display_name`, `bio`, `website`, `avatar_key`, `handle_changed_at`; table `retired_handles (handle PK nocase, user_id → users ON DELETE CASCADE, retired_at)`.
- Forge D1 migration `0008_repository_profile.sql`: `repositories.website`, `topics_json`, `social_image_key`. The record carries them as optional fields, so an older gateway reads as empty.
- Web bindings: R2 `MEDIA` (`beanstalk-media`), `IMAGES`. Only additions; apply both migrations before deploying gateway and web.

## 6. Verified

Tests: `shared-media` (31: format sniffing for every type and refusal, metadata stripping with orientation kept, 2 MB edge, 16/4096 px, owner ids, key layout, Images sizes with a fake resizer and the fallback when it refuses, prune on replace, delete one and per owner, `imageUrl` snapping, `serveImage` caching/304/404, fallback avatars), `shared-identity/test/profiles.test.ts` (13: profile validation, avatar replace answers the old key, handle rules, retired handles at sign-up and on change, the cooldown, taking a handle back, revert, passkey rename, browser sessions, deletion guard, confirmation, cascade), `gateway/test/accounts.test.ts` (5: rename moves repositories and memberships, close deletes active and archived and leaves others', profile fields and refusals), web `src/account/account-flows.test.ts` (10: handle change and revert order, picture replace/remove order, deletion order and guards), `src/git/git-host.test.ts` (old-handle git location), `src/repositories/repositories.test.ts` (website and topics from the form).

**Staging, end to end, 42 of 42** (`exp/settings/e2e-results.json`, screenshots `exp/settings/01…17-*.png`, night, day and phone). Stack `beanstalk-{gateway,web,mcp}-staging-set` on the devaccounts workers.dev subdomain, D1 `beanstalk-identity-staging-set` / `beanstalk-forge-staging-set`, KV `beanstalk-oauth-staging-set`, R2 `beanstalk-media-staging-set` (and `beanstalk-actions-logs-staging-set`), queue `beanstalk-repo-events-staging-set`, Artifacts `beanstalk-{race,repos}-staging-set`, the Images binding on, Actions in stub mode; headless Chrome with a CDP virtual authenticator, after merging lane O (organisations):

passkey sign-up; the generated initials; upload → three WebP sizes from R2 (2.8 KB, 528 B, 264 B), `immutable`, 304 on the ETag; an SVG renamed `.png` refused with the reason; a 2.2 MB body refused before parsing; a 1.9 MB upload stored and the previous picture pruned; profile saved (a CRLF bio stored as LF), a `javascript:` website refused; a public repository with website, topics and a social image; the person's page as owner and as a signed-out stranger; the only passkey's Remove disabled, rename, a second passkey from a second authenticator, one removed; the browser list; handle change: header updated, `/<old>` 307 → new, `/<old>/greeter/settings` lands on the new address, git `info/refs` 301, **`git clone` of the old URL works**, the old handle refused at sign-up, a second change the same day blocked; no sideways scroll at 390 px on profile, account and repository settings; an organisation icon uploaded to `orgs/<id>/icon/…` and served, account deletion blocked as its sole owner (named), the organisation deleted with its icon; account deletion refused for a wrong confirmation, then done: the person's page 404, avatar and social image 404 from R2, the old session signed out.

Fixed on the way, found only on staging: vinext treats every multipart POST as a possible progressive server action and refused bodies over 1 MB with 413 before the route ran (`next.config.ts` `experimental.serverActions.bodySizeLimit: '3mb'`); textareas send CRLF, which the bio's control-character check refused; a server action's `redirect` does not re-render the layout, so after a handle change, removing a picture or deleting the account the forms now load the page whole (the header showed the old handle).

**Live** since 2026-10-09: identity `0005`, forge `0008`, R2 `beanstalk-media`, web `25652551` with the Images binding. On the hosted service the avatar came back as WebP at 460/128/64 px (2.8 KB, 816 B, 374 B), the org icon and a repository social image (1280 and 640) as WebP; a handle change redirected `/<old>/<repo>` (307) and `git clone` of the old URL (301); both test accounts were removed with Delete account (`exp/live-orgs-settings/`). One gap found there, since fixed: deleting a repository from Settings left its social image in R2; the delete action now prunes `repos/<id>/` (a delete through the gateway API alone still does not). The staging stack has been torn down.

## 7. Open

- Retired handles never expire (GitHub frees them at once). Expiring after, say, 90 days would need the redirects to stop then too.
- Emails and notifications wait for the sender domain; the pages say so.
- Repository renames still break the old URL (`20`); the handle redirect does not cover them.
- A repository's social image is not yet used in `og:image` tags.
