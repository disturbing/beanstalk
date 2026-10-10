# Test impact by file-access tracing: run only what a change can affect

Research prototype (not part of the build). Question: can Beanstalk select the tests a bean can break by
recording **which files each test file actually touches**, in a way that works for any language and
with **no fallback** (no "run everything to be safe")?

**Answer, on five small but realistic projects: yes.**
- **Safety:** 298 of 298 breaking mutations were caught by the selected tests alone, across Python,
  TypeScript, Java, Go and Rust, with every failing test file selected.
- **Selection size:** 34–74% of test files were selected, against 20–43% that actually failed.
- **Verdict agreement:** the selected run's pass/fail verdict matched the full suite's for all 353
  mutations.
- **The one miss:** an earlier version of the selection rule missed one mutation (an added Python
  package directory). The trace had the information and the rule was wrong. It is fixed and explained
  below.

The approach only works if the **build or compile step is traced as well as the test run**. The
ablation shows this:
- **Runtime reads only:** Go catches 12/62 breaking mutations and Rust 8/61. Java catches 47/57, and
  inlined `static final` constants are among its misses.
- **Build reads only:** every compiled language misses changes to data files that are read at runtime.

| Language | Test files | Mutations (breaking) | **Safety** | Selected, mean (breaking mutations) | Actually failing | Granularity |
|---|---|---|---|---|---|---|
| Python (pytest) | 16 | 72 (59) | **59/59 (100%)** | 42% | 20% | file |
| TypeScript (node:test, Node 24) | 16 | 71 (59) | **59/59 (100%)** | 35% | 20% | file |
| Java (javac + JUnit 5) | 16 | 68 (57) | **57/57 (100%)** | 59% | 27% | file (class) |
| Go (`go test`) | 18 | 71 (62) | **62/62 (100%)** | 38% | 26% | package for compile, file for runtime |
| Rust (`cargo test`) | 16 | 71 (61) | **61/61 (100%)** | 74% | 43% | crate for compile, file for runtime |

What it does *not* show is covered in "Where it falls short" below. The main gaps:
- **Small and synthetic:** the projects and mutations are small and synthetic, and the tests are
  deterministic.
- **Wall-clock savings are small** because tool startup dominates suites this size.
- **Dependency installs and environment variables** need extra handling that this prototype does not
  implement.

---

## 1. Method

### Tracing

Each test file runs as its own process tree under
`strace -f -ff --seccomp-bpf -qq -y -e trace=%file,%process,chdir,fchdir` inside a Linux container
(`harness/trace.py`). The parser walks every process's log and records, **per test file and per
phase**, three sets of repo paths:

| Set | From | Why |
|---|---|---|
| `reads` | successful `openat` (read modes), `stat`/`statx`/`newfstatat`, `access`, `readlink`, `execve` | A change to anything read or even stat'ed can change behaviour. Build caches decide freshness by stat or by hashing, so stat matters |
| `probes` | the same calls failing with `ENOENT`/`ENOTDIR` | **Negative dependencies**: a test that looked for `conftest.py`, `node_modules/x` or `build.rs` and found nothing is affected when the bean *adds* one |
| `dirs` | directories opened with `O_DIRECTORY` (listings) | Adding or deleting a file in a listed directory can change behaviour, through import scanning, globbing or test discovery |

Details:
- **Phases:** a process's phase comes from the executable it runs: `javac` vs `java`, the `*.test`
  binary vs `go`/`compile`/`vet`, `target/debug/deps/*` vs `cargo`/`rustc`. Python and TS have only
  a `run` phase.
- **Path resolution:** `-y` prints each dirfd's path (`AT_FDCWD</p/...>`), so relative paths resolve
  without tracking every `chdir`.
- **Noise filter:** only paths inside the repo are kept, so system libraries, toolchains, `/tmp` and
  the Go/Cargo caches are dropped. Repo build outputs are dropped too (`target/`, `.pytest_cache`), or
  mapped back to sources (below).

**One process per test file is required for attribution.** Every runtime caches loaded modules:
`sys.modules`, the ESM loader, JVM class loaders, a compiled Go test binary. So the second test in a
shared process does not re-read what the first one loaded.

### Selection rule (`select()` in `harness/ti.py`)

Given the bean's changed files, each tagged M (modified), A (added) or D (deleted), select test file `T`
when any of these holds:

