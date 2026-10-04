# Cargo workspace, lints and profiles

## Contents
- Root Cargo.toml
- Member crate Cargo.toml
- What the lints enforce
- Commands

## Root Cargo.toml

The repo has no root `Cargo.toml` until the first Rust package exists (a virtual workspace with zero members is a Cargo error). Create it like this and add every crate to `members`:

```toml
[workspace]
resolver = "3"
members = ["packages/world-builder"]

[workspace.package]
edition = "2024"
rust-version = "1.96"
license = "Apache-2.0"
publish = false

[workspace.dependencies]
anyhow = "1"
axum = "0.8"
serde = { version = "1", features = ["derive"] }
serde_json = "1"
thiserror = "2"
tokio = { version = "1", features = ["rt-multi-thread", "macros", "signal", "net", "process", "fs", "time"] }
tokio-util = "0.7"
tracing = "0.1"
tracing-subscriber = { version = "0.3", features = ["env-filter", "json"] }
# test only
insta = { version = "1", features = ["json"] }
proptest = "1"
tower = { version = "0.5", features = ["util"] }

[workspace.lints.rust]
unsafe_code = "forbid"
missing_debug_implementations = "warn"
unused_must_use = "deny"
rust_2018_idioms = { level = "warn", priority = -1 }

[workspace.lints.clippy]
all = { level = "warn", priority = -1 }
pedantic = { level = "warn", priority = -1 }
unwrap_used = "deny"
expect_used = "deny"
panic = "deny"
todo = "deny"
unimplemented = "deny"
dbg_macro = "deny"
print_stdout = "deny"
print_stderr = "deny"
as_conversions = "warn"
missing_errors_doc = "warn"
module_name_repetitions = "allow"
must_use_candidate = "allow"

[profile.release]
lto = "thin"
codegen-units = 1
strip = true
```

Versions above are the current stable majors (checked 2026-10-03). Add a dependency to `[workspace.dependencies]` once and reference it from crates with `name.workspace = true`.

## Member crate Cargo.toml

```toml
[package]
name = "world-builder"
version = "0.1.0"
edition.workspace = true
rust-version.workspace = true
license.workspace = true
publish.workspace = true

[dependencies]
anyhow.workspace = true
axum.workspace = true
serde.workspace = true
serde_json.workspace = true
thiserror.workspace = true
tokio.workspace = true
tokio-util.workspace = true
tracing.workspace = true
tracing-subscriber.workspace = true

[dev-dependencies]
insta.workspace = true
proptest.workspace = true
tower.workspace = true

[lints]
workspace = true
```

## What the lints enforce

| Lint | Clean Code rule | How to comply |
|---|---|---|
| `unsafe_code = forbid` | No undefined behaviour in app code | Use safe APIs; a crate that truly needs `unsafe` is its own reviewed crate with the lint relaxed there only. |
| `unwrap_used`, `expect_used`, `panic` | Use exceptions, not crashes | Return `Result`; `let ... else`; in tests allow inside `mod tests`. |
| `todo`, `unimplemented` | No dead or stub code | Finish the function or delete it. |
| `dbg_macro`, `print_stdout`, `print_stderr` | Logging is structured | `tracing::{info,warn,error}!`. |
| `as_conversions` | Be precise | `try_from` / `try_into`, or `From` for lossless widening. |
| `missing_errors_doc` | Document failure | `# Errors` section on public `Result` functions. |
| `missing_debug_implementations` | Debuggability | `#[derive(Debug)]` on every public type. |
| `pedantic` group | Idiomatic Rust | Fix the finding; `#[allow]` only with a reason on the same line. |

## Commands

```bash
cargo fmt --all --check
cargo clippy --workspace --all-targets --all-features -- -D warnings
cargo test --workspace
cargo doc --workspace --no-deps          # before changing a public API
```

`pnpm rust:check` runs the first three from the repo root and is part of `pnpm check`. Commit `Cargo.lock`.
