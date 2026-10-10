---
name: clean-code-rust
description: Clean Code (Robert C. Martin) translated into idiomatic Rust for Gitstalk's container apps and crates. Covers naming, small functions, Result and thiserror error handling, newtypes over bool and String, module layout, tests, tokio concurrency, the workspace clippy profile and the container Dockerfile. Use when writing, reviewing or refactoring any Rust code, Cargo.toml, clippy settings or Dockerfile under packages/.
---

# Clean Code, in Rust

Rust already enforces much of Clean Code: ownership replaces most null and side-effect rules. These rules cover what the compiler does not. The workspace lints in [lints-and-workspace.md](references/lints-and-workspace.md) are the mechanical half; this file is the judgement half.

## Rules that apply every time

1. **Names say what, not how.** `pending_beans`, not `list`, `data` or `tmp`. Types are nouns (`WorldPlan`), functions are verbs (`compose_world`), predicates read as questions (`is_ready`, `has_conflicts`). Follow the Rust API Guidelines: `as_`/`to_`/`into_` conversions, `iter`/`iter_mut`/`into_iter`, getters without `get_`.
2. **Functions do one thing at one level of abstraction** and fit on a screen: about 25 lines, 50 is the ceiling. Extract until each body reads as a sentence. Public entry points first in the file, helpers below (the stepdown rule).
3. **At most three parameters.** A fourth means a request struct or a builder. No `bool` parameters: use a two-variant enum (`Mode::DryRun`). No out-parameters: return a value or a small named struct.
4. **Borrow at the boundary.** Take `&str`, `&[T]`, `&Path` or `impl AsRef<Path>`; return owned values only when the caller must own them. A `.clone()` added to satisfy the borrow checker is a design smell: restructure instead.
5. **Errors are values.** Library and service code returns `Result<T, Error>` with a `thiserror` enum; `anyhow` only in `main` and tests. `unwrap`, `expect` and `panic!` are denied outside tests. Add context when crossing a boundary. Never return `Box<dyn Error>` from a public API.
6. **Make illegal states unrepresentable.** Newtypes for every identifier (`BeanId`, `TrunkSha`), enums for states, `TryFrom` for validation at construction, `#[non_exhaustive]` on public enums, `#[must_use]` on pure functions.
7. **Comments explain why, never what.** Rustdoc on public items with `# Errors` and `# Panics` sections. No commented-out code, no banners, no journal comments. `unsafe` is forbidden in this workspace.
8. **Modules by domain, not by kind.** `world/`, `bean/`, `git/`; never `models/`, `utils/`, `helpers/`. Private until something outside needs it; `pub(crate)` before `pub`. Files under about 400 lines.
9. **Tests are production code.** Colocated unit tests for logic, `tests/` for the HTTP surface, property tests for anything that parses or merges, one behaviour per test, names that state the behaviour (`rejects_duplicate_bean_ids`). No sleeps, no network.
10. **Async discipline.** Never block inside async (`tokio::process`, `spawn_blocking`). Every external call has a timeout. Channels and `JoinSet` before shared locks; never hold a `std::sync::Mutex` guard across `.await`.
11. **A container is a twelve-factor process.** Config from env, fail fast on bad config, JSON logs on stdout via `tracing`, bind `0.0.0.0:$PORT`, graceful shutdown on SIGTERM, disk treated as scratch.

## Workflow

1. Creating a crate or touching `Cargo.toml`: follow [lints-and-workspace.md](references/lints-and-workspace.md). The workspace lints are the contract.
2. Write the type and error shapes first ([errors-and-types.md](references/errors-and-types.md)), then the functions ([naming-and-functions.md](references/naming-and-functions.md)).
3. A service that runs in a Cloudflare Container follows [container-service.md](references/container-service.md).
4. Before finishing, run the checklist in [smells-checklist.md](references/smells-checklist.md) and the commands below.

## Verify

```bash
cargo fmt --all --check
cargo clippy --workspace --all-targets --all-features -- -D warnings
cargo test --workspace
```

`pnpm rust:check` from the repo root runs all three. Never add `#[allow(...)]` without a one-line reason beside it.

## References

| File | Load when |
|------|-----------|
| [naming-and-functions.md](references/naming-and-functions.md) | Naming, function size and shape, parameters, comments, formatting |
| [errors-and-types.md](references/errors-and-types.md) | Error enums, `anyhow` vs `thiserror`, HTTP mapping, newtypes, enums, builders, serde boundaries |
| [modules-tests-concurrency.md](references/modules-tests-concurrency.md) | Crate layout, visibility, tests, tokio and cancellation |
| [container-service.md](references/container-service.md) | axum skeleton, config, logging, shutdown, Dockerfile |
| [lints-and-workspace.md](references/lints-and-workspace.md) | Root `Cargo.toml` template, clippy profile, release profile |
| [smells-checklist.md](references/smells-checklist.md) | Review checklist mapping Clean Code smells to Rust |
