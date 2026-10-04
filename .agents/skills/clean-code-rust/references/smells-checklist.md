# Review checklist: Clean Code smells in Rust

Run through this before calling Rust work done. Codes are Clean Code chapter 17 (G = general, N = names, T = tests, C = comments) plus Rust-only items (R).

## Contents
- Comments and environment
- Functions and general
- Names
- Tests
- Rust-only smells

## Comments and environment

- C1 Inappropriate information (ticket history, author names): move to git or `docs/`.
- C2 Obsolete comment: delete or fix now.
- C3 Redundant comment restating the code: delete.
- C5 Commented-out code: delete.
- E1 Build requires more than one step: `cargo build` from the workspace root must work; `pnpm rust:check` must pass.
- E2 Tests require more than one step: `cargo test --workspace` runs everything.

## Functions and general

- F1 Too many arguments (more than three): request struct or builder.
- F2 Output arguments (`&mut Vec<T>` filled by the callee): return the value.
- F3 Flag arguments (`bool`): two-variant enum.
- F4 Dead function: delete (clippy `dead_code` warns).
- G5 Duplication: extract a function, a generic, or a trait; three similar `match` arms are one function.
- G6 Code at the wrong level of abstraction: a handler doing git plumbing, or a domain function building HTTP responses.
- G8 Too much information: a `pub` surface wider than the one caller needs. `pub(crate)` it.
- G9 Dead code: unused variants, `#[allow(dead_code)]`, feature flags nobody sets.
- G11 Inconsistency: `fetch` here, `load` there; `Result` here, `Option` there for the same failure.
- G14 Feature envy: a method that mostly reads another struct's fields belongs on that struct.
- G15 Selector arguments (`kind: u8` deciding behaviour): separate functions or an enum with `match`.
- G16 Obscured intent: dense iterator chains without a named intermediate. Name the steps.
- G19 Explanatory variables: `let is_stale = now - pushed_at > MAX_AGE;` instead of inlining the expression in the `if`.
- G23 Prefer polymorphism to `if`/`else` chains on a type tag: `enum` + `match`, or a trait.
- G25 Magic numbers: a named `const` with a one-line reason.
- G28 Encapsulate conditionals: `if sprout.is_expired()` rather than `if sprout.lease.expires_at < now`.
- G29 Avoid negative conditionals: `if is_ready` not `if !is_not_ready`.
- G30 Functions should do one thing.
- G31 Hidden temporal coupling: `init()` must be called before `run()`. Encode it in types (`Uninit -> Ready`) or constructors.
- G33 Encapsulate boundary conditions: `let last = items.len().saturating_sub(1);` once, not in five places.
- G34 Functions descend only one level of abstraction.
- G35 Keep configurable data at high levels: constants and config in `config.rs`, not buried in a helper.
- G36 Avoid transitive navigation (`a.b().c().d()`): expose what the caller needs on `a`.

## Names

- N1 Choose descriptive names; N2 at the right level of abstraction (`store`, not `sqlite_conn`, when the caller does not care).
- N3 Standard nomenclature: Rust API Guidelines, domain vocabulary from `docs/claude-10-beanstalk-thesis.md` (trunk, intent, sprout, bean, world, evidence, lease, decision).
- N4 Unambiguous names; N5 long names for long scopes, short for short.
- N7 Names describe side effects: `create_or_load`, not `load`, when it may create.

## Tests

- T1 Insufficient tests: every public `Result` function has a success and a failure test.
- T3 Do not skip trivial tests; they document behaviour.
- T5 Test boundary conditions (empty, one, maximum, unicode paths, 32 MB blobs).
- T6 Exhaustively test near bugs: a fixed bug gets a regression test with the issue in the name.
- T9 Tests are fast: no sleeps, no network, crate under 10 s.

## Rust-only smells

- R1 `.clone()` to satisfy the borrow checker.
- R2 `Rc<RefCell<T>>` or `Arc<Mutex<T>>` in application code where an owner or a channel would do.
- R3 `String` identifiers and `bool` parameters crossing function boundaries.
- R4 `as` casts; `_ =>` arms on your own enums; `#[allow(...)]` without a reason.
- R5 `pub` fields on structs with invariants; `pub` everything in a module.
- R6 `collect::<Vec<_>>()` followed by another iteration; `Vec<u8>` for text; `&String` or `&Vec<T>` parameters.
- R7 Blocking calls (`std::fs`, `std::process`, `std::thread::sleep`) inside `async fn`.
- R8 A mutex guard held across `.await`; an unbounded channel; a spawned task whose handle is dropped.
- R9 `anyhow` in library code; `Box<dyn Error>` in a public signature; errors without context across a boundary.
- R10 Tests that print instead of assert; `#[ignore]` without a reason; wall-clock time in tests.
