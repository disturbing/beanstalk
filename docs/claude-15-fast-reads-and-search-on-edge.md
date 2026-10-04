# Fast reads and code search on the edge

Written 2026-10-03 for beanstalk. Scope: how an agent that works through MCP instead of a local clone gets reads and search close to local-disk speed. Platform facts carry URLs; numbers marked "estimate" are mine; "unverified" means I could not confirm it.

## Summary of the recommendation

1. Index content, not commits: every blob is fetched from Artifacts once, keyed by its git hash, and stored in a per-project `CodeIndex` Durable Object (DO SQLite). Trunk, sprouts and worlds share it.
2. Git trees are the Merkle tree. A push costs one `readCommit` plus one `readTree` per changed directory plus one `readBlob` per new blob; a 5-file bean is about 15 Artifacts calls, against a 2,000 per 10 s limit.
3. Agent reads never touch Artifacts for indexed commits; Artifacts traffic scales with pushes, not with the number of reading agents.
4. Search tier 1 is brute force in the DO with Rust `regex` compiled to Wasm (linear time, ripgrep's engine). Up to about 50 MB of source this beats any index and is the demo cut.
5. Tier 2, behind a size flag, adds an FTS5 trigram table as a candidate filter (literals extracted by `regex-syntax`), sharded across DOs by blob hash above about 200 MB.
6. A sprout's view is trunk index plus an overlay of changed paths, computed by tree diff with cached trees; forks start with an empty overlay and cost zero calls.
7. Every result carries `commit`, `indexed_commit` and `index_state`; an unindexed SHA is built on demand when the diff is under 300 calls, otherwise the call answers from the nearest root and says so.
8. Semantic search is Vectorize plus `@cf/baai/bge-m3`, trunk and worlds only, chunk ids keyed by blob hash; about $3 to embed 1 GB once. It serves the canvas first, agents second.
9. A Rust container (`grepd`, bare clone plus `git grep`) is the escape hatch for 1 GB repos, no-literal regex and huge pushes; it is deferred past Oct 14. Remote harness containers keep cloning and use local ripgrep (option D) because they edit anyway.
10. MCP: `repo_grep`, `repo_tree` (with glob), `repo_read_file` (ranges, up to 20 paths), `repo_symbols`, `repo_semantic_search`; results shaped like `rg --json`, capped at about 8k tokens with cursors. Total tool count stays at 30.

## 0. What "parity" means here

Claude Code removed its vector pipeline and uses grep, glob and file reads ("it outperformed everything else by a lot", Boris Cherny, https://officechai.com/ai/claude-researcher-explains-how-agentic-search-performed-better-than-rag-for-code-generation/). Codex CLI is also shell/grep based (unverified from a primary source). Cursor indexes: a Merkle tree of file hashes checked every 10 minutes, AST chunks embedded and stored in Turbopuffer (https://read.engineerscodex.com/p/how-cursor-indexes-codebases-fast), and, separately, a sparse n-gram regex index built on a git commit with local edits "stored as a layer on top of it" (https://cursor.com/blog/fast-regex-search). That last design is ours, moved server-side. Cursor argues regex indexes belong client-side because candidate files must then be scanned locally; for a no-clone agent the files are not local, so the scan belongs next to the index, which is the DO.

The honest comparison is per agent turn, not per syscall. A model turn takes seconds; a 100 ms tool call is a few percent of it. The floor we cannot remove is the MCP round trip (estimate 30 to 50 ms from Virginia: TLS, OAuth check, one DO hop), so the tools are shaped to need fewer calls: grep returns context lines, reads take many paths.

## 1. Targets

Local column: ripgrep on a built Linux kernel checkout on an 8-vCPU EC2 box, 0.33 s literal, 0.58 s no-literal (https://burntsushi.net/ripgrep/); Hono-size numbers are estimates. Hono today: 583 files, 146 directories, 5.0 MB, max depth 6 (counted from the GitHub tree API). "1 GB" means about 80k files and 5k directories (estimate, Linux-like).

| Operation | Local, Hono / 1 GB | Edge p50 target, Hono (MCP call from Virginia) | Edge p50 target, 1 GB | Floor with no index (Artifacts only) |
|---|---|---|---|---|
| Regex with a literal | ~10 ms / 0.35 s | 120 ms | 300 ms (trigram, sharded) | 1 call per dir + per file: ~85k calls, at most 200/s, so at least 425 s |
| Literal | ~10 ms / 0.33 s | 100 ms | 250 ms | same |
| Regex with no literal | ~15 ms / 0.58 s | 150 ms | 1.5 s (16 shards) or 0.6 s (warm grepd) | same |
| Glob | ~5 ms / ~50 ms | 60 ms | 100 ms | ~5k `readTree`, at least 25 s |
| Symbol definition | 10 to 100 ms (LSP) | 80 ms | 100 ms | not possible without parsing every file |
| Symbol references (search-based) | same | 120 ms | 300 ms | same as grep |
| Ranged read, 1 file | <1 ms | 50 ms (colo cache hit) | 50 ms | 1 `readFile`, est. 30 to 60 ms plus MCP |
| Read 20 files in one call | ~2 ms | 90 ms | 90 ms | 20 calls in parallel, est. 100 ms, 20 ops billed |
| Semantic, top 10 | Cursor: few hundred ms (unverified) | 350 ms | 400 ms | n/a |

The last column is the argument for an index: without one, a single repo-wide grep at 1 GB costs more calls than the per-repo rate limit allows in seven minutes.

## 2. Options compared

| | A: DO SQLite, brute force then FTS5 trigram | B: Rust container per hot repo | C: Vectorize + Workers AI | D: no server index, clone everywhere |
|---|---|---|---|---|
| Latency | Hono 100 to 150 ms; 1 GB 250 ms with literals, 1.5 s without | Warm 30 to 600 ms at 1 GB; cold 1 to 3 s start plus clone (1 GB clone time unverified, est. 30 to 90 s) | 250 to 400 ms | Local rg speed after the clone; clone seconds (small) to minutes (1 GB) |
| Freshness | Push to searchable est. 2 to 6 s (queue delivery unverified) | `git fetch` per push, est. 1 to 3 s; any SHA via `git grep <sha>` | Minutes; trunk only | Whatever the agent pulled |
| Cost, one 1 GB repo | Storage 1.5 to 4 GB at $0.20/GB-mo, under $1/mo; build via container (below) | standard-4 idle $0.11/h, $81/mo if always warm; CPU on active use only | $3 build, about $7/mo stored+queried | 1 clone op per agent plus container disk |
| Cost, 10k repos (avg 20 MB) | ~600 GB, about $120/mo; idle DOs cost nothing | standard-1 at $0.074/h, 2 h/day each: about $1,500/day; not viable as default | ~$0.06 per repo to embed; storage within free tier for most | Clone per agent; does not serve canvas or judge |
| Build complexity in 11 days | Brute force: 1.5 days. Trigram: +1 day plus bench. Sharding: +1 day | 3 to 4 days (Rust service, lifecycle, R2 warm start) | 1 day for trunk-only | Zero; already in `claude-13` |
| Failure modes | DO single thread: heavy no-literal regex at 1 GB saturates it; FTS5 index size unknown; 2 MB row limit | Cold start on first query, cost runaway, one more service to page on | Stale vectors, bad chunking, false confidence on "where is" | No-clone agents, canvas and Worker-side planner have nothing |

Container pricing used: vCPU $0.000020/s billed on active use, memory $0.0000025/GiB-s and disk $0.00000007/GB-s provisioned (https://developers.cloudflare.com/containers/pricing/); standard-4 is 4 vCPU/12 GiB/20 GB, standard-1 is 1/2 vCPU/4 GiB/8 GB (https://developers.cloudflare.com/containers/platform/limits/). Idle standard-4: 12 × 0.0000025 + 20 × 0.00000007 = $0.0000314/s = $0.113/h. Busy adds 4 × 0.00002 × 3600 = $0.288/h. Standard-1 provisioned: 4 × 0.0000025 + 8 × 0.00000007 = $0.0000106/s plus half a vCPU when busy; I used the busy figure, $0.074/h.

AI Search was considered and rejected for v1: its sources are built-in upload, website and R2 only, no git (https://developers.cloudflare.com/ai-search/configuration/data-source/), so it would index a mirrored trunk with no commit pinning and no sprout overlay. It remains a one-day fallback for the canvas if C slips.

Verdict: A is the default for everything, C is added for trunk, B is the accelerator for the few big hot repos, D stays the path for harness containers.

## 3. Recommended architecture

```
 agent (Claude Code / Codex / canvas / planner)
        | MCP streamable HTTP + OAuth (claude-06)
        v
 +-------------------- Gateway Worker (Hono) --------------------+
 | auth, per-task budget, colo Cache API blob cache (by hash)    |
 +---------+------------------------------+----------------------+
           | RPC                          | query embed
           v                              v
 +---- CodeIndex DO (1 per project) ---+   Workers AI bge-m3 -> Vectorize
 | trees(hash -> entries)  [mirror]    |        (trunk + worlds, ids = blob:chunk)
 | blobs(hash, text)  2 MB rows, split |
 | roots(ref, commit, tree, state)     |
 | paths(root, path, blob)  trunk      |   >200 MB: IndexShard DOs x N
 | overlay(root, path, blob|NULL)      |---- (blobs + FTS5 by hash prefix)
 | symbols(blob, name, kind, line)     |
 | fts_tri (FTS5 trigram, flag)        |   tree-sitter Workers (per language)
 +-----^---------------------^---------+        parse blob -> symbols
       | readCommit/readTree/readBlob (token bucket 800 / 10 s)
 +-----+-----------+   cf.artifacts.repo.pushed   +---------------------+
 | Artifacts repos |----------------------------->| Queue -> IndexWorker|
 | trunk, sprouts, |                              | (or Workflow)       |
 | worlds          |<-- git clone/fetch (1 op) ---| grepd container     |
 +-----------------+                              | (Rust, deferred)    |
```

The tree mirror is the same cache the overlap engine in `claude-10` needs ("path level in v1 from readTree on both sides ... the hot path"), so the two subsystems share it and each tree object is fetched once per project, ever.

### 3.1 Initial build

From the root tree, BFS: `readTree` every directory, `readBlob` every blob not already stored, skip binaries (NUL in the first 8 KB) and blobs over 1 MB for search (still readable). Hono: 1 `log` + 1 `readCommit` + 146 `readTree` + 583 `readBlob` = 731 calls, inside one 10 s window, $0.11 at $0.15 per 1k if binding reads are billed (unverified, see 6). For more than about 3,000 objects the build switches to a container: one clone (one operation, accounting unverified), the container walks the checkout and streams `(hash, text)` batches to the DO over RPC. 1 GB through the binding would be 85k calls, at least 425 s at the full limit and $12.75; through a clone it is cents.

### 3.2 Incremental update on push

```
on pushed(ref, before, after):
  c = readCommit(after)                     # 1 call
  if c.treeHash == root(ref).tree: done
  diff(old = root(ref).tree, new = c.treeHash):
    if old == new: return                   # shared subtree, 0 calls
    N = trees[new] ?? readTree(new)         # 1 call if not mirrored
    O = trees[old]                          # always mirrored
    for entry in N ∪ O by name:
      tree changed -> recurse
      blob changed -> blobs[hash] ?? readBlob(hash)   # dedup by content
      removed      -> overlay/paths delete
```

Cost = new tree objects + new blob objects + 1. For f changed files at depth up to D the upper bound is f·D + 1 trees plus f blobs; shared ancestors make it far smaller.

| Push | Trees | Blobs | Calls | Share of 2,000 / 10 s |
|---|---|---|---|---|
| Typical bean: 5 files in 3 dirs, Hono depth 4 | root + 3 parents + 3 dirs = 7 | 5 | 13 | 0.65% |
| Worst case same bean, no shared ancestors, D = 6 | 31 | 5 | 37 | 1.9% |
| Refactor: 200 files in 60 dirs of a 1 GB repo | ~90 | 200 | ~291 | 15% |
| 50 agents each pushing a typical bean in the same 10 s | 50 × 13 | | 650 | 33% |
| Formatter over 80k files | 5k | 80k | 85k | not allowed |

The indexer holds a token bucket of 800 calls per 10 s per project (40% of the limit, leaving the rest for git traffic and the lease engine). It stops after 500 calls for one push and hands the push to the clone path (`git fetch`, then a local `git diff --raw before after`, then ship blobs). Multi-commit pushes diff only tip against tip.

### 3.3 Per-sprout overlay

A sprout is a fork; at fork time its tree hash equals trunk's, so its overlay is empty and costs nothing. After pushes, `overlay(root, path, blob|NULL)` holds only paths whose blob differs from the trunk root the index is at. When trunk advances, overlays are recomputed by diffing the sprout tree against the new trunk tree, which hits the mirror for every shared subtree. Blobs for sprouts are fetched lazily on the first query against that sprout: trees are fetched eagerly anyway for overlap detection, but most sprouts belong to harness containers that search locally and never query us. Trunk and world branches are indexed eagerly.

### 3.4 Query serving

The gateway resolves `ref` (branch name, sprout id or SHA) to a root in the CodeIndex DO. A query runs over `paths(trunk_root)` minus overlay paths plus overlay blobs. For each candidate blob the DO runs the Rust `regex` crate compiled to Wasm: same syntax and semantics as ripgrep's default engine, and linear time, so a hostile pattern cannot pin the DO's CPU the way a backtracking JavaScript RegExp could. When `fts_tri` is enabled, `regex-syntax` extracts required literals, each of three or more characters becomes an FTS5 `MATCH` against the trigram table to get candidate blobs, and only those are scanned. SQLite's trigram tokenizer supports substring queries and indexed LIKE/GLOB (https://www.sqlite.org/fts5.html); DO SQLite ships FTS5 (https://developers.cloudflare.com/durable-objects/api/sqlite-storage-api/) but whether the build includes the trigram tokenizer is unverified (it needs SQLite 3.34 or later). DO limits that shape the schema: 2 MB per row, 100 KB per statement, 100 bound parameters, and LIKE/GLOB patterns of at most 50 bytes (https://developers.cloudflare.com/durable-objects/platform/limits/), so globs are matched in the Worker over an in-memory path list, not in SQL.

Unindexed SHA (an agent passes its local HEAD, or an old commit): the DO diffs that commit's tree against the nearest root. Under 300 calls it builds the overlay inline (est. 0.3 to 1.5 s once, then cached) and answers `index_state: "exact"`. Over 300 it answers from the nearest root with `index_state: "approximate"`, `diff_paths_unknown: true` and `retry_after_ms`, and enqueues the build. It never silently answers for a different commit.

Above about 200 MB, blob content and FTS move to N IndexShard DOs by blob-hash prefix (N = size / 64 MB, so 16 at 1 GB); the coordinator fans out, maps blob hits back to paths for the requested root and merges. This splits CPU, which is the real constraint: a single DO is one thread.

## 4. MCP tool surface

`claude-06` lists 27 tools under a 30 cap. This adds three (`repo_grep`, `repo_symbols`, `repo_semantic_search`) and extends two (`repo_tree` gains glob, `repo_read_file` gains ranges and batches), for 30. A `/mcp/x/code` toolset exposes only these five plus `whoami` for no-clone agents. All are `readOnlyHint: true`. Every result has a common header:

```json
{ "repo": "proj/trunk", "ref": "sprout-7f3", "commit": "a1b2...", "indexed_commit": "a1b2...",
  "index_state": "exact|overlay|approximate|pending", "lag_ms": 1800,
  "budget": { "calls_left": 940, "bytes_left": 18800000 }, "next_cursor": null }
```

| Tool | Parameters | Result | Caps |
|---|---|---|---|
| `repo_grep` | `pattern`, `ref?`, `fixed_strings?`, `case?` (`smart` default, like rg -S), `paths?` (globs), `type?` (rg type names), `context?` (0 to 5, default 2), `max_count_per_file?`, `files_with_matches?`, `cursor?` | `matches: [{path, blob, line_number, lines, submatches:[{text,start,end}], before:[{line_number,text}], after:[...]}]`, `stats: {files_searched, bytes_searched, elapsed_ms, engine: "scan|trigram|grepd"}` | 200 matches or 32 KB (about 8k tokens), lines truncated at 300 chars; cursor = (root, shard, blob offset) |
| `repo_tree` | `ref?`, `path?`, `glob?` (gitignore-style), `depth?`, `cursor?` | `entries: [{path, type, size, blob}]` sorted by path | 2,000 entries per page |
| `repo_read_file` | `ref?`, `files: [{path, start_line?, end_line?}]` (1 to 20), `if_none_match?: [blob]` | `files: [{path, blob, total_lines, start_line, end_line, content, truncated}]`; unchanged blobs return `not_modified` | 32 KB total; per file 2,000 lines; larger returns a `resource_link` |
| `repo_symbols` | `ref?`, `query` (name or prefix), `kind?`, `mode: "definitions|references"`, `paths?` | `symbols: [{name, kind, path, line, end_line, container}]`; references are search-based (word-boundary grep on the name, filtered to identifier tokens), labelled `precision: "search"` | 200 rows |
| `repo_semantic_search` | `query`, `ref?` (trunk or world; sprouts get trunk results filtered by overlay plus on-the-fly scoring of overlay chunks), `top_k?` (10, max 50), `paths?` | `chunks: [{path, blob, start_line, end_line, score, symbol?, preview}]`, fused by reciprocal rank with symbol-name and literal hits | 10 chunks of 40 lines |

`blob` in every result is the git hash, so an agent can cache and an `if_none_match` read costs nothing. Results never contain Artifacts tokens; repo text is wrapped as data per `claude-06` trust labels.

## 5. Cache and prefetch

- **Blob cache.** Keys are blob hashes, immutable, so `Cache-Control: immutable, max-age=31536000`. Layer 1: Cache API in the gateway's colo (free, per-colo, the agent's nearest PoP), which removes the DO hop for repeat reads. Layer 2: the DO's `blobs` table, the source of truth for indexed content. R2 holds blobs over 1 MB and a periodic snapshot of the index for warm-starting `grepd` or rebuilding a DO. KV is not used: per-key writes are billed and Cache API covers the hot path.
- **Prefetch.** After `repo_grep`, the gateway `waitUntil`s a colo-cache fill for the top 5 hit files and, using the symbol table, the files that define symbols imported by them (capped at 10). After `repo_read_file`, siblings in the same directory are not prefetched (low hit rate, estimate).
- **Budget per agent task.** 1,000 tool calls and 20 MB of returned content per task by default, shown in `budget`, returned 429 with `retry_after_ms` when spent. Artifacts calls are not in the agent budget because agents never cause them for indexed roots; the indexer's 800 / 10 s bucket is the only path.

## 6. Sizes and costs

| Item | Arithmetic | Result |
|---|---|---|
| Content in DO | 1 GB text stored once, deduped by hash | 1 GB |
| FTS5 trigram, `detail=none` | about one trigram per byte, unique (trigram, doc) pairs est. 30 to 60% of bytes, 1 to 2 bytes each | est. 0.3 to 1.2 GB per GB; must be measured (B4). Russ Cox's purpose-built index was 77 MB for 420 MB, 18% (https://swtch.com/~rsc/regexp/regexp4.html) |
| FTS5 trigram, `detail=full` | adds positions, est. 1 to 2 bytes per occurrence | est. 1.5 to 3 GB per GB; not needed, the regex verify step replaces positions |
| tantivy with 3-gram tokenizer (option B) | positions plus stored text | est. 1.5 to 3 GB per GB (unverified) |
| Embeddings | 1 GB / 4 bytes per token = 250M tokens; 400-token chunks = 625k chunks × 1,024 dims (bge-m3, per model card) | 640M dims, 2.6 GB float32 |
| Embed cost | 250M × $0.0118 per M (https://developers.cloudflare.com/workers-ai/models/bge-m3/) | $2.95 per GB once; Hono 1.25M tokens = $0.015 |
| Embed time | 3,000 requests/min limit (https://developers.cloudflare.com/workers-ai/platform/limits/); batch of 100 per request unverified | 6,250 requests, about 2.1 min |
| Vectorize per month | stored: (640M − 10M) / 100M × $0.05; queried: (queries + stored vectors) × dims × $0.01/M per the pricing example (https://developers.cloudflare.com/vectorize/platform/pricing/) = (100k + 625k) × 1,024 × $0.01/M | $0.32 + $7.42 = about $7.74 per GB-repo per month |
| Artifacts per build | Hono 731 calls × $0.15/1k; 1 GB via clone ~1 op | $0.11; about $0.0002 plus container minutes |
| Artifacts per push | 13 calls × $0.15/1k | $0.002; 50 agents × 1 push per 5 min × 8 h = 4,800 pushes/day = 62k calls = $9.40/day, of which trees (~7 of 13) are shared with overlap detection |
| DO storage | 1 GB content + 0.3 to 1.2 GB index, $0.20/GB-mo after 5 GB (`claude-04` §9) | under $0.50/mo |
| Container B | idle standard-4 $0.113/h, busy $0.40/h | 8 warm hours/day at 25% busy: about $1.50/day |

Whether `readTree`/`readBlob` binding calls are billed operations and which rate limit they count against (per repo for git requests, per namespace for control plane, https://developers.cloudflare.com/artifacts/platform/limits/) is unverified. The pricing page names only "create, push, pull, and clone" (https://developers.cloudflare.com/artifacts/platform/pricing/). If binding reads are control-plane and per namespace, every sprout in a project namespace shares one 2,000 / 10 s, which makes the shared mirror and lazy sprout blobs mandatory rather than nice.

## 7. Consistency and limits

- **Lag.** Push, then queue delivery (unverified, est. 1 to 3 s), then the diff (13 calls in parallel, est. 0.2 s), then tree-sitter parse of changed blobs (est. 50 ms each, parallel). Target p50 under 5 s, p99 under 15 s.
- **During lag.** The agent asking about its own sprout gets `index_state: "pending"` and `indexed_commit` = previous head if it names the ref, or an exact on-demand build if it passes the SHA it just pushed (the Claude Code plugin passes HEAD by default). Other agents see the previous head with `lag_ms`; that is correct, since the push is not yet theirs to depend on.
- **50 agents on one repo.** Reads are served from DO and colo cache, so they cost no Artifacts calls. The DO is the bottleneck: at an est. 20 ms CPU per small-repo grep, one DO serves about 50 greps/s, which is 50 agents at one grep per second. Above that, or at 1 GB, shard. Pushes: 650 calls per 10 s in the worst burst above, inside the 800 bucket; beyond it, the indexer queues and lag grows, reported in `lag_ms`, rather than tripping Artifacts' limit for git traffic.
- **At 1 GB.** Initial build through a container clone; 16 shards; no-literal regex is 1.5 s target, or routed to `grepd` when warm; files over 1 MB are readable but excluded from search unless `include_large: true`; 32 MB blobs exceed the 2 MB row limit and are split into 1 MB parts with line offsets.
- **GC.** Blobs not reachable from any live root (trunk, open sprouts, worlds from the last 7 days) are deleted nightly, along with their vectors.

## 8. Bench plan (by 2026-10-08)

Run from a Worker in IAD and an MCP client on a Virginia machine; 30 queries recorded from real Claude Code sessions on Hono, replayed.

| # | Experiment | Pass |
|---|---|---|
| B1 | `readTree`, `readBlob`, `readFile` latency at concurrency 1/10/50; read GraphQL `artifactsEventsAdaptiveGroups` for `rateLimited` and see whether reads appear as billable events | readBlob p50 < 30 ms, p99 < 150 ms; billing and limit scope answered |
| B2 | Initial build of Hono through the binding | 731 ± 5 calls, wall < 15 s, zero rate-limit errors |
| B3 | `repo_grep` brute force over Hono, MCP end to end | p50 < 150 ms, p95 < 300 ms; results identical to `rg --json` for all 30 queries |
| B4 | `CREATE VIRTUAL TABLE t USING fts5(c, tokenize='trigram', detail=none)` in DO SQLite; load 100 MB of TypeScript | table creates; index ≤ 1.2× source; literal query in-DO p50 < 80 ms |
| B5 | Incremental: push 5 files in 3 dirs to a sprout | ≤ 20 Artifacts calls; push to searchable p50 < 5 s |
| B6 | 50 simulated agents, 1 grep/s plus 2 reads/s each, 60 s | p95 < 400 ms, zero Artifacts calls from reads, zero 429s |
| B7 | Overlay correctness: 10 sprouts with edits, 50 queries each | 100% equal to `git grep` on a clone of each sprout |
| B8 | Semantic over the demo app with bge-m3, 10 canvas questions with known answers | hit@5 ≥ 8/10, p50 < 400 ms |
| B9 | Local baseline: `rg` for the same 30 queries on a laptop | ratio reported in the README, no pass bar |
| B10 (if time) | `grepd` cold start plus clone of a 100 MB repo; warm `git grep` no-literal | cold < 20 s, warm < 300 ms |
| B11 | Partial clone against Artifacts: `git clone --filter=blob:none` and `--filter=tree:0` over protocol v2, then `git sparse-checkout set <dir>`; also `--depth 1` | Server advertises `filter` and the clone moves under 10% of blob bytes; otherwise record "hydrates eagerly" and drop partial clone from the checkout design (`claude-16`) |
| B12 | Clone and fetch timing at 5 MB (Hono), 100 MB and 1 GB from a Container in Virginia and from a laptop: full, `--depth 1`, and incremental fetch after a 5-file push | Hono full clone < 3 s; 100 MB shallow < 15 s; incremental fetch < 2 s; 1 GB recorded with no pass bar |
| B13 | Jev path triage versus grep: 20 intents on Hono; Jev picks a directory then a file from the tree listing (Choice), grep uses one literal from the intent | Report files opened and time to the first correct file; Jev stays a canvas router unless it beats grep on both |

## 9. Demo cut for Oct 14

This subsystem is not on the `claude-13` must-exist list; it must not take more than two days of one agent's time. Ship:

1. Tree mirror and blob store in the CodeIndex DO, shared with the overlap map (the overlap map is on the demo path, so this is half-built anyway).
2. Push-driven incremental update with the token bucket; overlays for sprouts and worlds.
3. `repo_grep` brute force with Rust `regex` in Wasm, `repo_tree` with glob, `repo_read_file` with ranges and batches, colo blob cache.
4. `repo_symbols` definitions for TypeScript only (the demo app is Hono + D1).
5. `repo_semantic_search` on trunk with bge-m3 and Vectorize, because the canvas question box needs "where is tax computed". First to cut if behind; fall back to symbol-name match.

Deferred: FTS5 trigram (benched in B4, behind a size flag), sharding, `grepd`, precise references (SCIP), other languages, prefetch of imported files, GC.

## 10. What kills it

The design rests on three bets. First, that binding reads are cheap and count per repo; if they are per-namespace control-plane calls, 50 agents' sprouts plus the lease engine share 2,000 per 10 s and the index lags under real swarms. Second, that agents use our tools at all: Claude Code prefers its built-in Grep and Read on a local checkout, so the edge index only matters for no-clone agents, the canvas and Worker-side planners, which in the demo is a minority of traffic; if the harness fleet always clones, most of this is a canvas feature, and should be sold as that. Third, that one DO thread is enough; at 1 GB without good literals, brute force is seconds, and sharding plus `grepd` is real work that will not exist by Oct 14. If B1 shows reads are billed per namespace, or B6 fails, the fallback is option D everywhere plus `grepd` for the canvas, and the claim on stage shrinks to "small repos at edge speed".

## 11. Open questions for the owner

1. Is no-clone MCP work a headline feature, or is the index mainly for the canvas and planner? This decides whether semantic or grep ships first.
2. Spend ceiling for indexing per project per day (Artifacts calls plus Vectorize), given the $9.40/day 50-agent estimate.
3. Should harness containers be told to prefer beanstalk MCP search over local rg (for consistent `index_state` and logging) or keep local tools only?
4. Acceptable lag in the demo: is 5 s from push to searchable fine on screen?
5. Index history: only live roots plus 7 days of worlds, or every trunk commit (costs grow with history)?
6. Precise references: is search-based "references" acceptable for the competition, or is SCIP in scope after Oct 14?
7. Who files the questions to Cloudflare about binding-read billing and limit scope, before Oct 8?
