# 19 · Accounts and authentication

Built 2026-10-07 on branch `auth-accounts` (from `prototype` at `fed4f54`). This is Phase 1 items 1.1–1.3 and part of 1.5 from `16-product-backlog.md`: people sign up and sign in, agents connect over MCP OAuth, and git gets user tokens. Everything runs on Cloudflare: D1, KV, Workers Rate Limiting, Email Service (built, off), and two open-source libraries inside Workers (`@cloudflare/workers-oauth-provider`, `@simplewebauthn/server` and `/browser`). No third-party service is in any request path.

**Owner decisions applied:** 100% Cloudflare; vinext web; OAuth on MCP; passkeys are the primary sign-up path (Coop, 2026-10-07); email magic links are built and tested but switched off and hidden until a sender domain is configured.

**Open for Coop:** the sender domain for sign-in mail (§6). That is the only thing blocking email sign-in.

## 1. What works on staging

Staging: `beanstalk-web-staging` and `beanstalk-mcp-staging` on the devaccounts workers.dev subdomain, D1 `beanstalk-identity-staging`, KV `beanstalk-oauth-staging`. The staging gateway was **not** redeployed (§7).

| Check (headless Chrome, CDP virtual authenticator) | Result |
|---|---|
| Sign up with a handle and a passkey; land on Settings; header shows `@handle` | pass |
| Personal access token created, shown once, listed, opens `/mcp`; revoked token refused | pass |
| OAuth: dynamic client registration, `/authorize` → web `/connect`, approve, code + PKCE (S256) → tokens (15 min access, refresh) | pass |
| Access token opens `/mcp`; `whoami` names the person; refresh issues a new token | pass |
| Settings lists the connected agent; Disconnect revokes its tokens | pass |
| Sign out; sign in again with the same passkey | pass |
| Cross-site form POST refused (403) | pass |

19 of 19 checks passed (`e2e.mjs`, kept in the session scratchpad, not the repo).

**Claude Code as the real client (twice, from a clean state):**

```bash
claude mcp add --transport http beanstalk-staging https://beanstalk-mcp-staging.<sub>.workers.dev/mcp
claude mcp list                    # beanstalk-staging … ! Needs authentication
claude mcp login beanstalk-staging # opens the browser (--no-browser prints the URL)
#   → /authorize → /login → "Create an account" → handle + passkey → /connect → Allow
#   → the browser returns to Claude Code's localhost callback
claude mcp list                    # beanstalk-staging … ✔ Connected
claude -p "Call the beanstalk-staging whoami tool…" --allowedTools mcp__beanstalk-staging__whoami
#   → handle claude-6921a6, client Claude Code, scopes read
```

Claude Code 2.1.292 identified itself with a **Client ID Metadata Document** (`client_id=https://claude.ai/oauth/claude-code-client-metadata`), not dynamic registration, used S256 PKCE, `scope=read` (from our `WWW-Authenticate` challenge) and the RFC 8707 `resource`. The consent screen shows "Claude Code, Published by claude.ai" for it, and "This app registered itself, so its name is not verified" for DCR clients. The browser half was driven by headless Chrome with a virtual authenticator; `claude mcp login` ran in a pseudo-terminal (it refuses to finish without one). A `run_status` call over the same OAuth session returned the newest staging run's sprout head.

Screenshots (night and day): `exp/auth/signup-*.png`, `login-*.png`, `consent-*.png` (and `consent-claude-code-night.png`), `settings-*.png`, `tokens-*.png`, `tokens-created-night.png` (the token is masked before the shot and revoked after).

## 2. Architecture

```
 browser ──▶ beanstalk-web (vinext)            Claude Code / Codex / any MCP client
             /signup /login /connect /settings        │  401 + resource_metadata
             /api/auth/passkey/* /auth/*               ▼
                │ D1 IDENTITY_DB              beanstalk-mcp
                │ RPC (MCP binding):            OAuthProvider (workers-oauth-provider)
                │  consentRequest, approve…     /.well-known/*, /oauth/register, /oauth/token
                └──────────────────────────────▶ /authorize → 302 web /connect?request=<id>
                                                /mcp  OAuth tokens and bsu_ PATs → tools
                                                /mcp  bst1. run tokens → unchanged run-token app
 git ──▶ beanstalk-gateway  verifyGitCredential: bst1. run tokens | bsu_/bss_ user tokens (D1)
```