1. `T` itself is new or changed (the bean's own tests).
2. `T` has **no map entry** (it has never been traced). It runs and is mapped by that run.
3. An **M** file is in `T`'s reads or probes.
4. A **D** file is in `T`'s reads, or its directory is in `T`'s listed dirs.
5. An **A** file, or any of its missing ancestor directories, is in `T`'s probes, or lands in a
   directory `T` listed.

Nothing else is run.

**Why this is sound (for deterministic tests).** A deterministic process's behaviour is a function of
its inputs. If the mutated run differs from the traced base run, there is a first point where they
diverge. Up to that point both runs made the same syscalls, so the input that differed was read, or
probed, or listed, in the *base* run too. The base map therefore contains it. This holds even when the
change makes the test read files it never read before, for example a config value that loads a
different plugin, because the config file itself was read. It also holds for multi-file changes. The
mutation results are the empirical check of this argument.

### Language specifics

| Language | Handling | Granularity |
|---|---|---|
| **Python** | Runs `pytest tests/x.py` per file. Bytecode caching: the import system `stat`s the source `.py` before it opens `__pycache__/*.pyc`, so sources appear even when bytecode is cached. `.pyc` paths are mapped back to their source. A run with the bytecode cache on (`results/python-pyc`) gave the same map, apart from a stat of the `tests/__pycache__` directory itself. Dynamic `importlib.import_module(name_from_config)` is captured because it is exercised at run time. | File |
| **TypeScript** | `node --test test/x.test.ts` with Node 24 native type stripping (no build step). Node module resolution is captured as successful stats and failed probes up the `node_modules` chain. The workspace package `@shop/utils` is a symlink, `node_modules/@shop/utils -> packages/utils`, and both the raw and the realpath'd paths are recorded. Dynamic `await import()` of plugins is covered. | File |
| **Java** | Per test class: `javac -sourcepath src/main/java:src/test/java -d out/<test> FooTest.java`, which **implicitly compiles exactly the compile-time closure of that test**, then the JUnit console launcher. The compile phase records every `.java` file javac parsed. The run phase records `.class` loads, mapped back to their source through the class file's `SourceFile` attribute (`langs._java_source_of`), plus resources from the classpath. | File (class) |
| **Go** | `go test -count=1 ./pkg -run '^(TestA\|TestB)$'` with the Test functions declared in that file. **No cache disabling is needed:** even with a warm build cache, the `go` command opens and hashes every source file in the import graph to compute action IDs, so the build phase lists them all. `//go:embed tax.json` appears as a build-phase read. `-count=1` disables the test-result cache. | Package for compile, file for runtime reads |
| **Rust** | `cargo test -p <crate> --test <file>`. With a warm `target/`, cargo `stat`s every path in each unit's dep-info to check fingerprints, so the build phase lists every source of every crate in the dependency graph, including `include_str!` files. Per-file attribution is impossible because a crate is one compilation unit, so granularity is the crate. Runtime data files are per test. | Crate for compile, file for runtime |

### The five projects (`projects/<lang>/`)

There is one domain, a small shop, ported faithfully to each language with the same numbers and the
same 49 assertions. The modules are:
- money and currency (reads `rates.csv`), ids, string and validation utils, config (reads
  `app.json`, `.properties` or `.toml`);
- catalog (reads `catalog.csv`) and inventory;
- cart, discounts, coupons, tax and pricing;
- shipping (reads shipping zones), orders, events, storage, payments, invoice and reports;
- fee plugins selected by name from config.

Each project also has a shared test helper (factories), a fixture file read by tests, 16–18 test files
and 23–35 source files. Deliberate language features:

| Language | Deliberate features |
|---|---|
| Python | `conftest.py`, `pyproject.toml` pytest config, `importlib` plugin loading |
| TypeScript | workspace package with an `exports` map behind a symlink, dynamic `import()` |
| Java | `shop.core.Limits` with `static final int` constants that javac **inlines** into user classes |
| Go | 26 packages, `go:embed`, `init()`-registered plugins, external `_test` packages, `testdata/` |
| Rust | 9-crate workspace, a dev-dependency test-kit crate, `include_str!`, no external crates |

### Mutations and ground truth (`harness/mutate.py`, `harness/ti.py`)

There are 68–72 seeded mutations per language:

| Kind | Count | What it does |
|---|---|---|
| Single-file code edits | 36 | change a number (n→n+1), change a string literal, flip a comparison, flip `+`/`-`, flip a boolean, **rename a function at its definition** (callers break), return null/undefined |
| Shared-helper edits | 5 | edit the shared test helper |
| Data/fixture edits | 8 | |
| Config edits | 2–5 | |
| Test-file edits | 2 | |
| File deletions | 2 | |
| File additions | 1–2 | *shadowing* files, listed below |
| Multi-file | 12 | two or three of the above together |

The file additions are:
- **Python:** a new package directory `shop/core/money/__init__.py` that shadows `money.py`, and a
  root `conftest.py`.
- **TypeScript:** a nearer `src/node_modules/@shop/utils`.
- **Java:** `src/test/resources/app.properties`, which shadows the main config by classpath order.
- **Go:** a new file in the `money` package whose `init()` panics.
- **Rust:** a new `build.rs`, which cargo auto-detects.

For each mutation the harness does four things:
1. Computes the selection from the base map.
2. Runs the selection as one invocation (timed).
3. Runs the full suite as one invocation (timed). For Go and Rust the mutated files are re-touched
   in between, so both runs pay the recompile.
4. For **evaluation only**, runs every test file on its own. A test file is "failing" if its own run
   (including its own compile) fails.

Safety means every failing test file was in the selection.

---

## 2. Results

All five ran in Docker on an Apple-silicon Mac (linux/arm64 images; see the caveat about amd64 below).
Wall times in the summary were measured with all five language containers running at once. The overhead
table comes from a later quiet run, one language at a time. The raw data is in `results/<lang>/`
(`results.json`, `map.json`, `log.txt`).

### Summary

| Language | Test files | Mutations | Breaking | Safety (breaking) | Selected (all) | Selected (breaking) | Actually failing | Wall time: selected vs full suite | Test work saved | Granularity |
|---|---|---|---|---|---|---|---|---|---|---|
| python | 16 | 72 | 59 | **59/59 (100%)** | 45% (median 31%) | 42% | 20% | 37s vs 40s (**7% saved**) | 55% | file (module) |
| ts | 16 | 71 | 59 | **59/59 (100%)** | 34% (median 31%) | 35% | 20% | 26s vs 45s (**43% saved**) | 66% | file (module) |
| java | 16 | 68 | 57 | **57/57 (100%)** | 58% (median 56%) | 59% | 27% | 96s vs 95s (**-1% saved**) | 40% | file (class, compile closure + class loads) |
| go | 18 | 71 | 62 | **62/62 (100%)** | 37% (median 44%) | 38% | 26% | 28s vs 53s (**47% saved**) | 64% | package (compile), file (runtime reads) |
| rust | 16 | 71 | 61 | **61/61 (100%)** | 72% (median 81%) | 74% | 43% | 53s vs 68s (**22% saved**) | 29% | crate (compile), file (runtime reads) |

How to read the columns:
- **Wall time** sums one-invocation runs over all mutations, compile included.
- **Test work saved** is 1 − (Σ isolated run time of the selected files ÷ Σ of all files). It is
  the better guide for real suites, where test execution, not tool startup, dominates.
- **Python wall time:** pytest's ~0.2 s startup is most of a 0.2–0.4 s suite.
- **Java wall time:** each selected run pays javac and JVM startup (~1 s). The full run pays it once
  too, so at this size selection saves nothing in wall time.
- **Agreement with the full suite:** across all 353 mutations, the selected run's exit status agreed
  with the full suite's. It never passed when the full suite failed, nor the reverse. The per-file
  ground truth also agreed with the full-suite verdict every time.

### Safety by mutation kind (total / breaking / safe)

| Language | code | helper | data | config | test-edit | delete | add | multi |
|---|---|---|---|---|---|---|---|---|
| python | 36/30/30 | 5/4/4 | 8/6/6 | 5/3/3 | 2/0/0 | 2/2/2 | 2/2/2 | 12/12/12 |
| ts | 36/30/30 | 5/5/5 | 8/4/4 | 5/3/3 | 2/2/2 | 2/2/2 | 1/1/1 | 12/12/12 |
| java | 36/30/30 | 5/5/5 | 8/6/6 | 2/1/1 | 2/2/2 | 2/2/2 | 1/1/1 | 12/10/10 |
| go | 36/31/31 | 5/5/5 | 8/5/5 | 5/5/5 | 2/1/1 | 2/2/2 | 1/1/1 | 12/12/12 |
| rust | 36/31/31 | 5/4/4 | 8/6/6 | 5/4/4 | 2/1/1 | 2/2/2 | 1/1/1 | 12/12/12 |

### Ablation: why the compiler must be traced, and the runtime too

| Language | Map built from | Safe (breaking) | Mean selected | What it misses |
|---|---|---|---|---|
| java | runtime class loads only | 47/57 | 34% | inlined constants (`Limits.java`: no class load ever happens); renames and deletes in classes a test *compiles against* but never loads at runtime |
| java | compiler reads only | 46/57 | 52% | data, config and fixture resources read at runtime; the shadowing `app.properties` |
| go | test binary only | 12/62 | 7% | nearly all code changes: the code is compiled into the binary, so nothing is read at runtime |
| go | `go`/compiler only | 54/62 | 32% | `data/*.json`, `config/app.json` and `testdata`, all read at runtime |
| rust | test binary only | 8/61 | 4% | code changes (same reason as Go) |
| rust | cargo/rustc only | 55/61 | 69% | runtime data and fixture files |

A trace of either phase alone is unsafe in every compiled language. The union of the two phases was
safe in all 180 breaking compiled-language mutations. For Java, the class-level dependency tools
(jdeps, class-load tracing, coverage) all miss the inlined-constant case, which is why the compiler's
reads are needed. In the freshness run, `IdsEventsStorageTest` and `OrdersTest` have `Limits.java` in
their compile-phase reads and not in their runtime reads.

### Misses, and how each was closed

The final run had **no misses**. The first run had **one**, kept in `results/v1-rule/`:

| Language | Mutation | Failing, not selected | Cause | Fix (no fallback) |
|---|---|---|---|---|
| python | add `src/shop/core/money/__init__.py` (a package dir shadowing `money.py`) | 13 of 16 | Python's `FileFinder` caches a `listdir` of `src/shop/core` and never stats `money/`, so the only evidence is the **directory listing**. The trace had it (`src/shop/core` was in every importing test's `dirs`), but the v1 rule only checked whether the *added file's own parent* (`src/shop/core/money`, which did not exist) was listed | When a file is added, all of its missing ancestors are created too. The rule now selects if any created path's parent was listed or any created path was probed. Re-run: 59/59 |

