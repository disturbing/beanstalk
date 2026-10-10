# ssh-server: the git-over-SSH server container

The Rust crate `ssh-server` is the SSH server that runs inside the containers of
[`@gitstalk/ssh`](../README.md). It is built on [russh](https://github.com/Eugeny/russh), accepts
public-key authentication only, and serves exactly two commands, `git-upload-pack` and
`git-receive-pack`, by bridging them to the gateway's smart-HTTP proxy. It never decides access
and never holds a repository token: the gateway serves each request as the owner of the key, with
the same rules and push flow as HTTPS.

```
SshServer DO ──TCP──▶ :2222 russh ─┬─ auth: POST /ssh/keys/lookup ────────────┐
              ──HTTP─▶ :8080 /healthz │                                         ▼
                                   └─ git: GET info/refs, POST git-*-pack ──▶ http://gateway.internal
                                                                              (DO outbound handler → gateway RPC)
```

Design and test evidence: [21 - Git over SSH](../../../docs/claude-opus/21-git-over-ssh.md).

## How it works

- **Authentication** (`src/ssh/handler.rs`): each offered public key is looked up at the gateway
  (`POST /ssh/keys/lookup`); a registered key yields the owner's handle. Passwords,
  keyboard-interactive, shells, ptys, subsystems and forwarding are refused.
- **Commands** (`src/git/command.rs`): `git-upload-pack '/<owner>/<repo>.git'` or
  `git-receive-pack ...`, as git's SSH transport sends them; nothing else runs.
- **Bridge** (`src/git/bridge.rs`, `src/git/pkt.rs`):
  - push (protocol v0/v1): the advertisement from `GET info/refs`, then the client's commands,
    push options and pack streamed as one `POST git-receive-pack`, whose answer (report-status,
    `remote:` lines, the held `-o wait` verdict with keepalives) streams back;
  - clone and fetch (protocol v2, stateless per command): the capability advertisement, then
    each `ls-refs` or `fetch` as one POST.
  The HTTP-only `# service=` prefix and v2 response-end packet are stripped on the way.
- **Gateway client** (`src/gateway/`): plain HTTP to `GATEWAY_URL` (`http://gateway.internal`),
  which the owning Durable Object intercepts and answers over its service binding. The key
  travels in a request header so the gateway can look its owner up.
- **Health port** (`src/health.rs`): `GET /healthz` (the Container class waits for this HTTP
  port before forwarding TCP, since its readiness probe cannot speak SSH) and `GET /host-key`
  (algorithm and public fingerprint, never the key).
- **Limits** (`src/ssh/server.rs`): at most `MAX_SESSIONS` connections, idle and total
  connection timeouts, a cap on push size and on authentication attempts.

## Configuration

Read once at startup (`src/config.rs`):

| Variable | Default | Meaning |
|---|---|---|
| `SSH_PORT` | 2222 | SSH listen port |
| `PORT` | 8080 | Health port |
| `SSH_HOST_KEY` | required | Host OpenSSH private key (a Worker secret, passed per start; `\n` escapes accepted) |
| `GATEWAY_URL` | `http://gateway.internal` | The gateway as the container reaches it |
| `MAX_SESSIONS` | 64 | Concurrent connections |
| `IDLE_TIMEOUT_SECONDS` | 300 | Idle connection timeout |
| `MAX_SESSION_SECONDS` | 3600 | A connection's whole life |
| `MAX_PUSH_BYTES` | 536870912 | One push's commands and pack |
| `MAX_AUTH_ATTEMPTS` | 6 | Public keys a connection may try |

The `SshServer` Durable Object sets `SSH_HOST_KEY`, `SSH_PORT`, `PORT`, `GATEWAY_URL`,
`MAX_SESSIONS` (from `SSH_MAX_CONNECTIONS`) and `RUST_LOG`.

## Image

`Dockerfile` (multi-stage, linux/amd64, `RUST_VERSION` build argument, default 1.96.0): a
`rust:<RUST_VERSION>-slim-trixie` build stage with `cargo-chef` that compiles on the build host's
architecture and links for `x86_64-unknown-linux-gnu`, then a `debian:trixie-slim` runtime with
`tini` and the single `ssh-server` binary, running as an unprivileged `ssh-server` user. Ports
2222 and 8080 are exposed; the host key is never baked in.

The build context is the repository root (the Cargo workspace). Wrangler builds it from the
Worker's `wrangler.jsonc` (`image_build_context: "../.."`); by hand:

```bash
docker buildx build --platform linux/amd64 -f packages/ssh/container/Dockerfile .
```

## Layout

| Path | Contents |
|---|---|
| `src/main.rs` | Startup: SSH and health listeners, graceful shutdown |
| `src/ssh/` | russh configuration, listener and per-connection handler |
| `src/git/` | Command parsing, pkt-line handling, the HTTP bridge (`bridge_tests.rs`) |
| `src/gateway/` | Key lookup and smart-HTTP calls to the gateway |
| `src/health.rs`, `src/config.rs`, `src/telemetry.rs` | Health router, configuration, tracing |
| `tests/ssh_session.rs` | A real russh client against the server with a fake gateway |

## Develop

```bash
cargo test -p ssh-server   # unit, property and session tests
pnpm rust:check            # fmt, clippy -D warnings and tests for every crate
```

## Contributing

See [CONTRIBUTING.md](../../../CONTRIBUTING.md); run `pnpm check` at the root before sending a
change.
