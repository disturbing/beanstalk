# beanstalk

Agent-first git forge on Cloudflare Workers and Artifacts, built for Cloudflare's "Build the next GitHub" competition (deadline 2026-10-14). Design docs are the source of truth for behaviour: start with `docs/claude-README.md`, then `docs/claude-10-beanstalk-thesis.md` and `docs/claude-13-demo-plan.md`. When code and a doc disagree, update the doc in the same change.

This file is the canonical instruction set for every coding agent (Codex, Claude Code, Cursor, Copilot and others read it; `CLAUDE.md` only imports it). Keep it short; details live in skills.

## Stack (decided)

- **Monorepo**: pnpm workspace, every unit under `packages/<name>` (package `@beanstalk/<name>`, Worker `beanstalk-<name>`). Dependency versions come from the catalog in `pnpm-workspace.yaml`.
- **Workers**: TypeScript, Hono router inside a `WorkerEntrypoint` default export, RPC between Workers through service bindings (never HTTP). One `wrangler.jsonc` per package; Wrangler is the deploy tool for every package (not the beta `cf` CLI) until after the deadline.
- **Containers**: Rust (axum, tokio), one crate per image under `packages/<name>` with its Dockerfile, owned by a Container Durable Object in a Worker package. Root `Cargo.toml` is a workspace created with the first crate.
- **Web app**: vinext (Next.js App Router on Workers) in `packages/web`; bindings through `import { env } from 'cloudflare:workers'`; data via service-binding RPC to the gateway.
- **Platform**: Durable Objects (SQLite), Artifacts, Queues, Workflows, R2, D1, Containers, Sandbox, AI Gateway, as the design docs specify. Coding work is done by real harnesses (Claude Code, Codex) over MCP; Workers AI is never a coding worker, with one owner exception (2026-10-09): Automations run their agent loop on Workers AI models through AI Gateway, by the gateway's model proxy, until agent setups exist (`docs/claude-opus/25-actions-and-automations.md` §7.5); Jev only classifies.

## Commands

```bash
pnpm install                       # once; Node 24+, pnpm 11, Rust stable, Docker for containers
pnpm check                         # fmt:check + lint (type-aware oxlint) + typecheck + test + rust:check
pnpm -F @beanstalk/<name> dev      # also: test, types (regenerate worker-configuration.d.ts)
pnpm rust:check                    # cargo fmt --check, clippy -D warnings, cargo test
pnpm skills:update                 # refresh vendored Cloudflare skills (skills-lock.json)
pnpm env:provision <env>           # environments/<env>: create resources, secrets, migrate D1 (docs/claude-opus/30)
pnpm env:deploy <env>              # check secrets, deploy every package in order (--dry-run, --only); never `wrangler deploy` a template
```

`pnpm check` must pass before work is reported as done. Run it; do not describe it.

## Skills: load before writing code

| Working on | Skill |
|---|---|
| Any `.ts` / `.tsx` | `clean-code-typescript` |
| Any Rust, `Cargo.toml`, Dockerfile | `clean-code-rust` |
| Creating or structuring a package, Hono routes, wrangler config, containers, the web app | `beanstalk-packages` |
| Public docs (`packages/site/public/docs/`) | `public-docs` |
| Cloudflare platform questions (product choice, Workers, DOs, Wrangler, Sandbox, Agents SDK, vinext, web perf) | `cloudflare`, `workers-best-practices`, `durable-objects`, `wrangler`, `sandbox-next`, `agents-sdk`, `nextjs-on-cloudflare`, `web-perf` (vendored from `cloudflare/skills`; never edit by hand) |

Skills live in `.agents/skills/` (read natively by Codex); `.claude/skills/` holds symlinks for Claude Code. A new skill goes in `.agents/skills/<name>/` plus `ln -s ../../.agents/skills/<name> .claude/skills/<name>`. Follow the Agent Skills size rules: `SKILL.md` under 150 lines, description under 1,024 characters, references one level deep with a contents list when over 100 lines.

## Rules

- Generated types only: `wrangler types` writes `worker-configuration.d.ts`, committed, never edited; no hand-written `Env`.
- Secrets live in `.dev.vars` and Wrangler secrets. Never in source, config, docs or logs.
- Agents never hold Artifacts tokens; every repo read or write goes through the gateway (`docs/claude-06-identity-mcp-and-previews.md`). Merging to trunk is never an agent capability.
- Tests: vitest with `@cloudflare/vitest-pool-workers` and real Miniflare bindings; mock only external HTTP. Rust: `cargo test`, property tests for parsers and merges. No test flags, no sleeps.
- New Worker: `compatibility_date` is the creation date, `observability.enabled` and `observability.traces.enabled` are true.
- Structured JSON logs through the package's `log` module; no `console.log` elsewhere.
- Git: work on a branch, never push to `main`, commit only when the owner asks. Licence: FSL-1.1-ALv2 (`LICENSE.md`, owner's decision 2026-10-04): source-available, no competing hosted use, each version converts to Apache-2.0 two years after release. The competition rules list MIT, Apache-2.0 or BSD, so this knowingly risks eligibility (owner's informed choice). Add no GPL code to Workers or the web app (Mergiraf runs only as a separate binary in a container).
- Public docs: when you change user-visible behaviour (or deploy it, or an experiment concludes), update `packages/site/public/docs/` in the same change, following the `public-docs` skill; `node scripts/check-docs.mjs` must pass. In Claude Code, delegate to the `docs-maintainer` subagent (`docs-auditor` audits read-only). Never label anything live that is not deployed.
- Docs: `docs/claude-*` is the Claude-authored set, unprefixed `docs/0*-*.md` is the Codex set. Do not overwrite the other set; add to your own and note disagreements in `docs/claude-README.md`.
- Residency: competition entrants must reside in the US or Canada; the owner is eligible. Do not add contributors' names to the entry without checking.

## Where things live

| Path | Contents |
|---|---|
| `AGENTS.md`, `CLAUDE.md` | This file; Claude Code import of it |
| `.agents/skills/`, `.claude/skills/`, `skills-lock.json` | Skills (canonical, symlinks, vendored-skill lock) |
| `docs/` | Research, thesis, demo plan, design docs |
| `packages/` | All code; one directory per package or crate |
| `scripts/` | Repo tooling (`rust-check.mjs`, `check-docs.mjs`, `environments.mjs`) |
| `environments/` | Deploy environments; only `example/` is public. Never put account ids in `packages/*/wrangler.jsonc` (templates) |
| `packages/site/public/docs/` | Public docs on the marketing site; `.claude/agents/docs-*.md` maintain and audit them |
| `research/` | Corpus clones used by research scripts; not part of the build |
| `tsconfig.base.json`, `.oxlintrc.json`, `.oxfmtrc.json`, `rustfmt.toml`, `rust-toolchain.toml` | Shared tool configuration; change in its own commit with a reason |