That miss is the useful lesson. The *recording* side was complete in every case. The places to be
careful are the **semantics of absent files**: probes, listings and new ancestor directories.

### Overhead (quiet machine, one language at a time)

| Language | Per-file runs untraced (sum) | Per-file runs traced (sum) | Ratio | Full suite | Full suite traced | Ratio | Mean repo files read per test file |
|---|---|---|---|---|---|---|---|
| python | 2.0s | 3.8s | **1.92x** | 0.18s | 0.32s | 1.79x | 44 |
| ts | 1.2s | 1.9s | **1.58x** | 0.12s | 0.22s | 1.84x | 25 |
| java | 9.8s | 14.9s | **1.52x** | 0.78s | 1.50s | 1.92x | 53 |
| go | 2.1s | 6.0s | **2.82x** | 0.32s | 0.73s | 2.26x | 26 |
| rust | 0.8s | 2.0s | **2.63x** | 0.22s | 0.84s | 3.74x | 53 |

- **Where the time goes:** the cost falls on file syscalls, of which toolchains make a great many.
  `go` hashes the standard library and cargo stats every dep-info path. `--seccomp-bpf` already avoids
  stopping on other syscalls. The ratios are against tiny runs that are mostly startup, so on suites
  that spend their time computing, the relative cost would be much lower. These numbers are an upper
  bound.
