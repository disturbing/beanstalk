# Git over SSH

Built 2026-10-07 on a worktree branch from `prototype` (merged up to `11a03ae`, which brought the SSH key store). People and agents use plain git with the SSH keys they registered (Settings → SSH keys, or `/gitstalk:setup`):

```bash
git clone ssh://git@<ssh host>/<owner>/<repo>.git
git push -o wait origin HEAD:refs/heads/bean/<name>
```

The flow is exactly the HTTPS flow of `18-git-native-flow.md`, served by the same gateway code: push = submit a bean, push options, the `remote:` verdicts, status refs, refusals in the protocol, access by `mayUseEngine`.

**Status.** Built and tested. Real git and OpenSSH run the whole `demo.sh` locally (every hop under `wrangler dev`, including the Worker's `connect` handler) and on a Cloudflare staging stack through a WebSocket test tunnel (§6). It is not live: inbound TCP needs a Spectrum app on a zone, and Spectrum's Worker target is in private beta. §7 says what Coop must provide.

---

## 1. The path of a connection

```
git / OpenSSH ──TCP 22──▶ Spectrum (zone, Worker-target app)
                              │
                              ▼  beanstalk-ssh Worker: connect(socket)            packages/ssh/src/index.ts
                          SSH_SERVERS.getByName("ssh-<n>").connect(…)   (a random pool instance)
                              │
                              ▼  SshServer Durable Object: connect(socket)        packages/ssh/src/ssh-server.ts
                          ctx.container.getTcpPort(2222).connect(…), bytes piped and counted
                              │
                              ▼  SSH server container (Rust, russh)                packages/ssh-server
                          public-key auth ── POST http://gateway.internal/ssh/keys/lookup
                          git-upload-pack / git-receive-pack '/<owner>/<repo>.git'
                              ── GET/POST http://gateway.internal/git/<owner>/<repo>.git/…
                              │   (intercepted by the Durable Object: outboundByHost)
                              ▼  GATEWAY service binding, RPC                      packages/ssh/src/gateway-outbound.ts
                          gateway.sshKeyLookup(publicKey, confirm)
                          gateway.sshGit(publicKey, request)                       packages/gateway/src/ssh/ssh-git.ts
                              │
                              ▼  findUserByKey (accounts) → GitCredential → repoGit (the HTTPS proxy's code)
                          mayUseEngine, push = submit, remote: lines, -o wait, refusals → Artifacts
```

- **The container never decides access and never holds a token.** It proves the client holds the private key (the SSH signature) and asks the gateway whose key it is. Every git request carries the public key; the gateway looks its owner up again and serves the request as that person through `repoGit`, the function the HTTPS route calls. The Artifacts token stays in the gateway.
- **The container's only way out is `gateway.internal`.** `enableInternet` is off, and the Durable Object answers that one host from the Worker over the service binding (`static outboundByHost`, set in a static block: a class field would bypass the library's setter and leave the handler unregistered). Nothing crosses the public internet, so no shared secret exists.
- **The gateway's surface** is two RPC methods on its default entrypoint: `sshKeyLookup(publicKey, confirm)` → `{ handle, fingerprint } | null` (`confirm` marks a signature-checked use and calls `touchKey`), and `sshGit(publicKey, request)` → `Response`. Requests and streamed responses cross RPC as they are, so `-o wait` streams. Race repos (`/git/<namespace>/race-*`) are not served over SSH: they take run tokens over HTTPS.
- **Key store:** `packages/gateway/src/auth/ssh-keys.ts` is the one adapter over `@gitstalk/shared-identity/ssh-keys` (`findUserByKey({ publicKey })`, `touchKey`). A key carries `read` and `write` (`SSH_KEY_SCOPES`), so it clones what its owner may read and pushes beans to the owner's repositories; landing is never a scope.

## 2. What the SSH server speaks

`packages/ssh-server` (crate `ssh-server`): russh 0.64 with ring (so the amd64 image cross-compiles like the runner's), tokio, reqwest for plain HTTP to the gateway.

- **Auth:** public keys only (`ssh-ed25519`, ECDSA, RSA with SHA-2, the `sk-` variants). Passwords and keyboard-interactive are refused and never advertised. An offered key is looked up (`confirm: false`); the signed attempt confirms it (`confirm: true`, one `touchKey`). An unknown key gets `Permission denied (publickey)`. The user name is ignored (`git@` by convention).
- **Commands:** `git-upload-pack` and `git-receive-pack` (and `git upload-pack …`) with `'/owner/repo.git'`, `owner/repo.git` or without `.git`, checked against the gateway's naming rules. Anything else: `gitstalk serves git only…` and exit 128. A shell gets a greeting that names the key's owner (`Hi @coop! Your key works (SHA256:…)`), exit 1, like GitHub's `ssh -T`. Ptys, subsystems and forwarding are refused.
- **Push** (git pushes with protocol v0/v1 always): the advertisement comes from `GET info/refs` with the HTTP `# service=` header removed; the gateway already adds `push-options`, so `git push -o wait` works over SSH as over HTTPS. The commands, options and pack stream into one `POST git-receive-pack`; its answer (report-status, side band, the held `-o wait` verdict with keepalives) streams back. A push with nothing to send posts nothing; a deletion-only push posts without waiting for a pack. When the gateway refuses early, the rest of the pack is read and dropped so git can read the answer.
- **Fetch and clone: protocol v2 only.** v2 is stateless per command, so each request (`ls-refs`, `fetch`) is one POST with `Git-Protocol: version=2` (Artifacts serves v2, measured in `claude-16`). `GIT_PROTOCOL` comes from the SSH `env` request, which git ≥ 2.26 sends by default. A v0 fetch is refused with the fix: `git config --global protocol.version 2`. Response-end packets (`0002`, an HTTP artefact) are dropped.
- **Errors:** a gateway 4xx is shown in the gateway's words (`gitstalk: no repository dana/x`: another owner's private repository reads as missing, as over HTTPS); a 5xx is logged and shown as `the server could not finish this command; try again`, never with details.

