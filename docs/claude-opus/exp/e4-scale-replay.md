# E4: scale replay. Does the bean → sprout → stalk path hold up at 100–1,000 agents?

**Question.** Real agents were measured up to 20 (`../08` §5.4). Where does v2's integration path saturate with hundreds to thousands of concurrent agents?

**Method.** Real-agent races at that scale aren't affordable, so this replays real history instead (`research/scale-replay/replay_scale.py`, no model spend).
- **Corpus:** 6,777 merged changes from openai/codex, a very high-velocity Rust repo, taken in history order.
- **Tasks:** each change is one agent's task; agents take tasks first in, first out, as v2 does.
- **Real:** every merge outcome. `git merge-tree` runs on the real repo for the bean's start, its pre-land merge, re-merges onto a moved sprout, and re-execution.
- **Simulated** on a discrete-event clock:
  - agent work time (lognormal, median 20 min);
  - the pre-land check (60 s, in parallel on each agent's sandbox);
  - stalk validation (10 min, 2 slots);
  - the committer, a single writer charged 15 ms per git operation plus 1 s per push (the Artifacts push latency measured in `claude-16` was 0.4–3.6 s); up to 50 landings per push when several are waiting.
- **Rules:** optimistic landing as in v2. Land if the sprout hasn't moved; if it moved, re-merge; land without a re-check when the commits that landed meanwhile share no file with the bean; otherwise re-check.
- **Dependent changes:** a change that doesn't apply to the current sprout depends on history not yet landed. It waits, and is retried when a landing touches the files it conflicted on. It's dropped if nothing in flight can unblock it.

**Not modelled.** Semantic breaks (all checks are treated as green), real test runtimes, and agents adapting a change written against history that isn't there. Replay agents can't rewrite a change, so dependent changes over-drop at large scale.

## Results (simulated time, real merge outcomes)

| Agents | Tasks | Landed | Blocked at least once on unlanded history | Never applied | Optimistic landings (sprout moved, files disjoint) | Re-checks | Committer busy | Committer wait p95 | Done → sprout p50 / p95 | Done → stalk p50 / p95 | Stalk promotion batch |
|---|---|---|---|---|---|---|---|---|---|---|---|
| 100 | 300 | 289 (96%) | 150 | 8 | 236 | 40 | 1.5% | 0.0 min | 1.0 / 2.0 min | 14.3 / 19.0 min | 5.8 |
| 300 | 900 | 721 (80%) | 653 | 176 | 495 | 108 | 1.2% | 0.0 min | 1.0 / 2.0 min | 14.1 / 19.1 min | 4.3 |
| 1,000 | 3,000 | 895 (30%) | 2,579 | 2,101 | 800 | 182 | 3.0% | 0.01 min | 1.0 / 2.0 min | 14.8 / 19.3 min | 10.8 |
| 1,000, no grouping | 3,000 | 895 | 2,579 | 2,101 | 795 | 176 | 2.6% | 0.01 min | 1.0 / 2.0 min | 14.7 / 19.4 min | 10.2 |

The 3.6 s push variant is still running and will be appended.

## What it says

1. **The integration path doesn't saturate up to 1,000 agents.**
   - The single-writer committer is busy 1–3% of the time.
   - A finished bean reaches the sprout in about one check time (p50 1.0 min, p95 2.0 min).
   - The stalk trails by one validation cycle (p50 about 14 min with a 10-minute validation).
   - Grouped pushes are almost never needed (mean group 1.0, max 3), because landings arrive spread out in time.
   - Analytically, an ungrouped committer saturates around 1/(push + ops): about 3,500 landings/hour at a 1 s push and about 1,000/hour at 3.6 s. Grouping multiplies that by the group size.
2. **Optimistic landing does the heavy lifting.** 80–90% of landings happened after the sprout had moved during the bean's check, but onto disjoint files, so no re-check was needed. Re-checks were 13–20% of landings.
3. **The binding constraint at scale is how independent the work is, not merge mechanics.** In real history, most changes build on recent ones. With 100 agents, 96% of tasks landed, waiting for their predecessors where needed. With 1,000 agents starting at once on 3,000 consecutive changes, 70% could never be replayed out of order. Real agents would write those changes later, on the new code; replay can't. Either way, a forge with thousands of agents needs **planning that produces genuinely independent work, and chains dependent work** (start a bean only when its prerequisite has landed). A faster merge path doesn't help.
4. **Stalk promotions batch naturally,** 4–11 beans per validation, which is what keeps batch verification cheap (`10` §5c).

## Implications for the service

- **No sharding of the sprout below thousands of landings per hour.** One committer Durable Object is enough for the competition and well beyond; group pushes when the queue backs up.
- **Spend engineering on planning and decomposition:** an intent DAG with dependency-aware starts. The merge path is fine.
- **Cloud capacity math moves from the committer to the checks.** Every bean runs at least one pre-land check (about 1.2 per bean here, counting re-checks). That's agent-side compute (sandbox containers), which scales with agents, so the account's 1,500 vCPU container cap is the real ceiling (about 375–750 concurrent checks).

## Caveats

- Simulated agent and check timing.
- No semantic breaks are modelled (the real-agent races cover those).
- The codex history is one repo with heavy sequential dependency.
- The 300- and 1,000-agent runs over-count drops, because replay can't adapt dependent changes.
- Machine load affected only the replay's wall clock, not its results: committer time uses a fixed per-operation cost.
