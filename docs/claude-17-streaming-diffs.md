# Streaming diffs, second design (2026-10-06)

`stream_diffs` shows a bean's working change while its agent writes. The first design (gateway README, "Streaming diffs", 2026-10-05) works but routes every snapshot through the race's RunDO, sends whole snapshots at every hop, and makes each viewer pull the patches after each announcement. This note records why that is slow at 30 agents and the design that replaces it. Code and this doc must agree; when they differ, fix both in the same change.

Status: implemented 2026-10-06 (`packages/gateway/src/stream/`, `harness/remote.py` `StreamReporter`, `packages/web/src/live/stream-*.ts`, `components/home/live-streams.tsx`). Where the code had to differ from the first draft of this note, the text below says what it does; "Implementation notes" lists those points.

## What the first design does, and what it costs

| Hop | First design | Cost at 30 agents |
|---|---|---|
| Edit to driver | Hook touches a marker; the driver polls it every 0.25 s, settles 0.3 s, and looks anyway every 3 s | Up to 0.55 s of latency before any diff is computed |
| Driver to gateway | One HTTP POST per invocation at most every 1.5 s, carrying **every** changed file's full patch (64 KB cap, 200 files), redacted | The 1.5 s interval is the floor of end-to-end latency; a one-line edit re-sends the whole change |
| Gateway | The POST enters the **RunDO**, the object that runs the engine step, which re-redacts every line of every patch, rewrites the bean's whole row, and broadcasts a summary to every socket | Regex over up to 64 KB and a 64 KB SQLite write per post, serialized with engine inputs (polls, results, jobs) |
| Per engine step | `#settleStreams` loads every stored snapshot, patches included, to see which invocations closed | Up to 30 × 64 KB of SQL reads and JSON parsing per step, on 88% of steps that are poll bookkeeping |
| Viewer | Summary over WebSocket to a vinext bridge, then SSE to the browser; the browser then **fetches** the full snapshot through a vinext route, the service binding and the RunDO | Two round trips per update; viewers × announcements RPCs on the engine's object; the whole snapshot parsed again per update |

The driver-to-gateway transport is not the bottleneck: 30 agents at one post every 1.5 s is 20 requests a second. What costs is the shape of the payload, the pull, and where the work runs.

## The second design

Principles: the engine's RunDO never touches streams; every hop carries only what changed; patches are pushed to the viewers that asked for a bean and summaries to everyone; the security model (slot token owns the invocation, redaction on both sides, never in the event log) is unchanged.

### 1. `RunStreamDO`: one Durable Object per run, beside the RunDO

A new SQLite-backed class in the gateway (`src/stream/`), named by run id, bound as `RUN_STREAMS`. It holds:

- `stream_run(id = 1, opened_ms, finished_ms NULL)`: a row once the RunDO opened anything, i.e. the run streams;
- `stream_invocations(inv PRIMARY KEY, task, slot, kind, opened_ms, opened_t, expires_ms, closed_ms NULL)`: which invocations may stream, as the RunDO tells it (`opened_t` is the race clock at the open, so a post's `t` needs no RunDO; `expires_ms` is the alarm sweep's deadline);
- `stream_beans(task PRIMARY KEY, inv, agent, seq, at_ms, t, truncated, redacted, additions, deletions)`: the latest snapshot's summary per bean;
- `stream_files(task, path, status, additions, deletions, binary, redacted, patch, PRIMARY KEY (task, path))`: the files of that snapshot, with the lines the gateway's scan replaced per file (the summary's `redacted` is their sum).

The RunDO calls it from `#apply` with the step's `invocation.start` and `invocation.end` events (`src/stream/stream-changes.ts`; the events of the step whether the RunDO stores it or keeps it in memory), filtered to the streaming kinds (`initial`, `rework`, `sync`, `fixer`) and only when `config.stream_diffs`: `open([{inv, task, slot, kind, t, ttlMs}])` and `close([{inv, task, t}])`, batched per step, through `waitUntil`. The calls are chained, so open, close and finish reach the StreamDO in step order; a failed call is logged and not repeated. The slot is the open invocation's in the step's state (the event's `agent` is the same). A close that overtakes its open leaves a closed row, so the late open cannot reopen it. The StreamDO sweeps by alarm (every 60 s while anything is open) the invocations open longer than the agent timeout plus 5 minutes. At `done` the RunDO calls `finish(t)` (every stream ends, every snapshot goes); the reap calls `clear()` (`storage.deleteAll()`, sockets closed). The RunDO's `bean_streams` table (dropped by its migration), `#streaming`, `#settleStreams`, `stream()`, `beanStreams()` and `beanStream()` are gone.