## 3. Limits

| Where | Limit | Default |
|---|---|---|
| SSH server | concurrent connections per container (`MAX_SESSIONS`); more are closed at accept | 64 |
| SSH server | idle connection (russh inactivity timeout; keepalive every 30 s) | 300 s |
| SSH server | a connection's whole life (`MAX_SESSION_SECONDS`; a `-o wait` push lasts at most 1800 s) | 3600 s |
| SSH server | public keys tried per connection; rejection delay | 6; 0.5 s |
| SSH server | one push (commands and pack) | 512 MiB |
| SSH server | one v2 fetch request | 16 MiB |
| SSH server | session channels per connection | 2 |
| Durable Object | open connections per instance (`SSH_MAX_CONNECTIONS`); a connection's life | 64; 65 min |
| Worker | pool instances (`SSH_POOL_SIZE`, random choice); a connection's life | 2; 66 min |
| Gateway client | connect timeout; read gap | 10 s; 120 s |

The container is `lite` (1/16 vCPU, 256 MiB), `max_instances` 3, `sleepAfter` 15 minutes, renewed while bytes flow. A cold start fails once in a while; the object retries the start once before giving up on the connection.

**Logs** (JSON, never a key or a token): the container logs each authentication (fingerprint, handle), refused key and command (`git command done`: handle, service, repo, exit status, milliseconds); the Durable Object logs each connection (bytes in and out, seconds); the gateway logs `ssh key used` (fingerprint, handle). Fingerprints are public.

## 4. Host keys

- Generated once with `ssh-keygen -t ed25519`, uploaded as the Worker secret `SSH_HOST_KEY` (`wrangler deploy --secrets-file` from a private temporary file that is deleted at once, or `wrangler secret put`), never printed or committed. The Durable Object passes it to the container as an environment variable; the container's config parser never echoes it.
- The fingerprint is public and goes in three places: the ssh Worker's `SSH_HOST_KEY_FINGERPRINT` (served at `GET /host-key`), and the web app's `SSH_HOST_KEY_FINGERPRINT` beside `SSH_HOST`. The web shows it in **Settings → SSH keys** ("Gitstalk's host key") and on a new repository's start page under the SSH clone URL. With `SSH_HOST` set, the start page prints `ssh://git@<SSH_HOST>/<owner>/<repo>.git` and `/gitstalk:setup` switches to SSH remotes (doc 19).
- The staging stack's host key is its own; live gets a new one at its first deploy.

## 5. Platform facts this rests on (checked 2026-10-07)

- Workers accept inbound TCP through a `connect(socket)` handler (also a `WorkerEntrypoint` method, and a Durable Object method reached with `stub.connect(…)`); a Durable Object reaches its container's port with `ctx.container.getTcpPort(port).connect(…)` (blog "Workers and Containers now support inbound TCP connections and gRPC", 2026-08-03). On the internet the socket comes from **Spectrum, through a new Worker-target application type, in private beta behind a sign-up form**. No TLS on the inbound socket (SSH brings its own).
- `wrangler` 4.147 accepts `"connect": [{ "protocol": "tcp", "port": … }]`: under `wrangler dev` it opens that local TCP listener; `wrangler deploy` accepts it too. No `experimental` compatibility flag was needed, locally or deployed.
- The Container class's readiness probe speaks HTTP, so the SSH server also serves `GET /healthz` on 8080 and the object waits for that port; it never probes the SSH port.
- Spectrum: Pro and Business zones get SSH on port 22; arbitrary TCP needs Enterprise with the Spectrum add-on; Free zones get none. Whether a Worker-target app needs more than that is part of the beta.

## 6. Verification