- **Parse cost:** the Python log parse after each traced run is not included above. An eBPF
  collector that filters in the kernel would mostly remove it.
- **Map size:** maps are small: 28–80 KB per repo for four of the languages. Java's is 2 MB, because
  javac probes every `java/lang/*` name on the source path, and those ENOENT probes could be pruned or
  compressed.

### Freshness (`freshness()` in `harness/ti.py`)

| Language | New test selected with no map | Ran traced, then mapped | Changing its dependency selects it / it fails | Existing test edited to use a new module: module in map before → after | Changing that module then selects it / it fails |
|---|---|---|---|---|---|
| python | yes | yes (34 files) | yes / yes | no → yes | yes / yes |
| ts | yes | yes (13 files) | yes / yes | no → yes | yes / yes |
| java | yes | yes (32 files) | yes / yes | already: javac stats every file of an imported package (`shop.core`) | yes / yes |
| go | yes | yes (13 files) | yes / yes | no → yes (added `ids` import) | yes / yes |
| rust | yes | yes (59 files) | yes / yes | already (crate granularity) | yes / yes |

The map updates as a side effect of running a test: whatever ran traced replaces its entry. A test with
no entry is always selected, and the run that selects it is the run that maps it.

### Where it falls short (honest list)

1. **Scale:** these are 16–18 test-file projects with 49 tests each, and the mutations are synthetic
   operators. This is evidence for the mechanism, not a production benchmark. A real repo should be
   replayed next, with its real history as the change sets and its real flaky tests.
2. **Over-selection:** the map records what a test *loaded*, not what it *executed*. A Python test
   that imports `pricing` loads `plugins`, `shipping`, `tax` and the rest. javac stats every source
   file in each package it resolves names from: `PaymentsTest` "reads" all of `shop/core/*.java`.
   Selection relative to the failing set is 2.1x for Python, 1.75x for TS, 1.5x for Go and 2.2x for
   Java. Rust is at crate granularity: changing
   `shop-core` selects 13 of 16 targets. Finer granularity needs coverage data, which is not a sound
   source of compile-time effects, so the safe answer is to keep file and crate reads and accept the
   over-selection.
3. **Wall-clock savings are small at this size:** startup (pytest, JVM plus javac, cargo) dominates.
   Savings track the "test work" column only when tests do real work.
4. **Java needs a per-test compile:** file-level Java selection relies on compiling each test's
   closure with `javac -sourcepath`. Under a stock Maven or Gradle module build, a compile error
   anywhere fails every test, so the honest granularity there is the module. Reflection
   (`Class.forName`, ServiceLoader, Spring) is not exercised here. Its class loads would appear in
   the run phase, but implicit compilation would not compile those classes, so a reflection-heavy
   module needs its main sources compiled as a whole.