### 2. Incremental posts from the driver

`POST /v1/runs/:run/invocations/:inv/stream` keeps its path and slot-token check in the Worker, and now reaches the StreamDO. The body is a delta:

```json
{"seq": 7, "base_seq": 6, "trigger": "edit", "truncated": false,
 "files": [{"path": "src/report/index.ts", "status": "modified", "additions": 12, "deletions": 3,
            "binary": false, "patch": "@@ … "}],
 "removed": ["src/old.ts"]}
```

- `files` lists only files whose patch changed since `base_seq`; `removed` lists paths that left the change (reverted by the agent).
- `base_seq: 0` is a full snapshot: `files` is the whole change and everything else is removed.
- The Worker validates the body (Zod, strict) and calls `streams(run).post(slot, inv, delta)`; the StreamDO checks ownership against its own `stream_invocations`. It answers `{"accepted": true, "seq": 7}`; `{"accepted": false, "reason": "resync", "seq": 5}` when `base_seq` is not the stored seq of this invocation (the driver then posts a full snapshot at once); `"stale"` and `"rate"` as before (checked in that order: stale, rate, resync). The least interval between accepted posts of one invocation drops from 1 s to 400 ms; the driver posts at most every 0.5 s and polls the marker every 0.1 s.
- A driver of the first design posts no `base_seq` and no `removed`: they default to `0` and `[]`, so its whole snapshot is taken as a full one and a mixed deploy keeps streaming.
- The driver keeps the tree-id fingerprint (an unchanged tree costs no diff) and keeps, per invocation, the last accepted snapshot's files by path with a hash of each patch, so a delta is a dictionary difference. Redaction runs on the driver as before; the StreamDO redacts only the files in the delta.
- Caps are unchanged (64 KB of patch per snapshot, 200 files, 256 KB body). A delta that would push the stored snapshot over the caps is accepted with `truncated: true` and the overflowing files stored with `patch: null`.

### 3. Push to viewers, with subscriptions

The StreamDO serves a hibernatable WebSocket at `GET /runs/:run/streams?key=<view token>` (the Worker verifies the token and proxies the upgrade). Messages to the client:

- `{"type": "bean.streaming", …summary}` and `{"type": "bean.streaming.end", task, inv, t}` to every socket, as today; a socket gets every bean's current summary when it opens, so no catch-up RPC is needed;
- `{"type": "bean.snapshot", task, inv, seq, files: [all files]}` when a socket subscribes to a bean that is streaming;
- `{"type": "bean.patch", task, inv, seq, base_seq, files: [changed], removed: [paths]}` to the sockets subscribed to that bean, after each accepted post (the summary goes first). A patch with `base_seq: 0` replaces the whole snapshot (`removed` is then empty).

The client sends `{"type": "subscribe", "beans": ["t012"]}` (at most 32) to replace its subscription set; the set lives in the socket's attachment (`serializeAttachment`) so it survives hibernation; `ping` is answered `pong` without waking the object. A socket that misses a `bean.patch` (its `base_seq` is not the seq it holds) asks again by re-subscribing and gets a `bean.snapshot`: the web app's bridge does this (`src/live/stream-bridge.ts` `relay`), once per gap, and forwards nothing for that bean until the snapshot arrives.

The web app keeps its SSE bridge pattern (vinext cannot hold a WebSocket upgrade). A second SSE route, `GET /api/runs/:run/streams?beans=t012,t015`, opens the StreamDO socket, subscribes, and forwards `stream` events; it is separate from the events SSE so changing the focused bean reconnects only this one (no event catch-up). `useLiveStreams(run, beans, enabled)` (`components/home/live-streams.tsx`) replaces the stream half of `useLiveEvents` and applies summaries, snapshots and patches into a per-bean map (`src/live/stream-state.ts`), parsing only the changed files' hunks (unchanged files keep their parsed objects). The subscribed beans are the ones on screen: `useBeanStream(bean)` registers its bean with the page's `LiveStreamsProvider` while mounted. `useBeanStream` reads the map; it reads `GET /api/runs/:run/beans/:bean/stream` once only when the bean is being written and the map holds no files for it yet (first paint, or the SSE down). The stalk and Growing now read the summaries through `useStreamSummaries()`.

