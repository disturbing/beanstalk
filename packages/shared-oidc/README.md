# @gitstalk/shared-oidc

The OpenID Connect issuer for Gitstalk Actions jobs: the GitHub-compatible identity tokens a
workflow job asks for (`id-token: write`) so it can sign in to a cloud provider without stored
credentials. It provides the discovery document, the JWKS, the job-facing token endpoint as a
Hono app, the claims, and the per-job request token. It is a TypeScript library with no Worker
of its own: the gateway mounts it at `/_actions/oidc` (there is no separate OIDC Worker).

```
Actions job (container) ── GET <ACTIONS_ID_TOKEN_REQUEST_URL>&audience=... ──┐
                           Authorization: bearer <request token>             │
                                                                             v
cloud provider ── /.well-known/openid-configuration, /.well-known/jwks ──> gitstalk-gateway
                                                                           /_actions/oidc
                                                                           (createOidcApp from
                                                                            @gitstalk/shared-oidc)
```

## Key concepts

- **Request token** (`ACTIONS_ID_TOKEN_REQUEST_TOKEN`): `bsoidc.<payload>.<mac>`, HMAC-SHA-256
  over `{ exp, job }`. The job's identity is frozen in it when the control plane mints it, so a
  job cannot ask for a token about another run, ref or repository. It is not an identity token.
- **Identity token**: a JWT whose claims mirror GitHub's, plus `trust`, `pusher` and `bean`.
  `sub` depends on the run: `repo:<owner>/<repo>:ref:refs/heads/<branch>` for a stalk run,
  `:environment:<env>` with an environment, `:pull_request` for a maintainer's pre-land check,
  and `:preland-untrusted:<pusher>` for anyone else's, which no stalk trust policy can match.
  Tokens live 5 minutes by default, never more than 10.
- **Signing keys**: a JSON key set in one secret; every key's public half is published, only
  the `active` one signs. Rotation is add, wait, activate, retire.

Design: [25-actions-and-automations.md](../../docs/claude-opus/25-actions-and-automations.md)
§3.5 and the public [Actions](../site/public/docs/actions.html) page.

## Layout

There is no index module; import files by path, for example
`@gitstalk/shared-oidc/issuer` (the `exports` map is `./*` to `./src/*.ts`).

| Path | Contents |
| --- | --- |
| `src/issuer.ts` | `createOidcApp`, `loadOidcConfig`, `mintIdTokenRequest`, `issueIdToken`, `issuerUrlFor`, `DEFAULT_ISSUER_PATH` |
| `src/job-identity.ts` | `IdTokenJob` schema (stalk run or pre-land check), `isUntrustedPreland` |
| `src/claims.ts` | Claim set and `sub` rules, token lifetimes |
| `src/request-token.ts` | Per-job request token mint and verify |
| `src/signing-keys.ts` | Key-set parsing, JWKS, signing |
| `src/base64url.ts` | Unpadded base64url |
| `scripts/oidc-keys.mjs` | Key-set tool: `new`, `add`, `activate`, `retire` (RS256 or ES256); writes the secret JSON to stdout only |
| `test/` | Tests and a test-only Worker (no bindings) |

Imported by `packages/gateway` (`src/actions/oidc.ts`).

## Develop

```bash
pnpm -F @gitstalk/shared-oidc test        # vitest in workerd; verifies tokens with jose
pnpm -F @gitstalk/shared-oidc typecheck   # tsc -p tsconfig.json
pnpm -F @gitstalk/shared-oidc types       # regenerate worker-configuration.d.ts from test/wrangler.jsonc
node packages/shared-oidc/scripts/oidc-keys.mjs new ES256   # pipe straight into a secret, never a file
```

There is no `dev` script and no `.dev.vars`.

## Configuration

The host Worker (the gateway) reads these; all are optional, and without the two secrets jobs
get no OIDC variables and the routes answer 503:

- `OIDC_SIGNING_KEYS` (secret): the key set from `oidc-keys.mjs`.
- `OIDC_REQUEST_SECRET` (secret, at least 32 characters) and `OIDC_REQUEST_SECRET_PREVIOUS`
  (secret, during rotation): HMAC keys for request tokens.
- `OIDC_ISSUER_URL` (var): the public issuer URL; default `<origin>/_actions/oidc`.

Set secrets for an environment with `pnpm env:secrets <env>`; see
[30-environments.md](../../docs/claude-opus/30-environments.md).

## Contributing

See [CONTRIBUTING.md](../../CONTRIBUTING.md); run `pnpm check` at the root before sending a
change.
