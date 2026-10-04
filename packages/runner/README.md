# runner

The `runner` container: git and the test suite for the `RunDO`'s integration decisions. Artifacts has no server-side merge, so squash-merges, batch composition, reverts, ref updates and test runs happen here. The contract is §3 of [`docs/claude-opus/10-cf-prototype-plan.md`](../../docs/claude-opus/10-cf-prototype-plan.md); the semantics are those of the local race harness ([`research/race/harness/gitops.py`](../../research/race/harness/gitops.py) and [`ci.py`](../../research/race/harness/ci.py)), so cloud and local races compare metric for metric.

Rust (axum, tokio), one HTTP service on `0.0.0.0:$PORT` (8080). The image adds git 2.47 (Debian trixie), Node 25.9.0 and Mergiraf 0.20.0.

## API

JSON in, JSON out. Every request carries `repo` (the trunk's Artifacts HTTPS remote) and `token` (an Artifacts token minted for this job). Unknown fields are refused. Commit ids are full 40- or 64-hex shas; refs are full names (`refs/heads/...`).

| Endpoint | Request | Response |
|---|---|---|
| `POST /v1/squash` | `onto`, `change` `{repo, token, ref, base?}`, `message`, `union_paths?`, `merge_driver?` | `{result: "clean", sha, files, change_head, merge_base, change_files?}` or `{result: "conflict", files, change_head, merge_base, change_files?}` |
| `POST /v1/compose` | `base`, `items` `[{repo, token, ref, base?, task, message?}]`, `union_paths?`, `merge_driver?` | `{head, per_item: [{task, result, sha?, files, change_head, merge_base, change_files?}]}` |
| `POST /v1/revert` | `onto`, `commit`, `message`, `union_paths?`, `merge_driver?` | `{result, sha?, files}` |
| `POST /v1/update-ref` | `ref`, `new`, `old?` | `{ok: true, actual: new}` or `{ok: false, actual}` |
| `POST /v1/check` | `sha`, `cmd?` (default `["node", "--test"]`), `extra_files?` `{path: content}`, `latency_seconds?`, `suite_timeout_seconds?` (300), `test_timeout_ms?` (60000) | `{sha, green, tests, failures, failing_tests: [{file, name, message}], failing_files, passing_files, read_set, read_sets, read_depths, stack_files, output_excerpt, suite_seconds, ci_seconds, timed_out}` |
| `GET /healthz` | | `{ok, git, node}` (503 when either is missing) |
| `GET /version` | | `{version, git_sha}` |

- **squash** fetches `change.ref` from the change's remote, then lands `merge_base(head, onto)..head` on `onto` as one commit whose only parent is `onto` (`git merge-tree --write-tree --merge-base`, then `commit-tree`). `files` is `changed_files(onto, sha)` when clean and the conflicted paths otherwise. `change.base` is optional and never changes the merge (every harness policy merges from `git merge-base head onto`); when given, `change_files` is the task's own write set `base..head`, as the harness logs on `task.commit`.
- **compose** is the queue's batch build: each item is squashed onto the last clean commit, a conflicting item is skipped, `head` is the last clean commit (or `base`). Without `message`, an item's commit message is `"<task>\n\nTask: <task>\n"`.
- **revert** is the beanstalk policy's revert: a 3-way merge with `commit` as base, `onto` as ours and `commit^1` as theirs, committed on `onto`. It also serves the leave-one-out probes.
- Every clean result (squash, each composed item, revert) is pushed to `refs/beanstalk/candidates/<sha>` on the trunk, so a later `check` or `update-ref` on any runner instance can fetch it by name. Identical requests within one second build the identical commit; when another request has already created its candidate ref, the push still counts as done.
- **update-ref** is `git push --force-with-lease=<ref>:<old>`; the server re-checks `old` under its ref lock. `old` absent or `null` moves the ref unconditionally (the harness's `update_ref` without `old`); the all-zero sha means create only. A stale lease returns `{ok: false, actual}` with the ref's current value (`null`: absent). It is idempotent: when the ref already points at `new` the call succeeds whatever `old` says, so a retry after a lost response is safe.
- **check** is the harness's `CI.run`: the commit is written to a fresh directory, `extra_files` are added, and `node --test --test-timeout=<ms> --test-reporter=spec --test-reporter-destination=stdout --test-reporter=junit --test-reporter-destination=<file>` runs there with `CI=1` and without `NODE_OPTIONS*`, `NODE_TEST*` and `GIT_*`. Field names are `CIResult`'s (`output_excerpt` is `CIResult.output`). `failing_files` is `null` when the suite crashed or timed out before the reporter finished. `read_sets`, `read_depths` and `stack_files` are filled only for a red run with failing files, as in `ci.py`; `read_depths` keeps the harness's breadth-first key order. After the suite the request is held for `latency_seconds` (emulated CI latency: the slot stays busy) and `ci_seconds` covers fetch, checkout, suite and latency.
- `union_paths` are gitattributes patterns, each written as `<pattern> merge=union`. The harness's beanstalk preset is `["CHANGELOG.md", "CHANGELOG*.md", "**/CHANGELOG.md"]`; the queue preset sends none. `merge_driver` is `"git"` (default, the harness) or `"mergiraf"` (`* merge=mergiraf`, with union patterns still winning).

Errors are `{code, message}`: `400 invalid_request` (the message names the field), `422 unknown_commit` (not reachable from the trunk's branches or candidate refs), `422 unknown_ref`, `422 no_merge_base`, `422 root_commit`, `502 remote_failed` (git's message, token redacted), `504 timeout`, `500 internal` (details only in the logs).

## Git and tokens

- One bare cache per trunk remote: `$WORK_DIR/<sha256(url)[:32]>.git`, created atomically on first use. Requests that miss a commit fetch the trunk's `refs/heads/*` and `refs/beanstalk/candidates/*`; a change is fetched by its named ref into `refs/beanstalk/fetched/<digest>`. The runner never asks a remote for a bare sha (Artifacts' fetch-by-sha is unverified); a commit reachable only by sha is reported as `unknown_commit`.
- Fetches into a cache are serialised by a per-cache lock; merges and commits only add objects and run concurrently. Per-request files (the attributes file, a throwaway index, the checkout, the junit report) live in `$WORK_DIR/jobs/<n>/` and are deleted after the request; `jobs/` is cleared at start.
- The token reaches git as `http.extraHeader=Authorization: Bearer <token>` through `GIT_CONFIG_COUNT`/`GIT_CONFIG_KEY_n`/`GIT_CONFIG_VALUE_n`, the environment form of `git -c`: not in argv (where `ps` shows it to every process), never on disk, never logged. Git's stderr is redacted before it reaches an error or a log line, and `Token`'s `Debug` prints a placeholder. URLs with embedded credentials are refused.
- Every git command runs with `GIT_CONFIG_NOSYSTEM=1`, `GIT_CONFIG_GLOBAL=/dev/null`, `GIT_TERMINAL_PROMPT=0`, `LC_ALL=C`, the inherited `GIT_*` variables removed, and a timeout (2 min local, 5 min remote). Child processes run in their own process group; a timeout sends SIGTERM to the group and SIGKILL after 3 s, and a cancelled request kills its group.

## Run locally

```bash
# From the repo root. file:// remotes are for local use only; production allows https.
PORT=8080 WORK_DIR=/tmp/runner-work REMOTE_SCHEMES=https,file cargo run -p runner

curl -s localhost:8080/healthz
curl -s localhost:8080/v1/squash -H 'content-type: application/json' -d '{
  "repo": "file:///tmp/trunk.git", "token": "local",
  "onto": "<sha on the trunk>", "message": "Task title\n\nTask: t001\n",
  "change": {"repo": "file:///tmp/fork.git", "token": "local", "ref": "refs/heads/task/t001"},
  "union_paths": ["CHANGELOG.md", "CHANGELOG*.md", "**/CHANGELOG.md"]
}'
```

The image (build context is the repo root; nothing is pushed):

```bash
docker buildx build --platform linux/amd64 -f packages/runner/Dockerfile -t beanstalk-runner:dev .
docker run --rm -p 8080:8080 beanstalk-runner:dev
```

| Variable | Default | Meaning |
|---|---|---|
| `PORT` | `8080` | listen port |
| `WORK_DIR` | `/work` | caches and scratch (ephemeral) |
| `REMOTE_SCHEMES` | `https` | URL schemes a request may use (`https`, `file`) |
| `COMMIT_AUTHOR_NAME`, `COMMIT_AUTHOR_EMAIL` | `beanstalk-runner`, `runner@beanstalk.invalid` | identity of the commits it creates |
| `RUST_LOG` | `info` | log filter (JSON lines on stdout) |
| `CLOUDFLARE_DEPLOYMENT_ID` | | logged at start |

The build compiles Rust natively on the build host and links for `x86_64-unknown-linux-gnu` (cargo-chef caches dependencies), so Apple Silicon builds do not run rustc under emulation. Node and Mergiraf are pinned release downloads verified by SHA-256. The image is about 123 MB compressed and 390 MB on disk (Node 124 MB, Mergiraf 79 MB).

## Parity with the harness

Measured, not assumed: the tests in `tests/check.rs`, `tests/merge.rs` and `tests/update_ref.rs` assert values produced by the harness's own `CI.run` and `Git.squash_onto` on the arena (`tests/fixtures/arena.bundle`, built by `research/arena/materialize.py`: `main` plus the reference commits of t001, t002, t005 and t040). For example, t001's acceptance test on the base gives 82 tests, 1 failure and the same 47-file read set with the same import depths in the same order; compose of t001, t040 and t005 gives clean, conflict on `src/billing/service.ts`, clean; t005 onto t002 conflicts on `CHANGELOG.md` without union and is clean with it.

The read-set analysis (`import_depths`, `resolve_import`, `list_files`, `stack_files`, `parse_junit`, `_excerpt`) is ported to Rust rather than shipped as a JS helper: it runs in the same process as the check with no second runtime to keep in step, and its parity is pinned by the golden tests above. It keeps Python's semantics where they matter: `posixpath.normpath` and `os.path.realpath`/`relpath`, universal newlines, `str.strip()` whitespace, and truncation by characters.

Known differences, all deliberate:

- `git merge-tree` runs with `-z`, so a path with spaces at its ends or with unusual characters comes back exactly; the harness's line mode strips or quotes such names. Arena paths are unaffected.
- Union attributes come from a per-request `core.attributesFile` instead of `.git/info/attributes`. Both are read for merges; in-tree `.gitattributes` would differ (the harness reads its base checkout, the bare cache reads none), and the arena has none.
- Commit identity, timestamps and therefore commit ids differ from a local run; results, files and test outcomes do not.
- The container runs in UTC with Node 25.9.0; the laptop harness inherits the host's time zone and Node. The arena pins `en-US` and uses ISO dates, so its tests do not depend on either.
- `failing_tests` never carries the failure `body` (the harness drops it in most paths too).

## Notes for the gateway (`Runner` Container class)

- `defaultPort = 8080`; image `../runner/Dockerfile` with `image_build_context: "../.."`. Start at `instance_type: "standard-1"`.
- Allow egress to the Artifacts host only (`enableInternet = false` plus `setAllowedHosts`).
- Requests are synchronous: a check holds its request for checkout, the suite (up to `suite_timeout_seconds`) and `latency_seconds`; give the DO's fetch a deadline above their sum.
- Checks run agent-written code as the same user as git, and a running git process's environment (holding its token) is readable through `/proc` by that code. Send checks read-scoped tokens, and keep the committer instance, which holds write tokens, free of checks.
- `update-ref` needs a write token for the trunk; squash, compose and revert need one too (they push candidate refs). Change refs only need read tokens for the fork.
- Reap `refs/beanstalk/candidates/*` with the forks after a run.
- Unverified: that Artifacts accepts pushes to refs outside `refs/heads/` and `refs/tags/` (the plan's `refs/beanstalk/candidates/*`). The live smoke test should push one; if Artifacts refuses, move candidates under `refs/heads/` (the format in `RefName::candidate`, `src/git/ids.rs`), which the trunk fetch already mirrors.
- `extra_files` paths are relative to the repo root after the harness's `_strip_app` (the arena's `app/` prefix removed); absolute paths and `..` are refused.

## Tests

`pnpm rust:check` (or `cargo test -p runner`) runs unit tests beside the code, integration tests through the router (`tests/`), and property tests: ref-name validation against `git check-ref-format`, path normalisation, junit parsing, redaction, and, with real git, "squash of disjoint edits is always clean and keeps both sides" and "union merge keeps every changelog entry". Remotes in tests are local bare repositories over `file://`. The suite tests need Node 25 on `PATH`; without it they return early and say so on stderr.