RPC `beanStreams(run)` and `beanStream(run, bean)` keep their names and shapes on the gateway entrypoint and answer from the StreamDO, so `shared-ask/forge/bean-stream.ts`'s duck-typing and the MCP server need no change. One difference: the StreamDO does not know whether a run exists, so an unknown run answers `[]` and `null` instead of `not_found`.

### 4. What stays the same

- Secrets: the driver's and the gateway's pattern lists stay identical and both run; the gateway's runs only on changed files.
- Never in the log: no stream message enters `events`, `events.jsonl`, replays or summaries. The engine never reads a stream.
- Ownership: a post must come from the slot that holds the invocation, the invocation must be open and of a streaming kind, and the run must stream (`stream_off`, `closed_invocation`, `wrong_slot`, `invalid_state` as before). New: `404 unknown_invocation` for an invocation the StreamDO has not been told about. The RunDO opens it in the background, so a first post can in principle overtake the open; the driver stops only on a 409 and looks again, so a 404 costs one post. A non-streaming kind is never opened, so in practice it answers `unknown_invocation`; `invalid_state` remains as a guard. `stream_off` means the RunDO never opened anything here (a run without `stream_diffs`).
- Recorded runs: `isRecordedRun` short-circuits every stream route to "nothing streams".

## Expected effect

| Measure | First design | Second design |
|---|---|---|
| Edit to viewer latency (steady state) | 1.5 s interval + 0.55 s poll/settle + pull round trip (~0.2 s) | 0.5 s interval + 0.1 s poll + 0.3 s settle, no pull |
| Bytes per one-line edit, driver to viewer | Whole change (up to 64 KB) at every hop | One file's patch (hundreds of bytes) at every hop |
| Work on the engine's RunDO | Redact + rewrite per post, full-table load per step, one RPC per viewer per update | Two small batched RPCs per step with invocation starts or ends, nothing else |
| Viewer fan-out | Summaries to all; patches pulled by each viewer | Summaries to all; patches pushed only to subscribers |

A direct browser-to-gateway WebSocket (no bridge) would cut one Worker hop; the StreamDO is designed so that is one route and a token-minting action away, and it is left for after the deadline.

## Measured

`packages/gateway/test/stream.test.ts` ("writes and pushes only the changed file of a 100-file stream, 50 times"), on Miniflare: after a full 100-file snapshot, 50 one-file deltas wrote 3 SQLite rows each (the bean's row and the file's row, the upsert counting its replaced row) and 33 bytes of patch each, and a subscribed socket received 50 `bean.patch` messages of one file each. The first design rewrote the whole 100-file JSON row and broadcast a summary that made every viewer fetch all 100 patches again. `RunStreamDO.writeStats()` exposes the counters; each accepted post also logs `stream post` (debug) with rows and patch bytes.

## Implementation notes (2026-10-06)

Points where the code says more than the first draft of this note (the sections above are updated):

- Extra columns (`stream_run`, `opened_t`, `expires_ms`, `agent`, `t`, per-file `redacted`) so the StreamDO answers every read and every post without the RunDO.
- `404 unknown_invocation` for an invocation not (yet) opened, instead of a 409 that would stop the driver.
- The gap check and the re-subscribe live in the web app's bridge, not the browser (the browser's SSE cannot talk back to the socket); the browser also skips a patch whose `base_seq` it does not hold.
- Backpressure: Workers report no send-buffer size, so a socket is dropped from patch fan-out when a send throws; it gets patches again after it subscribes again.
- The pure rules (delta application, redaction of changed files, caps, stale/rate/resync) are `src/stream/stream-rules.ts`, tested on their own; `run-stream-do.ts` reads, writes and sends.

## Open edges

- A `close` the RunDO could not deliver: the StreamDO keeps the stream open until the alarm sweep (every 60 s, streams whose invocation is older than the agent timeout plus 5 minutes) or `finish()` at the end of the run; the driver stops posting when its invocation ends anyway.
- A delta for a bean whose previous snapshot the StreamDO lost (eviction before the write committed is impossible: SQLite writes are synchronous; a redeploy that drops the class storage is not): `resync` covers it.
- Backpressure: a socket whose send buffer the runtime reports as full is dropped from patch fan-out until it re-subscribes; summaries still go to it.