5. **Inputs that are not files are not recorded:**
   - **Environment variables:** `getenv` is a userspace read, invisible to syscall tracing. A bean
     cannot change the runner's environment, but files that *set* environment variables can
     (`.env`, `.cargo/config.toml [env]`, `pytest.ini env=`). Those are files the tool reads, so
     they are captured when the tool reads them itself.
   - **Time, randomness, network and ordering between tests:** none are captured. Tests that depend
     on them are flaky regardless of selection.
   - **Closing the environment gap:** record the environment (and the image digest) as a key of the
     map. A change of image or toolchain is a change to an input of every test, so every test is
     re-traced. That is a re-map, not a safety fallback.
6. **Dependency installs are not covered yet:** tracing drops paths outside the repo, such as
   `site-packages`, `~/go/pkg/mod` and `~/.cargo/registry`. Go and Rust are safe anyway: `go.mod`,
   `go.sum`, `Cargo.toml` and `Cargo.lock` are read by the build, so changing them selects every test
   in that module (coarse but correct). **Python's `requirements.txt` and npm's lockfile are not read
   at test time,** so a bean that bumps a dependency would select nothing.
   - **Fix:** keep the install trees in the map (do not filter `site-packages` or `node_modules`),
     and add the files that changed in the install step's output tree to the bean's change set.
   - **Status:** not implemented here.
7. **Processes outside the traced tree:** strace follows only the process tree. A Gradle daemon, the
   Kotlin compile daemon, sccache, a test database or `docker compose` services do their reads in
   another tree. Run with `--no-daemon`, or trace by cgroup (eBPF, below).
8. **Caches that skip the read:** this works because the `go` command hashes sources, cargo stats
   them, and Python stats `.py` before using its `.pyc`. A tool that trusts a cache without touching
   the inputs hides them: unchecked hash-based `.pyc`, a remote build cache, Turbo/Nx cache hits. The
   rule is to trace from a state where the tool must consult its inputs, or to treat the cache key's
   inputs as dependencies.
9. **amd64 not run:** the runner image is linux/amd64. These runs were linux/arm64, where all file
   syscalls are `*at` variants. On amd64, `open`/`stat` without a dirfd also appear. The parser
   resolves those against the last known working directory, from `AT_FDCWD<...>` annotations and
   `chdir`, but that path is untested.
10. **Coarse listing rule:** in Python, `tests/` is on `sys.path` and gets listed, so *adding* any
    file in `tests/` selects every test. This is conservative and correct, but coarse.

---

## 3. Recommendation for the runner container

**Mechanism: strace now, eBPF when the platform allows it, not fanotify.**

| | strace `--seccomp-bpf` | fanotify | eBPF (syscall tracepoints, cgroup-filtered) |
|---|---|---|---|
| Privileges | **none extra**: worked in a default Docker container | `CAP_SYS_ADMIN`: `fanotify_init` returns EPERM in a default container (tested) | `CAP_BPF` + `CAP_PERFMON` (or privileged) |
| Sees failed lookups (ENOENT probes) | yes | **no**: events exist only for existing files | yes |
| Sees `stat` (cargo fingerprints, pyc checks) | yes | **no**: only open, access, modify and close | yes |
| Daemons outside the process tree | no | yes (mount-wide) | yes (cgroup-wide) |
| Overhead here | 1.5–2.8x on tiny runs | low | low (in-kernel filtering) |

- **Why not fanotify:** it cannot see the two kinds of evidence this experiment needed most:
  negative lookups (needed for the added-file cases) and stat-only freshness checks (needed for all of
  Rust's compile-time mapping).
- **eBPF:** it is the right long-term collector, but Cloudflare Containers' VM may not grant BPF. Check
  that before building on it.
- **LD_PRELOAD interposition:** this fails for statically linked Go binaries and raw syscalls.
- **strace today:** it is in Debian, works unprivileged, and matches what was measured here. The
  runner image only adds `strace` and the parser.

**Map storage per repo:**
- **Key:** a map is keyed by `(repo, toolchain/image digest, test file)`.
- **Record:** each test file's record holds the `reads`, `probes` and `dirs` per phase, the commit it
  was traced at, and the content hash of each read file, so a stale record is detectable.
- **Index:** keep an inverted index `path → test files` in the repo's Durable Object (SQLite: one row
  per path and test file, about 25–150 rows per test file, as here). Put full trace blobs in R2 if
  they are wanted for debugging.
- **New image or toolchain:** the key changes, so the first run re-traces everything. That run
  re-maps the repo; it is not a safety fallback.

**Pre-land check (sprout + bean):**
1. Diff the merged tree against the sprout to get M, A and D files. A rename is a delete plus an add,
   and dependency-install outputs are included (item 6 above).
2. Select tests from the map at the sprout with the rule above, plus the bean's own new or changed
   tests and any unmapped tests.
