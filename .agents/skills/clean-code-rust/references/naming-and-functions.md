# Naming, functions, comments and formatting (Rust)

## Contents
- Naming
- Functions
- Parameters and return values
- Comments and rustdoc
- Formatting

## Naming

| Clean Code rule | In Rust |
|---|---|
| Intention-revealing names | `elapsed_since_push`, not `d` or `delta`. Put units in the type (`Duration`), or in the name when the type cannot carry them (`timeout_ms`). |
| Avoid disinformation | Do not call a `HashMap` a `list`; do not name a non-iterator `iter`; do not call a fork a `branch`. |
| Meaningful distinctions | No `data`, `info`, `the_`, `a_`, numbered names. Two things with different names must differ in meaning. |
| Pronounceable and searchable | No abbreviations beyond the domain's own (`sha`, `id`, `repo`). Single-letter names only in closures and short loops. |
| Nouns for types, verbs for functions | `struct WorldPlan`, `fn compose(&self)`. Traits name a capability: `BlobStore`, `Mergeable`. |
| One word per concept | Choose `fetch`, `load` or `read` once and use it everywhere. |
| No encodings | No Hungarian prefixes, no `I` on traits, no `_t` suffix. |
| Predicates read as questions | `is_landed`, `has_conflicts`, `can_fork`. |
| Consistent word order | `verb_object` everywhere: `apply_bean`, `revoke_lease`; never `bean_apply`. |
| Rust API Guidelines (C-CASE, C-CONV, C-GETTER, C-ITER) | `snake_case` functions, variables and modules; `UpperCamelCase` types, traits and variants; `SCREAMING_SNAKE_CASE` constants. `as_` is a cheap borrow, `to_` is expensive or owned, `into_` consumes. Getters are `fn name(&self)` and `fn name_mut(&mut self)`. Collections expose `iter`, `iter_mut`, `into_iter`. |

## Functions

- One thing, one level of abstraction. If a block can be extracted under a meaningful name, extract it.
- About 25 lines; 50 is the ceiling and needs a reason in review.
- Stepdown rule: public functions at the top of the file, each followed by the helpers it calls.
- Early return with `?`, `let ... else` and guard clauses. No `else` after a `return`.
- Iterators over index loops. Collect once; never collect only to iterate again.
- Command/query separation: a function either changes state or answers a question. `fn take_lease(&mut self) -> Lease` is fine; `fn is_leased_and_mark(&mut self)` is not.
- No hidden side effects: if it writes, logs or sleeps, the name says so (`persist_`, `emit_`).
- `match` on your own enums is exhaustive: no `_ =>` arm, so a new variant fails to compile where it matters.
- Prefer `impl Trait` in argument position over explicit generics when the type parameter appears once.

## Parameters and return values

| Rule | Form |
|---|---|
| Three parameters maximum | A fourth parameter means a request struct with named fields, or a builder. |
| No boolean flags | `enum Validation { Strict, Lenient }`; call sites read `compose(plan, Validation::Strict)`. |
| No out-parameters | Return the value; for several, return a small named struct, never a three-tuple. |
| Borrow at the boundary | `&str` not `&String`; `&[T]` not `&Vec<T>`; `impl AsRef<Path>` for paths; `impl Iterator<Item = &Bean>` when only iteration is needed. |
| Own when the caller needs ownership | Return `String` or `Vec<T>`; never return references into temporaries. |
| Generic only to remove duplication | `fn write_all<W: Write>(w: W)` yes; generic over everything no. |
| `Option` for absence, `Result` for failure | `Result<Option<T>, E>` only when both outcomes are real; never `Option<Result<..>>`. |
| `#[must_use]` on pure functions | A dropped return value becomes a warning. |

## Comments and rustdoc

Good comments: `///` on every `pub` item (what it does, then `# Errors` and `# Panics` when applicable); a `//` explaining a non-obvious why or a trade-off; a warning of consequences; a `TODO(owner): ...` linked to an issue.

Bad comments: restating the code, journal entries, closing-brace markers, banners, attributions, and commented-out code (delete it; git remembers). Design notes belong in `docs/`, not in a 40-line comment.

Rustdoc examples use `?`, never `unwrap`. `cargo test` compiles them, so keep them real.

## Formatting

`rustfmt` with the repo `rustfmt.toml` is the only style; do not argue with it. Import order by hand: `std`, external crates, `crate::`, separated by blank lines. One blank line between items, never two. Related lines stay together; a blank line separates concepts. Keep a file's vertical order meaningful: types, constructors, public methods, private helpers, tests.
