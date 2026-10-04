# Errors and types (Rust)

## Contents
- Error handling rules
- Error type template
- Mapping errors to HTTP
- Newtypes and enums
- Builders and constructors
- Serde at the boundary

## Error handling rules

1. Library and service code returns `Result<T, Error>` where `Error` is a `thiserror` enum in the crate's `error.rs` (or the module's, when it has its own failure vocabulary).
2. `anyhow::Result` only in `main.rs`, build scripts and tests. `anyhow` can hold any `std::error::Error`, so the edge converts with `?`.
3. Add context where meaning changes: `.map_err(|source| Error::ReadBlob { sha: sha.clone(), source })?`. A bare `?` across a boundary loses the "which blob" the caller needs.
4. `unwrap`, `expect` and `panic!` are denied outside tests. Alternatives: `?`, `let ... else { return Err(..) }`, `unwrap_or_default`, `ok_or(Error::Missing)`.
5. No error codes, sentinel values or `Option` for failures. `Option` means "absent is normal".
6. Define the normal case so callers do not branch: an empty `Vec` for "nothing matched", not `Err(NotFound)`.
7. No null-like values: no `Option<&str>` where an empty string is the real meaning, no `-1`.
8. Errors are `Send + Sync + 'static` and implement `Debug`, `Display` and `std::error::Error` (`thiserror` does this). No `Box<dyn Error>` in public signatures.
9. `#[non_exhaustive]` on public error enums.
10. Log once, where the error is handled, with `tracing::error!(error = %e, ...)`. Do not log at every level and also return.

## Error type template

```rust
// error.rs
use thiserror::Error;

#[derive(Debug, Error)]
#[non_exhaustive]
pub enum Error {
    #[error("bean {id} not found")]
    BeanNotFound { id: BeanId },

    #[error("world {world} has {count} unresolved conflicts")]
    Conflicts { world: WorldId, count: usize },

    #[error("git {op} failed")]
    Git {
        op: &'static str,
        #[source]
        source: std::io::Error,
    },

    #[error("invalid config: {0}")]
    Config(String),
}

pub type Result<T, E = Error> = std::result::Result<T, E>;
```

Variants are noun phrases describing the failure, not `GitError` inside `Error`. They carry the data a caller needs to act (ids, counts), never only a pre-rendered message.

## Mapping errors to HTTP

One `impl IntoResponse for Error` per service crate. Each variant maps to a status and a stable machine code. A 5xx never leaks its `Display` text to the client.

```rust
use axum::{http::StatusCode, response::{IntoResponse, Response}, Json};

#[derive(serde::Serialize)]
struct ErrorBody {
    code: &'static str,
    message: String,
}

impl IntoResponse for Error {
    fn into_response(self) -> Response {
        let (status, code) = match &self {
            Error::BeanNotFound { .. } => (StatusCode::NOT_FOUND, "bean_not_found"),
            Error::Conflicts { .. } => (StatusCode::CONFLICT, "world_conflicts"),
            Error::Config(_) | Error::Git { .. } => (StatusCode::INTERNAL_SERVER_ERROR, "internal"),
        };
        if status.is_server_error() {
            tracing::error!(error = ?self, "request failed");
        }
        let message = if status.is_server_error() {
            "internal error".to_owned()
        } else {
            self.to_string()
        };
        (status, Json(ErrorBody { code, message })).into_response()
    }
}
```

## Newtypes and enums

- Every identifier that crosses a function boundary is a newtype: `pub struct BeanId(String);` with `impl TryFrom<String>` that validates, plus `Display`, `Debug`, `Clone`, `PartialEq`, `Eq`, `Hash` and serde derives. Fields stay private; expose `fn as_str(&self) -> &str`.
- A set of related constants is an enum, never `&'static str` or `u8`. A set of independent flags is `bitflags`, not an enum.
- State machines are enums with data: `enum Sprout { Claimed { lease: Lease }, Working { since: Instant }, Landed { world: WorldId } }`. Transitions consume `self` and return the next state, so an impossible transition does not compile.
- Derive eagerly: `Debug, Clone, PartialEq, Eq` on data types always; `Hash, PartialOrd, Ord, Default` when meaningful; `Copy` for small plain values. Every public type implements `Debug`.
- Use `From`, `TryFrom` and `AsRef` for conversions when the standard trait fits.
- Only smart pointers implement `Deref`; never use it to fake inheritance.
- Numeric casts use `u32::try_from(x)?`, not `as` (the workspace warns on `as`).

## Builders and constructors

- Constructors are `fn new(..)` or named (`from_env`, `with_capacity`) and return `Result` when they validate.
- More than three optional fields: a builder (`WorldPlan::builder().trunk(sha).bean(id).build()?`). The `bon` crate is acceptable; a hand-written builder is fine for one or two.
- Structs with invariants have private fields and no way to construct them that bypasses validation.

## Serde at the boundary

- Wire types (`#[derive(Serialize, Deserialize)]`) live in `wire.rs` next to the handlers; domain types live in the domain module. Convert with `From` and `TryFrom`. Domain types with invariants get serde only through `#[serde(try_from = "WireType")]`.
- Request bodies use `#[serde(deny_unknown_fields)]`; everything uses `#[serde(rename_all = "snake_case")]`; timestamps are RFC 3339 strings; ids are strings.
- Validate once at the edge, then pass typed values inward. Inner code trusts its types and never re-checks.