3. Run the selection **traced**. Attribution needs one process per test file:
   - `node --test` already forks one process per file, and Go builds one binary per package.
   - Cargo builds one binary per test target.
   - pytest needs one process per file (or `--forked`-style isolation).
   - JUnit needs surefire-style `reuseForks=false`, or the per-class launch used here.
4. Store the new records against the bean's commit, and promote them when the bean lands.

The decision card can then say "ran 6 of 16 test files; the other 10 never read any changed file".
That is a checkable claim, not a heuristic.

**Stalk validation:** run the selection for `stalk..sprout`, the union of the landed beans' change
sets, against the stalk's map. This keeps the stalk gate as strict as the pre-land check without
running everything. Separately, a **scheduled full traced run** (nightly, for example) does two jobs.
It refreshes every map entry, including tests no bean touched. It also acts as an ongoing audit: any
test that fails there without having been selected by any landed bean is a recorded miss to
investigate. It does not gate landing, so it is an audit, not a fallback.

---

## 4. Reproduce

```sh
cd research/test-impact
docker/build.sh                                   # five images: ti-python, ti-node, ti-java, ti-go, ti-rust
./run.sh python                                   # also: ts, java, go, rust (about 3-15 min each)
./run.sh go --skip-mutations --tag=-overhead      # quiet overhead pass
python3 harness/report.py > results/tables.md     # the tables above
```

| Path | Contents |
|---|---|
| `harness/trace.py` | strace runner and parser (process tree, phases, reads, probes, dirs) |
| `harness/langs.py` | per-language adapters: units, commands, phase classifier, path normalisation (pyc → py, class → source), file-adding mutations, freshness scenario |
| `harness/mutate.py` | seeded mutation generator, apply and revert |
| `harness/ti.py` | experiment driver: map, overhead, mutations with selection and ground truth, freshness |
| `harness/report.py` | aggregates `results/*/results.json` into the tables |
| `docker/*.Dockerfile`, `docker/build.sh` | tracing images (official language images plus `strace` and `python3`) |
| `projects/{python,ts,java,go,rust}` | the five ported projects |
| `results/<lang>/` | final run: `map.json`, `results.json`, `log.txt` |
| `results/<lang>-overhead/`, `results/python-pyc/` | quiet overhead pass; bytecode-cache-on mapping |
| `results/v1-rule/` | first run with the v1 added-file rule (the one miss) |

---

## 5. Read maps in the runner

The prototype's method now runs in Beanstalk's runner container and its maps live in each run's
RunDO (2026-10-07). Code: `packages/gateway/container/src/check/trace/` (strace wrapper, log parser, path
attribution), `per_file.rs`, `discover.rs`, `tree.rs`; `packages/gateway/src/read-maps/` (store and
selection rule); contract in `packages/gateway/container/README.md` ("Read maps") and
`packages/gateway/README.md` ("Read maps in the runner").

**What the runner does.** A check with `trace: true` lists the suite's test files with node's own
`fs.globSync` (the command's patterns, or node's defaults; extglobs such as fastify's
`test/!(listen.5).test.js` behave exactly as in the suite), runs each file in its own process tree
under `strace -f -ff --seccomp-bpf -y -e trace=%file,%process,chdir,fchdir` (strace wraps
bubblewrap, so a traced file gets the same loopback-only network), parses the per-process logs
(a Rust port of `harness/trace.py`), and reports per file: pass/fail, checkout-relative `reads`,
`probes` (ENOENT/ENOTDIR lookups), `dirs` (listings), `packages` (anything under
`node_modules/<pkg>`, in the checkout or in the dependency snapshot linked above it, collapses to the
package), and the blob id of every read file. The check also returns the tree's manifest
(`git ls-tree`, extra files hashed). The per-file results fold into the normal report, so the engine
sees the same green/red, failing files and read sets. `only_files` runs a chosen set of files
(affected-tests validation), traced or not. Untraced full-suite checks are unchanged. strace needs
no extra privileges: it works in a default Docker container and in Cloudflare's standard-2
containers (staging, below).