- **One D1 database, `beanstalk-identity`**, bound as `IDENTITY_DB` in web, MCP and gateway. Schema in `packages/shared-identity/migrations/` (users, passkeys, web_sessions, auth_challenges, magic_links, user_tokens, audit_events). Apply it from the web package: `wrangler d1 migrations apply beanstalk-identity --remote`.
- **Why D1, not a Durable Object.** Identity is read from three Workers and looked up by globally unique keys (handle, email, credential id, token hash, session hash). D1 gives unique constraints, joins (token → user) and later read replication, with no single-threaded hot spot. One global DO would serialise every sign-in and token check; sharding DOs by user breaks lookups by email, handle or token. Per-repository state stays in RepoDOs as `16` §3.2 plans.
- **Why no `beanstalk-identity` Worker yet.** `16` §3.1 plans one; the brief asked for functions in a shared package, so the logic is a library (`@beanstalk/shared-identity`) that each Worker calls against its own binding. Wrapping it in a Worker with RPC later changes no schema and no caller signature.
- **OAuth lives in the MCP Worker** (issuer = its origin), and the consent screen is the web app's `/connect`. On workers.dev they are two origins, so the library's cookie-bound consent helpers can't be used across them; instead `/authorize` validates the request (`parseAuthRequest`, `describeConsent`), stores it in KV for ten minutes under the hash of a random id, and redirects to `/connect?request=<id>`. The first signed-in person to open it claims it; approve/deny consume it; the web form carries the session CSRF token. In production `16` §3.1 puts both on one zone, which changes nothing here.

## 3. Interfaces for the other agents

All in `packages/shared-identity/src/` (import `@beanstalk/shared-identity/<module>`); every function takes an env with `IDENTITY_DB: D1Database`.

| Need | Call | Returns |
|---|---|---|
| Who is behind a git or API token | `verifyUserToken(env, token)` (`user-tokens`) | `{ user: { id, handle, email }, scopes: ('read'\|'collaborate'\|'write')[], token: { id, kind: 'personal'\|'session', expiresAt } } \| null` |
| Who is signed in (any Worker with the binding) | `getSessionUser(request, env)` (`sessions`) | `{ id, handle, email } \| null` (email null until verified) |
| Mint a short-lived token for an agent session | `mintSessionToken(env, { userId, label, scopes, ttlSeconds?, clientId? })` | `{ token: 'bss_…', summary }`, at most one hour, revoked with the client's grant |
| Personal tokens | `createPersonalToken`, `listUserTokens`, `revokeUserToken` | audited, hashed at rest |
| Audit | `recordAudit(env, { action, actorUserId, target?, ip?, detail? }, now)` | IPs stored as a 16-char hash prefix |

**Web app adapter (one file):** `packages/web/src/auth/user.ts` — `requireUser(request) => Promise<{ id, handle, email }>` (throws `SignInRequired`, whose `response()` is a 401), `getUser(request)`, and `currentUser()` / `currentSession()` for server components and actions. The repository agent should code against `requireUser` only.

**Gateway:** `packages/gateway/src/auth/git-credential.ts` — `verifyGitCredential(env, token, nowMs?)` returns `{ ok: true, kind: 'run', claims }` for `bst1.` run tokens (unchanged behaviour), `{ ok: true, kind: 'user', user, scopes, tokenKind }` for `bsu_`/`bss_`, or `{ ok: false, reason }`. The git proxy uses it; user credentials on race repos get **403** ("race repos take run tokens; user tokens open repositories"), so the git-native agent's repository routes only need to add a branch for `kind: 'user'` (read → fetch/clone, write → push to the person's own beans, never `sprout`/`stalk`). `GET /v1/whoami` answers who a credential is (Basic password or bearer), for people testing a token. If the git-native agent already has its own `verifyGitCredential`, merge by adding the `USER_TOKEN` branch at its top: `if (/^bs[us]_/.test(token)) return verifyUserToken(env, token)`, mapped to its result type.

**MCP RPC for the web app** (`AgentSessionsRpc` in `shared-identity/agent-sessions.ts`, implemented by `packages/mcp/src/index.ts`): `consentRequest`, `approveConsent`, `denyConsent`, `agentSessions`, `revokeAgentSession`. The web binds the MCP Worker as `MCP`.

