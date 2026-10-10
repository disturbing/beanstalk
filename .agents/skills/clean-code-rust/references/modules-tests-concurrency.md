# Modules, tests and concurrency (Rust)

## Contents
- Crate layout
- Visibility and cohesion
- Tests
- Concurrency with tokio

## Crate layout

Binary crates split `main.rs` (wiring only, under 60 lines) from `lib.rs` (everything testable).

```
packages/<worker>/container/   # a container crate lives in the Worker package that owns it
  Cargo.toml
  Dockerfile              # container apps only
  src/
    main.rs               # config, telemetry, serve, shutdown
    lib.rs                # pub mod app; pub mod config; pub mod error; pub mod <domain>;
    app.rs                # axum Router and handlers: parse, call domain, map result
    config.rs             # Config::from_env()
    error.rs              # Error enum, Result alias, IntoResponse
    telemetry.rs          # tracing init
    wire.rs               # request and response types
    world/                # one directory per domain concept once it outgrows a file
      mod.rs
      plan.rs
      compose.rs
  tests/
    http.rs               # integration tests through the Router
```

Modules by domain (`world`, `bean`, `git`), never by kind (`models`, `utils`, `helpers`, `types`). A `util.rs` is a smell: name what it does (`paths.rs`, `hashing.rs`).

Files over about 400 lines split along a domain seam. Dependencies point inward: `app` depends on `world`, `world` depends on `git`, nothing depends on `app`.

## Visibility and cohesion

- Private by default. `pub(crate)` when another module needs it; `pub` only for the crate's intended surface, re-exported from `lib.rs`.
- A module's functions should use most of its state. If half the functions use half the fields, it is two modules.
- Single responsibility: one reason to change. `git.rs` changes when git usage changes, not when the HTTP contract does.
- Sealed traits (`pub trait Store: private::Sealed`) when downstream implementations are not supported.
- Enums and `match` for closed sets; traits for open sets and for test doubles (`trait BlobStore` with an in-memory implementation under `#[cfg(test)]`).

## Tests

- Unit tests colocated: `#[cfg(test)] mod tests { #![allow(clippy::unwrap_used, clippy::expect_used)] use super::*; ... }`.
- Integration tests in `tests/` drive the axum `Router` with `tower::ServiceExt::oneshot`; no network, no remote git (a temporary repo on disk is fine).
- One behaviour per test, named as the behaviour: `fn rejects_duplicate_bean_ids()`, `fn composes_beans_in_submission_order()`. Arrange, act, assert, separated by blank lines.
- One concept per test: several `assert!`s on one result are fine, two scenarios are not.
- FIRST: fast (crate under 10 s), independent (no shared mutable fixtures), repeatable (no wall clock, seeded randomness, no sleeps), self-validating (asserts, not printouts), timely (written with the code).
- `proptest` for anything that parses, merges, diffs or orders. `insta` snapshots for rendered output (JSON bodies, diffs); review snapshot changes like code.
- Time is injected: pass `Instant` in or depend on a `Clock` trait. In tokio tests use `#[tokio::test(start_paused = true)]` and `tokio::time::advance`.
- Every `Result`-returning public function has at least one error-path test.
- Test private helpers only through the public behaviour that exercises them.

## Concurrency with tokio

- `#[tokio::main]` multi-thread runtime. Never block a runtime thread: `tokio::fs`, `tokio::process::Command`, and `tokio::task::spawn_blocking` for CPU-heavy work (merging, hashing large blobs).
- Every external call (HTTP, subprocess, storage) is wrapped in `tokio::time::timeout`; the value is a named constant with a one-line justification.
- Structured tasks: `JoinSet` for fan-out; await every handle. A dropped `JoinHandle` is a leaked task.
- Cancellation: pass a `tokio_util::sync::CancellationToken` into long jobs, check it between steps, cancel it on shutdown.
- Share by communicating: bounded `mpsc` (so backpressure exists) and `oneshot` before `Arc<Mutex<T>>`. When a mutex is right, use `std::sync::Mutex` for short critical sections never held across `.await`; `tokio::sync::Mutex` only when the guard must live across an await, and then ask whether an actor task is clearer.
- Shared data is immutable (`Arc<Config>`) or confined to one task that owns it.
- Types that cross tasks are `Send + Sync` by design, never through `unsafe impl` (`unsafe` is forbidden).
- Shutdown is a feature: on SIGTERM stop accepting, cancel the token, await in-flight work with a deadline, exit 0.