**What the gateway does.** Pre-land checks are traced under the run config `read_maps: preland`;
every other check reports its tree's manifest. Maps are stored per (traced tree, test file); the
engine asks `EngineEnv.readMaps.affectedTests({changes, base, mapsFrom?, tests?})`, which applies
`select()` from §1 plus three safety rules: a test file with no map is affected (`unmapped`); a map
from another toolchain, or traced on a tree that differs from `base` in a path the map observed
(compared through both trees' manifests), or with either manifest unknown, is `stale` and affected;
a lockfile or `package.json` change affects every test that loaded a package or looked for one
(the gap in §2 item 6, closed conservatively).

### Overhead

Local, Docker on Apple silicon, one CPU (`--cpus=1`, like Cloudflare's standard-2), release runner
over HTTP, same commit; `runner/measure.py`, raw in `results/runner-overhead-*.json`:

| Suite | Test files | Untraced suite (one node process) | Traced, one process per file | Ratio | Mean repo reads / probes / packages per file | Map size |
|---|---|---|---|---|---|---|
| Shop arena (`research/arena`, 80 tests) | 20 | 2.4–3.0 s | 5.6–5.9 s | **2.0x** | 44 / 10 / 0 | 78 KB |
| fastify (`research/real-arena/fastify`, 2,069 tests, loopback only) | 184 | 108.6 s, 96.6 s | 123.4 s, 109.2 s | **1.13x** | 32 / 26 / 32 | 792 KB |

- **Where the shop's 2x goes:** per-file processes alone cost 1.4x (4.1 s for the 20 files run one by
  one, untraced) and strace another 1.4x. A suite this small is mostly node startup.
- **fastify:** a suite that spends its time testing pays little, as §2 predicted. Both runs had the same
  verdict (one file, `test/build/error-serializer.test.js`, fails in this container with or without
  tracing).
- **Staging** (`beanstalk-gateway-staging`, standard-2, replay race `research/race/runs/staging-readmaps-replay-8-s7-r2`,
  8 agents, 40 tasks): traced pre-land checks took a median 16.7 s suite time (p90 51 s, 61 checks)
  against 11.7 s for the same run's untraced validations (18) and 9.2–9.6 s for untraced pre-land checks
  in earlier standard-2 staging replays: **1.4–1.8x** with eight sandboxes busy at once.

**When to trace (proposal).** Trace every pre-land check: they run in the agents' sandboxes, off the CI
slots, so the overhead delays only the bean being checked and the maps stay fresh for free (each bean's
check maps its own merged tree). Keep validations, bisect probes and the final check untraced; they only
report their tree's manifest, so maps from bean trees can be compared with the validated sprout. That is
`read_maps: preland`. Use `all` for a periodic full traced run (the audit of §3). On suites dominated by
startup (the shop), a traced check costs about twice an untraced one; on real suites, about 1.1x.

### Staging race and mutation spot-check

The replay race (`staging-readmaps-replay-8-s7-r2`, run `umtpy30wkb`) landed 26 of 40 tasks with a correct
final green; every drop was a replay limitation. The store collected **3,665 maps of 63 test files on 50
traced trees, plus 127 manifests**. (The first attempt, `staging-readmaps-replay-8-s7`, lost 30 beans to
`runner_version_mismatch`: another agent's deploy, and then the gradual container rollout, left instances on
other images mid-run.)

**Spot-check** (`runner/spotcheck.py`, `results/runner-spotcheck.json`): a traced tree of that run was
rebuilt locally from its manifest (objects of the arena repo and the agents' clones), 20 seeded mutations
were applied (numbers, comparisons, strings, renamed exports, a deleted module, an added `package.json` that
shadows a directory's module type, an unrelated doc), the store chose the tests (`mapsFrom` and `base` = that
tree), and every one of the 47 test files ran on its own against each mutant:

| Mutations | Breaking | **Caught** | Selected, mean (breaking) | Actually failing (breaking) |
|---|---|---|---|---|
| 20 | 15 | **15/15** | 74% (83%) | 45% |

Selection is coarse on this arena because most tests build the whole app through `createTestApp()`, so
they load nearly every module (as §2 item 2 says, the map records what a test loads, not what it executes).
Two mutations selected nothing and broke nothing: an unrelated doc, and an edit to `src/types.ts`, which no
test loads (type-only imports are erased by type stripping).

**Store answers** (`results/runner-store-answers.json`, same tree T): one landed source file
(`src/shipping/rates.ts`) affects 38 of 47 files (reason `read`); a docs edit plus a new test file affects
only the new file (`own-change`); a type-only module affects none; each file's newest map compared against T
marks 56 of 63 `stale` (most maps were traced on trees that differ from T in a file every app test loads),
so affected validation on this arena gains little until maps are traced on the validated line itself.

### Evidence promotion on traced read sets (staging A/B, seeds 7/11/13)

The engine's event-driven promotion (`packages/gateway/src/engine/v2/v2-evidence.ts`,
`docs/claude-opus/11-experiments-summary.md`, "Event-driven promotion") only accepts read sets the runner marks
complete. A traced check with `all_read_sets` now reports each passing test's observed read set (the file,
every path read or probed, listed directories and loaded packages as `dir/` entries), `passing_files` and
`failing_files` from the per-file runs, and `read_sets_complete: true` only when every file that ran was traced.
Under `read_maps: preland` the gateway traces every check that asks for read sets.

Replay races on a separate stack (`beanstalk-gateway-staging-rm`, standard-4 runners, Artifacts namespace
`beanstalk-race-staging-rm`), `--preset demo`, 8 agents, 2 CI slots, `ci_seconds` 60, `--preland-seconds 30`,
optimistic pre-land checks; the evidence arm adds `evidence_promotion`, `affected_validation`, `audit_every: 4`,
`evidence_read_sets: complete` and `read_maps: preland` (`runner/ab_table.py`; runs `research/race/runs/rm-evp-*`):

