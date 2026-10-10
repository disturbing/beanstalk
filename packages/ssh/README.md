# @gitstalk/ssh

The Worker `gitstalk-ssh` serves git over SSH (`git clone ssh://git@<host>/<owner>/<repo>.git`,
`git push`). Inbound TCP reaches it through a `connect(socket)` handler: deployed, a Cloudflare
Spectrum application routes port 22 of the SSH hostname to the Worker; under `wrangler dev` the
Worker listens for raw TCP on port 2222. Each connection is forwarded to one of a small pool of
`SshServer` Durable Objects, each owning a container that runs the Rust SSH server in
[`container/`](container/README.md). That server authenticates the client's public key and
bridges `git-upload-pack` and `git-receive-pack` to the gateway's smart-HTTP proxy, reached over
the `GATEWAY` service binding. Access rules, push = submit, push options and `remote:` verdicts are
therefore the gateway's, exactly as over HTTPS.

```
git / OpenSSH ──TCP 22──▶ Spectrum ──▶ SshWorker.connect(socket)
                                             │ stub.connect (random pool slot ssh-0..ssh-N)
                                             ▼
                                   SshServer DO ──getTcpPort(2222)──▶ ssh-server container
                                             ▲                              │
                                             └── http://gateway.internal ◀──┘
                                                       │ RPC sshKeyLookup / sshGit
                                                       ▼
                                                gitstalk-gateway
```

**Status:** built and tested locally end to end and on a staging stack through the WebSocket
test tunnel; going live needs a Spectrum Worker-target application, which is in private beta.
See [21 - Git over SSH](../../docs/claude-opus/21-git-over-ssh.md) for the design, the test
evidence and what is still needed.

## Key concepts

- **Pool.** `SSH_POOL_SIZE` Durable Objects named `ssh-0` to `ssh-<n-1>`; a new connection goes
  to one at random. Each container serves many connections and refuses more than
  `SSH_MAX_CONNECTIONS`; the Durable Object counts open connections and renews the container's
  sleep timer while bytes flow.
- **No internet in the container.** `enableInternet` is off. The only reachable host is
  `gateway.internal`, which the Durable Object's outbound handler answers over the service
  binding (`src/gateway-outbound.ts`):
  - `POST /ssh/keys/lookup` `{ public_key, confirm }` calls the gateway's `sshKeyLookup` and
    answers `{ handle }` or 404;
  - `/git/<owner>/<repo>.git/...` with the key in a request header calls `sshGit`, which serves
    the smart-HTTP request as the key's owner.
  Errors reach the container as a bare 502, so no internal detail reaches a git client.
- **Test tunnel.** With `SSH_TUNNEL=on`, `GET /tunnel` accepts a WebSocket that carries one SSH
  connection, for stacks without a Spectrum app. The WebSocket is accepted inside the Durable
  Object so it lives as long as the connection. A client for it is
  `research/race/git_native/ssh_tunnel_client.mjs`. Off in production.
- **Host key.** The private key is the `SSH_HOST_KEY` secret, passed to the container per
  start; only its public fingerprint is published (`GET /host-key`).

Public docs: [Git](../site/public/docs/git.html) covers the push flow shared with HTTPS.

## Layout

| Path | Contents |
|---|---|
| `src/index.ts` | `WorkerEntrypoint`: `connect(socket)` forwarding and the Hono app |
| `src/ssh-server.ts` | `SshServer`: the Container DO, connection budget, TCP forwarding, tunnel |
| `src/gateway-outbound.ts` | The `gateway.internal` handler: key lookup and git forwarding over RPC |
| `src/socket-pipe.ts` | Bidirectional byte pipe with totals and activity callback |
| `src/tunnel.ts` | A WebSocket as a byte stream, for the test tunnel |
| `src/config.ts`, `src/log.ts` | Vars parsing, pool slot choice, structured JSON logs |
| `test/ssh-worker.test.ts` | vitest on `@cloudflare/vitest-pool-workers` |
| `container/` | The Rust SSH server crate and its Dockerfile ([README](container/README.md)) |

## HTTP surface

| Route | Purpose |
|---|---|
| `GET /healthz` | Liveness |
| `GET /host-key` | `{ fingerprint, user: "git", port: 22 }`, or 404 when no fingerprint is set |
| `GET /tunnel` | WebSocket test tunnel, only when `SSH_TUNNEL=on` |

## Develop

```bash
pnpm -F @gitstalk/ssh dev        # wrangler dev: TCP on localhost:2222, builds the container with Docker
pnpm -F @gitstalk/ssh test       # vitest
pnpm -F @gitstalk/ssh typecheck  # tsc
pnpm -F @gitstalk/ssh types      # regenerate worker-configuration.d.ts after a wrangler.jsonc change
cargo test -p ssh-server         # the container crate
```

Local development needs the gateway running too (the `GATEWAY` service binding). There is no
`.dev.vars.example`; create `.dev.vars` with `SSH_HOST_KEY` set to an OpenSSH private key
generated for development (`ssh-keygen -t ed25519`; `\n` escapes are accepted). Never commit it.

## Configuration

Bindings (`wrangler.jsonc`):

| Binding | Kind | Use |
|---|---|---|
| `SSH_SERVERS` | Durable Object (`SshServer`, container) | Pool slots; `lite` instances, `max_instances` 3 |
| `GATEWAY` | Service `gitstalk-gateway` (default entrypoint) | `sshKeyLookup`, `sshGit` |
| `connect` | TCP, port 2222 | `wrangler dev` listener; Spectrum on port 22 when deployed |

`ContainerProxy` is exported because `@cloudflare/containers` needs it for outbound interception.

Vars: `LOG_LEVEL`, `SSH_POOL_SIZE` (1-16), `SSH_MAX_CONNECTIONS` (1-1024, passed to the
container as `MAX_SESSIONS`), `SSH_HOST_KEY_FINGERPRINT` (public, `SHA256:...`), `SSH_TUNNEL`
(`on` or `off`). Keep `SSH_POOL_SIZE` within the container's `max_instances`.

Secrets: `SSH_HOST_KEY` (required).

Deploy through an environment, never with `wrangler deploy` on this template (the package's
`deploy` script deliberately fails):

```bash
pnpm env:provision <env>
pnpm env:secrets <env>
pnpm env:deploy <env> --only ssh
```

See [30 - Environments](../../docs/claude-opus/30-environments.md).

## Contributing

See [CONTRIBUTING.md](../../CONTRIBUTING.md); run `pnpm check` at the root before sending a
change.