**Scopes** (one vocabulary for PATs, session tokens and OAuth): `read` (MCP read tools, git fetch), `collaborate` (bean threads and inbox), `write` (push to your own beans). Landing on the stalk and repository settings are never grantable. OAuth requires `read` (advertised as the resource's required scope; the consent page always includes it).

## 4. MCP

- `/.well-known/oauth-protected-resource/mcp` (RFC 9728) and `/.well-known/oauth-authorization-server` (RFC 8414): issuer, `/authorize`, `/oauth/token` (also revocation), `/oauth/register` (RFC 7591), S256 only, CIMD supported (`global_fetch_strictly_public` flag).
- An unauthenticated `/mcp` gets `401` with `WWW-Authenticate: Bearer … resource_metadata=…, scope="read"`; a token without `read` gets the step-up `403 insufficient_scope`.
- Access tokens 15 minutes; refresh tokens 30 days, idle-sliding. Grants, codes and tokens are stored hashed in `OAUTH_KV` with props encrypted by the library.
- An OAuth session sees the read tools plus `whoami` and `git_credential` (a one-hour `bss_` token, never wider than the session's read/write; visible to the model, the trade-off `16` §3.3 accepts until the `bean` CLI credential helper). Collaboration writes still need contributor run tokens: there are no persistent repositories or beans owned by people yet (Phase 2).
- Until Phase 2, a session reads one run: `DEMO_RUN`, or the newest run the gateway lists.
- **View and contributor tokens keep working** for existing links: a bearer starting `bst1.` goes to the unchanged run-token app before the OAuth provider sees it. A `bsu_` personal token also works as a bearer on `/mcp` (`resolveExternalToken`).
- Connected agents are listed from KV, which is eventually consistent: a new grant can take up to a minute to appear in Settings (the page says so).

## 5. Sign-in and security

- **Passkeys (primary):** discoverable credentials (`residentKey: required`), `attestation: none`, ES256/RS256/EdDSA via `@simplewebauthn/server`. Each options request stores a single-use challenge for five minutes (hashed handle in the `__Host-bs_challenge` cookie). Sign-up creates user + passkey + session + audit in one D1 batch; a handle race is caught by the unique constraint. RP ID is the request host (workers.dev is on the public suffix list, so the full host is the RP). A person can add passkeys and remove any but the last.
- **Sessions:** 32 random bytes in `__Host-bs_session` (HttpOnly, Secure, SameSite=Lax, Path=/), SHA-256 in D1, 30 days sliding (one write a day), sign out and sign out everywhere.
- **CSRF:** every state-changing endpoint checks `Origin` (or `Sec-Fetch-Site: same-origin` when the origin is withheld); signed-in forms also carry a session-bound token (hash of the session secret); passkey endpoints require `application/json`.
- **Rate limits:** Workers Rate Limiting binding `SIGNIN_RATE_LIMIT`, 10 per minute per IP and per handle or email (keys hashed).
- **Constant-time compares** for token and CSRF checks; every secret stored only as SHA-256; tokens never logged (logs carry ids and reasons only).
- **Audit events** in D1: `user.signup`, `session.signin`/`signout`/`signout_all`, `passkey.add`/`remove`, `magic_link.request`, `token.create`/`revoke`, `session_token.mint`, `oauth.grant`/`deny`/`revoke`.
- Account pages send `X-Frame-Options: DENY`, `frame-ancestors 'none'`, `Referrer-Policy: same-origin` and `no-store`. (`no-referrer` made Chrome send `Origin: null` on form posts, which the origin check refused; caught on staging.)
- OAuth redirect URIs: a fuzz test of 11 variants (path traversal, trailing slash, extra query, case, other host, https on loopback, fragment, `javascript:`, scheme-relative, userinfo tricks) never redirects; another port on loopback is allowed by design (RFC 8252 §7.3). Plain PKCE and missing PKCE are refused. `workers-oauth-provider` is pinned to 1.2.3 (`16` notes its 2025 redirect-URI CVE).

## 6. Email magic links (built, off)

`packages/shared-identity/src/magic-links.ts`: 32-byte token, hashed, single use, 15 minutes, bound to the asking browser (`__Host-bs_preauth`); the request never reveals whether an address has an account (no account and no handle → a "sign up here" mail without a link). Tested with a fake Email Service binding (5 tests). The web app hides every email control and `/api/auth/email` answers 404 until **both** are set:

1. `EMAIL_SENDER_DOMAIN` in `packages/web/wrangler.jsonc` vars (mail comes from `signin@<domain>`), and
2. `"send_email": [{ "name": "EMAIL" }]` in the same file, after `wrangler email sending enable <domain>`.

**Coop decides:** the sender domain. It has to be a domain on the Cloudflare account, onboarded to Email Sending (SPF/DKIM set up by the onboarding). It is tied to the product domain decision in `16` (beanstalk.sh, beanstalk.build, beanstalkgit.com were free on 10-06); a subdomain such as `mail.<domain>` keeps sign-in mail reputation separate.

## 7. Not done, and why

- **Gateway staging not redeployed.** The staging gateway hosts other agents' live races (its RunDOs would pick up this branch's code mid-race, and its container image would rebuild). `verifyGitCredential` and `/v1/whoami` are covered by Miniflare tests (5) instead. Deploying it needs only the `IDENTITY_DB` binding added to the staging template.
- `beanstalk-web-staging` was redeployed from this branch (previous version `17a5b302`, deployed by another agent at 06:56Z; `wrangler rollback` restores it).
- Not in this change: Turnstile on sign-in (rate limits only), the six-digit email code, orgs/teams, a separate identity Worker, the plugin's `.mcp.json` switch to OAuth (1.4), and repository-scoped authorization (Phase 2).

## 8. Tests

| Package | New tests | What |
|---|---|---|
| `shared-identity` | 33 | passkey sign-up/sign-in/add/remove with a software ES256 authenticator (real CBOR and DER), wrong origin, challenge expiry and single use, handle races; sessions (sliding, revoke, everywhere, CSRF); tokens (hash at rest, scopes, expiry, revoke, ownership, session tokens die with their client); magic links (browser binding, single use, expiry, no enumeration); the real rate-limit binding; handles; same-origin checks |
| `mcp` | 25 | discovery metadata and the 401 challenge, DCR, authorize → consent → token, wrong/missing PKCE, code replay, refresh, revocation, deny, consent claimed by one person, connected sessions and revoke (with session git tokens), redirect-URI fuzz, PATs on `/mcp`, run tokens still routed to the old path |
| `gateway` | 5 | `verifyGitCredential` for run, personal and session tokens; `/v1/whoami`; user tokens refused on race repos |
| `web` | 4 | safe `next` paths, relying party, cross-site refusal |