| Run | green | k10 | k20 | k25 | done (min) | window waits | validations (green/red) | CI runs / min | evidence promotions / affected / refusals / audits (red) | correct |
|---|---|---|---|---|---|---|---|---|---|---|
| demo s7 | 25 | 3.3 | 4.7 | 7.0 | 7.9 | 11 | 6 / 0 | 9 / 8.4 | - | True |
| evidence s7 | 25 | 2.9 | 4.9 | 7.3 | 7.4 | 0 | 8 / 0 | 11 / 9.9 | 8 / 9 / 9 / 2 (0) | True |
| demo s11 | 24 | 3.3 | 4.8 | - | 7.0 | 6 | 6 / 0 | 7 / 7.0 | - | True |
| evidence s11 | 24 | 3.7 | 6.8 | - | 7.7 | 1 | 9 / 0 | 12 / 9.5 | 9 / 11 / 11 / 1 (0) | True |
| demo s13 | 24 | 3.9 | 6.1 | - | 8.1 | 6 | 7 / 0 | 10 / 9.4 | - | True |
| evidence s13 | 24 | 2.9 | 5.6 | - | 9.4 | 0 | 6 / 0 | 9 / 7.8 | 6 / 8 / 8 / 1 (0) | True |

- **Evidence now works on staging:** 23 promotions in three races (the static import closures promoted none),
  window waits 23 → 1, no audit red, every final green correct. Every refusal was `affected`: the commit ran an
  affected validation instead.
- **It does not yet pay on this arena:** k20 and done are mixed (done 7.4/7.7/9.4 vs 7.9/7.0/8.1 min) and CI minutes
  rise slightly (9.1 vs 8.3 mean), because nearly every shop test loads the whole app through `createTestApp()`,
  so affected validations run most of the suite, and the audits add full runs (the spot-check above found the
  same: 74% of tests selected).
- **Tracing cost in these runs** (standard-4): pre-land suite median 3.7 s traced vs 2.3 s untraced (1.6x, p90 7.8
  vs 4.5 s); CI suite median 3.9 vs 3.0 s.

**30 agents** (same settings, `--agents 30`; runs `research/race/runs/rm-evp-*-30-s*`; "affected share" is the mean
share of the tree's tests an affected validation ran):

| Run | green | k10 | k20 | k25 | done (min) | window waits | validations (green/red) | CI runs / min | evidence promotions / affected / refusals / audits (red) | affected share | correct |
|---|---|---|---|---|---|---|---|---|---|---|---|
| demo s7 | 24 | 3.1 | 5.0 | - | 7.9 | 10 | 5 / 0 | 10 / 8.5 | - | - | True |
| evidence s7 | 26 | 3.9 | 5.2 | 8.4 | 10.9 | 9 | 11 / 0 | 14 / 12.6 | 11 / 12 / 12 / 2 (0) | 80% (0 with no CI) | True |
| demo s11 | 24 | 4.0 | 5.2 | - | 7.7 | 4 | 7 / 0 | 10 / 9.5 | - | - | True |
| evidence s11 | 24 | 2.6 | 3.8 | - | 6.7 | 2 | 6 / 0 | 10 / 7.3 | 6 / 9 / 9 / 1 (0) | 80% (0 with no CI) | True |
| demo s13 | 24 | 3.3 | 5.4 | - | 9.1 | 13 | 7 / 0 | 9 / 8.7 | - | - | True |
| evidence s13 | 24 | 3.6 | 4.7 | - | 8.4 | 1 | 7 / 0 | 9 / 7.6 | 7 / 8 / 8 / 1 (0) | 79% (0 with no CI) | True |

- **Means over the three seeds:** k20 5.2 → 4.6 min, done 8.2 → 8.7 min (seed 7's evidence arm landed 26 tasks
  against 24 and ran longer; seeds 11 and 13 finished 1.0 and 0.7 min sooner), window waits 27 → 12, CI minutes
  8.9 → 9.2, 24 promotions, 0 audit reds, all correct.
- **Why the gain stays small here:** no promotion was free. Every one followed an affected validation that ran
  about 80% of the tests, because nearly every shop test loads the whole app. Evidence removes the window waits,
  but the affected validations still cost most of a full run. Suites whose tests read narrow slices of the code
  (fastify: 32 repo reads per file) are where it should pay; that A/B is with another agent.

### What remains

- The engine's evidence rule uses the per-check read sets (above); `EngineEnv.readMaps` (the stored maps across
  trees) is there for rules that need maps from other checks (gateway README).
- Paths outside the repo and outside dependency packages are dropped, so a test that reads a file the
  bean cannot change is unaffected by it, which is correct; environment variables are keyed only through
  the `environment` string (node version and runner image).
- fastify on staging was not raced traced: the real-arena runs moved to standard-4 live instances while
  this was built; its numbers above are local.