| What | Where | Result |
|---|---|---|
| Rust unit and property tests: pkt-lines, the exec command parser, the bridge (push streaming, up-to-date push, deletion without pack, push limit, v2 fetch with HTTP framing removed, v0 refused, 4xx words, 5xx hidden), config (no key in errors or `Debug`) | `cargo test` | 25 pass |
| Rust integration: a real russh client against the server with a fake gateway: unknown key refused, password refused, a registered key confirmed once, shell greeting, other commands refused, a push and a v2 fetch reach the gateway byte for byte | `packages/ssh-server/tests/ssh_session.rs` | 7 pass |
| Gateway: keys from the accounts store (registered, removed, unknown, malformed), clone advertisement, `push-options` advertised, push → bean → `LANDED` with `-o wait`, push to the sprout refused with the same words, unknown key 401, another owner's private repository 404, race repos not served | `packages/gateway/test/ssh-git.test.ts` (Miniflare, RPC through `exports.default`) | 10 pass |
| ssh Worker: the outbound routes (lookup, git with the key as an argument and not a header, refusals), the pool, the byte pipe, the WebSocket tunnel both ways, health, tunnel off by default | `packages/ssh/test/ssh-worker.test.ts` | 12 pass |
| Web: SSH clone URL and fingerprint on the start page only when `SSH_HOST` is set | `packages/web/src/repositories/repositories.test.ts` | pass |
| `pnpm check` (fmt, lint, typecheck, every package's tests, `rust:check`) | repo root | exit 0 |
| **Local end to end**: real git and OpenSSH → the Worker's real `connect` handler (wrangler's TCP listener) → `SshServer` → the real SSH server container (Docker) → gateway (service binding) → git http-backend, real `node --test` checks. The key registered in the local identity database as Settings writes it. The greeting, then all of `demo.sh` (clone, two beans landed with `-o wait`, a parallel bean red with the colliding bean's intent, the sprout push refused, status refs, rebase, fix, land, stalk validated), then refusals: an unregistered key, a v0 fetch, another owner's repository | `research/race/git_native/ssh_local_e2e.py`; `exp/git-over-ssh/local-transcript.txt` | pass |
| **Cloudflare staging** (`beanstalk-gateway-staging-ssh` with its runner, `beanstalk-ssh-staging-ssh`, D1 `beanstalk-identity-staging-ssh` and `beanstalk-forge-staging-ssh`, Artifacts `beanstalk-race-staging-ssh` and `beanstalk-repos-staging-ssh`): OpenSSH through `GET /tunnel` (`ssh_tunnel_client.mjs` as the ProxyCommand) → the deployed Durable Object → the deployed SSH container → the deployed gateway → Artifacts and real runner containers. The greeting and all of `demo.sh` in 101 s; pre-land checks 1.2 to 4.1 s; then the engine closed and its repository deleted | `research/race/git_native/ssh_staging.py`; `exp/git-over-ssh/staging-transcript.txt` | pass |

Isolation in both runs: git ran with its own HOME, `-F /dev/null`, `IdentitiesOnly`, `IdentityAgent=none`, its own known_hosts holding only the stack's host key, and a throwaway client key; no personal key, agent, ssh config or known_hosts was read or written.

**What staging did not exercise:** Spectrum → `connect(socket)` on the Worker. The tunnel enters at the Durable Object (`fetch` → WebSocket → the same `#serve` as `connect`). A first version bridged the tunnel in the Worker through `stub.connect`, the path a Spectrum connection takes: the handshake, authentication and the shell greeting worked deployed, but a push died once the request's `waitUntil` window closed, which a real `connect` handler (whose own promise holds the socket) does not have. That path is covered locally only.

## 7. Going live: what is needed

1. **Spectrum's Worker target.** Private beta: sign up (the form linked from the 2026-08-03 blog post) for the account that runs Gitstalk.
2. **A zone on that account with Spectrum.** Of the account's zones, one is on Enterprise (Spectrum is an Enterprise add-on there; whether it is enabled is not visible to Wrangler's token) and the rest are Free (no Spectrum). A Pro or Business zone on this account would do for SSH on port 22. The product domain (`16`) is the natural home: `ssh.<domain>`.
3. **A token that can manage Spectrum and DNS** on that zone (Wrangler's OAuth token reads zones but not Spectrum apps or DNS records).
4. Then, with Coop's go: generate the live host key and deploy `beanstalk-ssh` with it (`wrangler deploy --secrets-file`), create the Spectrum app (TCP 22 → Worker `beanstalk-ssh`) at `ssh.<domain>`, set the web's `SSH_HOST` and `SSH_HOST_KEY_FINGERPRINT`, and run `ssh_staging.py e2e` against the live hostname (without the tunnel).

The remote URL people use: `ssh://git@ssh.<domain>/<owner>/<repo>.git` (or `git@ssh.<domain>:<owner>/<repo>.git`).

## 8. Gaps

- **Fetch needs protocol v2.** Older clients (git < 2.26 without the setting, some libraries) are refused with the fix; a stateful v0 bridge was not built.
- **The pool is chosen at random,** not by load; one instance takes 64 connections. Next: pick the least loaded, or more instances.
- **Each connection costs two Durable Object hops** (Worker → object → container) and each git request one RPC with a D1 key lookup; a clone is two or three requests.
- **The `-o wait` poll** is the HTTPS one (`18` §10): one engine request a second from the gateway.
- Workers Logs show `Can't read from request stream because client disconnected` when a client hangs up mid-request; harmless, not yet silenced.
- Local tooling fixes made on the way: `devstack.py` binds `REPOS` (repositories) and the local runner fake speaks runner API 4.
