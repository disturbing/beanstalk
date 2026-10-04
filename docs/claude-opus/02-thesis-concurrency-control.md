# Thesis: run code changes the way a database runs transactions

**One sentence.** Beanstalk treats thousands of agents as concurrent transactions over one codebase. It schedules them so they rarely collide and lets them commit without waiting. It records what each change read and wrote, and repairs the rare bad interleaving with a fixer agent that is told the exact cause. Humans read a green branch that only moves forward on verified snapshots.

This is a different bet from the other two sets in this folder, not a rewording of them:

- `claude-10` builds around an Integrator that composes "worlds" for humans to choose between.
- Codex `02` builds around proposed outcomes with alternative changes.

This set puts most of the effort *before* code is written (placement) and *after* it lands (targeted repair), and keeps nothing blocking in between. The last section shows how the three fit together.

Every factual claim links to a source or to a research memo in `research/`. Numbers marked *illustrative* are back-of-envelope.

---

## 1. Why the pull-request model breaks at agent scale

Git and the PR were designed for a few humans who each hold a lot of context and merge occasionally. Agents invert every part of that. Agents are many and they merge constantly; each holds little context, and they touch the same code at the same time.

The evidence, in brief (full sources in `01-evidence.md`):

- **Conflicts are the normal case.**
  - 27.67% of 107k simulated agent PRs had textual merge conflicts.
  - Pairs of PRs from *different* agents conflict 41.7% of the time, against 19.8% within one agent.
  - 79.4% of agent PRs overlap in time with another agent PR on the same target.
- **Locks and gates kill throughput.**
  - With locks, Cursor saw "20 agents… slow to the throughput of 1-3 with most time spent waiting on locks."
  - Requiring "100% correctness before every single commit… caused major serialization."
  - Their integrator role became "an obvious bottleneck. There were hundreds of workers and one gate."
  - Their conclusion: "accept… a small but stable rate of errors that requires a final reconciliation pass", plus a final "green" branch. ([Cursor, 2026-01-14](https://cursor.com/blog/scaling-agents); [Cursor, 2026-02-05](https://cursor.com/blog/self-driving-codebases))
- **Gates can also be wrong.** GitHub's merge queue silently produced bad squash merges in 2,092 PRs across 658 repos on 2026-04-23.
- **Green CI is weak evidence.** In one sample, 25% of tests that agents added passed against the old, broken code. Agents also delete tests that fail.

Two structural problems sit under these numbers.

1. **Textual merge only catches writes that collide.** Git flags a conflict when two changes edit overlapping lines. It says nothing when change B edits `Cart.total()` and change A, written against the old `Cart.total()`, depends on it in another file. That read-write conflict merges cleanly and breaks later. With humans this was rare, because people talk. Agents don't talk.
2. **Every safeguard is a serial gate.** Merge queues, required reviews, required checks and integrators each make all work pass through one point. At human rates that is fine. At agent rates, the gate *is* the system's throughput.

Databases faced exactly this pair of problems decades ago and solved it with concurrency control. **Snapshots** let readers avoid blocking writers. **Validation** checks what a transaction *read*, not just what it wrote. **Scheduling** keeps conflicting work from running at the same time. **Group commit** amortizes the serial step, and **isolation levels** let each workload pick its trade-off between speed and safety.

## 2. The mapping

| Database idea | Beanstalk version | Why it works for agents now |
|---|---|---|
| Transaction | A **task attempt**: an intent, a fork, a change | The forge dispatches every task, so it knows each transaction's boundaries |
| Snapshot isolation | Each task runs on an **Artifacts fork** of the fast trunk at time T0 | Artifacts forks are cheap and isolated (one Durable Object per repo) |
| Write set | Files and **symbols** the change modified (tree-sitter on push) | Computed, not declared |
| Read set | Symbols the change **depends on**: static dependencies of the changed code, plus reads observed through Beanstalk's context API | Agents read through the forge, so reads can be observed. Humans' reads never could be |
| Conflict-aware scheduling ([Calvin-style](https://dl.acm.org/doi/10.1145/2213836.2213838) deterministic planning; [Cassandra](https://dl.acm.org/doi/10.5555/2486788.2486884) for developers) | **Footprint prediction** plus a **conflict graph** used to place tasks | The forge picks who works on what. Agents don't negotiate |
| Optimistic commit plus validation (OCC / [SSI](https://dl.acm.org/doi/10.1145/1376616.1376690)) | Commits land on the **fast trunk** without waiting; a validator checks read-write overlaps asynchronously | Removes the blocking gate Cursor found fatal |
| Compensating transactions (sagas) | **Fixer agents** dispatched with the exact cause | Re-running a fix costs minutes of compute, not a human's afternoon |
| Isolation levels | Per-path **policy**: `fast`, `snapshot` or `serializable` | Billing code and docs deserve different trade-offs |
| Group commit | A **committer** lands batches of non-overlapping changes in one push | Spreads the serial step across many changes |
| Write-ahead log | The **trunk log**: every commit with intent, read set, write set and evidence | Explains every break; supplies the canvas; preserves context |
| Escrow and reservations | **Reservations** for large refactors, with aging | Keeps big changes from starving under optimistic concurrency |
| Commutative operations | **Merge drivers** for hot files (lockfiles, changelogs, registries, migration numbers) | Removes the most common false conflicts |

### Why this failed for humans and should work for agents

The software-engineering versions of these ideas are old and well tested:

- **Crystal** speculatively merged developers' working copies in the background to warn of conflicts early ([Brun et al., FSE 2011](https://dlnext.acm.org/doi/10.1145/2025113.2025139)).
- **Cassandra** treated potential conflicts as constraints and recommended conflict-minimal task orders ([Kasi & Sarma, ICSE 2013](https://dl.acm.org/doi/10.5555/2486788.2486884)).

Neither became mainstream, for three reasons. Humans would not declare their tasks and footprints. The tooling's interruptions cost more than the conflicts it saved. And people do not like being told to work on something else.

Agents remove all three objections:

- **The forge already knows every task**, because it dispatches them.
- **The forge observes every read**, because agents fetch code through its API.
- **Agents don't mind reassignment**, and re-running a task costs only compute.

The economics that killed these ideas for humans have flipped.

## 3. How it runs

```
            ┌─────────────┐   intents (humans, planner agents)
            │  Scheduler  │◀───────────────────────────────────────────────┐
            │  DO / repo  │  footprints · conflict graph · isolation policy│
            └──────┬──────┘  error-budget controller                       │
        place task │                                                       │
                   ▼                                                       │
   ┌──────────── agent (Claude Code, Codex, Cursor, forge-run) ─────┐      │
   │ reads via Context API (logged → read set) · pushes to own fork │      │
   └───────────────────────────────┬────────────────────────────────┘      │
              cf.artifacts.repo.pushed → Queue                             │
                                   ▼                                       │
   ┌─────────────── Committer (Sandbox, single writer of fast trunk) ┐     │
   │ write set (tree-sitter) · effective read set · structured merge │     │
   │ group commit to FAST TRUNK · append to trunk log                │     │
   └───────────────────────────────┬─────────────────────────────────┘     │
                                   ▼ (asynchronous, never blocks agents)   │
   ┌─────────────── Validator (Workflows + Containers) ───────────────┐    │
   │ read-write overlap since T0? → suspect · run affected tests      │    │
   │ red → causal repair ticket → fixer agent ────────────────────────┼────┘
   └───────────────────────────────┬──────────────────────────────────┘
                                   ▼
   ┌─────────────── Promoter (only holder of GREEN's write token) ────┐
   │ snapshot fast trunk at a validated commit → full suite →         │
   │ tested-tree attestation → fast-forward GREEN                     │
   └──────────────────────────────────────────────────────────────────┘
         humans read GREEN deltas grouped by intent; decide on cards
```

### Step by step

1. **Intake.** Intents come from humans, from planner agents decomposing a brief, from issues, or from fixers. Each intent has acceptance criteria and a priority.

2. **Footprint prediction.** Before an intent is started, Beanstalk predicts which modules and symbols it will touch.
   - **Code computes the candidates:** full-text and symbol search over the intent's text, the co-change history of mentioned files, ownership maps, and the footprints of past intents with similar text.
   - **Jev judges membership:** one Noul question per candidate module ("will this task need to modify `packages/cart`?"). TypeSafe's Jev answers up to about 60 typed questions in one 180–440 ms call. Code then applies thresholds.
   - This plays to Jev's strength, classification over text, and avoids its weakness, numbers (see `04-canvas-second-opinion.md`).
   - **Fallback:** co-change statistics alone. Measure both (see `07-red-team-and-decisions.md`).

3. **Placement.** The scheduler keeps a **conflict graph** over active and queued tasks. An edge's weight is the probability that two footprints overlap, discounted where the overlap is commutative (two appends to a changelog do not conflict). It starts the highest-priority set of tasks with no heavy edges between them. A task that overlaps a running task has three options:
   - **Chain it:** it starts on the running task's fork once that lands. This is the cheap case and needs no waiting while holding anything.
   - **Co-assign it:** give it to the same agent or team, so one agent holds the context.
   - **Run it anyway**, if the overlap is predicted to be small and the path's isolation level is `fast`.

   Locks never appear. No agent ever waits while holding something, which is the failure Cursor hit. The scheduler simply does not start colliding work at the same time.

4. **Execution.** The agent works in its fork with a fork-scoped write token, minted with a TTL equal to the task's lifetime.
   - **Reads are logged.** The agent reads through the **context API**: file at commit, symbol, references, search. The API logs each read to the task, and that log is the *observed* read set.
   - **Reads come from the agent's own fork,** whose content equals trunk at T0. This spreads read load across fork Durable Objects instead of piling it onto trunk, which is capped at 2,000 Git requests per 10 s per repo.
   - **Each read can carry context.** A read can return notes such as "being modified by task 418 (agent `codex-7`), changing the return type; expected to land in about 10 min." That answers Cloudflare's own question, "how do agents know what other agents are working on?" They don't need to know in general, because the scheduler knows. When they do need to know, the read tells them.

5. **Commit.** A push to a fork emits `cf.artifacts.repo.pushed`. When the agent marks the task done, the **committer** takes over. It is the single writer of the fast trunk, and the only holder of its Artifacts write token. It:
   - computes the **write set** (tree-sitter symbols) and the **effective read set** (static dependencies of the changed code, intersected with the observed reads that the diff actually references);
   - runs a syntax-aware structured merge onto the current fast-trunk head (a [Mergiraf](https://mergiraf.org/)-class tool);
   - applies the path's isolation level (see below);
   - group-commits every non-overlapping change in the round as one push;
   - appends each change to the **trunk log** with intent, read set, write set and pointers to the agent's transcript, stored in git notes as `refs/notes/beanstalk`.

   The agent does not wait for tests. Its work is done.

6. **Validation (asynchronous).** For each new commit the validator asks one question: *did anything this change read get written by a commit that landed after its snapshot?* That is the read-write antidependency from serializable snapshot isolation.
   - **No:** run the change's affected tests at normal priority.
   - **Yes:** the commit is a **suspect**. Run the affected tests of *both* commits on the fast-trunk head first.
   - **Red:** open a **causal repair ticket** and dispatch a fixer. The ticket names the failing tests and the two (or more) commits whose read and write sets meet at the failing symbols. It includes both intents, summaries of both transcripts, and the suggested owner. Prefer the later commit's agent if it is still alive, since it holds the freshest context.

7. **Error-budget controller.** The fast trunk is allowed to be a little red. *How* red is explicit policy, for example "at most 3 open reds, none older than 30 minutes." The controller reacts like congestion control (additive increase, multiplicative decrease).
   - **Over budget:** pause the lowest-priority tasks and move their agents to fixer duty. Tighten the isolation level on paths that keep breaking (for example, `snapshot` becomes `serializable` for an hour). Start fewer new tasks.
   - **Under budget for a while:** relax again.

   This turns Cursor's finding ("small but stable rate of errors") into a dial with a gauge, instead of a hope.

8. **Green promotion.** The promoter snapshots the fast trunk at its newest fully validated commit, runs the full suite, and fast-forwards **green**.
   - **The attestation:** a signed record that *the tree we tested equals the tree we promoted*. That guarantee is exactly what failed on 2026-04-23.
   - **Green is a separate Artifacts repo** whose write token only the promoter holds. Artifacts has no protected refs ([research](research/cloudflare-platform-and-actions.md)), so per-repo tokens become the protection. No agent can force-push green, because no agent ever holds the credential.

9. **Humans.** People mostly read **green deltas**: what changed in green since they last looked, grouped by intent, with evidence attached. They act on **decision cards**:
   - an intent needs product judgment;
   - a repair ticket failed twice;
   - two intents want contradictory behavior;
   - the budget was breached.

   Review becomes deciding, not reading diffs.

### Isolation levels as policy

```toml
# .beanstalk/isolation.toml
[isolation]
default = "snapshot"                       # land if no write-write conflict since T0; check reads asynchronously
"docs/**" = "fast"                         # land after structured merge; validate later
"packages/billing/**" = "serializable"     # land only after read-set validation and affected tests pass on the would-be head
"db/migrations/**" = "serializable"

[budget]
max_open_reds = 3
max_red_age = "30m"
```

| Level | Lands when | Cost | Good for |
|---|---|---|---|
| `fast` | Structured merge succeeds | Highest throughput, most repair work | Docs, tests, internal tools, greenfield |
| `snapshot` | No write-write conflict since the task's snapshot (otherwise re-execute) | The default | Most product code |
| `serializable` | Read set validated *and* affected tests pass on the would-be head | Serialized per path, like a merge queue but smaller and better scheduled | Money, auth, migrations, public APIs |

A repo that sets `serializable` everywhere gets a well-scheduled merge queue, which is a safe place to start. Teams turn the dial towards speed path by path as the error budget proves they can.

### Big changes: reservations and recipes

Optimistic concurrency has a known pathology: **long transactions starve.** A 400-file rename overlaps everything, so it is either never scheduled or always invalidated. Beanstalk handles it two ways.

- **Reservations.** A large intent can reserve its predicted footprint for a bounded window. The scheduler stops placing new overlapping work there; it doesn't block work that is already running. Reservations age, so they cannot be held forever. This is the one place resembling a lock, and it is held by the scheduler, never by an agent.
- **Recipes instead of diffs.** Mechanical changes are submitted as a *program*: an ast-grep, Comby or jscodeshift codemod plus a small hand-written remainder. When the trunk moves, the committer re-runs the recipe on the new head instead of rebasing text. A rename then lands cleanly no matter how many other changes landed in the meantime. The same recipe can be re-applied to a release branch.

## 4. Where the bottlenecks actually are

The agents' own compute is not Beanstalk's problem. Claude Code, Codex and Cursor run on their operators' machines or clouds. Beanstalk pays for coordination, commits, validation and previews. Here is what saturates first, as an *illustrative* model.

**Assumptions:**
- 30% of registered agents are active at once.
- Each active agent pushes to its fork about every 2 minutes and lands a change about every 15 minutes.
- An affected-test validation job takes about 2 container-minutes.

| | 1,000 registered | 10,000 registered | 100,000 registered |
|---|---|---|---|
| Active agents | 300 | 3,000 | 30,000 |
| Fork pushes (spread across fork DOs) | 2.5/s | 25/s | 250/s |
| Landings on fast trunk | 0.33/s | 3.3/s | 33/s |
| Committer | about 1 change per 3 s round | about 10 per round (group commit) | **Saturates.** Shard the trunk by path: one scheduler and committer per shard, with cross-shard changes run as `serializable` two-phase commits |
| Trunk pushes (Artifacts per-repo cap is 200/s) | 0.33/s | 0.33/s (batched) | Per shard |
| Validation containers (account cap is 1,500 vCPU, about 375–750 jobs) | ~40 | ~400 per change, or ~60 if batched 10 per job with bisection on red | **Saturates.** Validate suspects first, sample the rest, run several accounts or bring your own runners |
| Scheduler DO traffic (heartbeats, placements) | ~10 rps | ~100 rps | Per shard. A DO serves requests one at a time, with a documented soft limit of about 1,000 req/s |
| Workflows creation (300/s per account) | Fine | Fine | Put a Queue in front, which is the design anyway |
| Previews (500 per Worker on Paid) | Fine | Green, fast trunk and on-demand task previews (LRU) | On demand only |

So "thousands of agents" is honest with **one trunk and batched validation**. "Hundreds of thousands", the competition's phrase, needs **sharded trunks** and validation compute beyond one account. Say exactly that on stage.

## 5. Mapping onto Cloudflare

| Component | Cloudflare product | Notes |
|---|---|---|
| Fast trunk, green, one fork per task | **Artifacts** (required by the rules) | Green is a separate repo with its own token. Forks spread Git read and write load across Durable Objects. Measure fork latency and storage on day 1; whether forks share storage is undocumented |
| Scheduler (footprints, conflict graph, placement, isolation, budget) | **Durable Object** per repo or shard, SQLite-backed | Single-threaded, so placement decisions are serializable for free |
| Trunk log and symbol index | DO SQLite (hot) plus **D1** per repo (up to 50,000 databases per account) | Read and write sets per commit; symbol table per commit |
| Context API | **Worker** plus the Artifacts binding (`readFile`, `readTree`, `log`), with edge cache keyed by `(sha, path)` | Content at a SHA never changes, so it caches forever. Every read is logged to the task's read set |
| Push intake | **Artifacts events → Queues** (5,000 msgs/s per queue) | Absorbs push storms before anything with a creation cap |
| Committer | **Sandbox or Container** running git, tree-sitter and Mergiraf | The only writer of the fast trunk. Group commit per round |
| Validator and promoter | **Workflows** orchestrating **Containers** | Test impact analysis; evidence keyed by `(tree hash, check hash)` is reused across forks |
| Footprint and routing judgments | **Jev** (TypeSafe) through `fetch`, with a fallback model | Code computes the candidates; Jev classifies |
| Fixers, planners, small forge agents | **Agents SDK** on Workers, or external agents through MCP | Fixers get repair tickets as their prompt |
| Live state for the canvas | DO **WebSockets** (hibernation) | Agent sprites, conflict graph, budget gauge |
| Previews | **Worker Previews**, through `preview/<task>` branches on the connected repo, since forks aren't connected to Workers Builds; Containers for non-Workers apps | See `06-auth-mcp-live-previews.md` |
| Auth | **workers-oauth-provider** plus Access | See `06` |

## 6. What a judge sees

The rubric pays 50% for originality, 25% for concurrency, coordination, context, review and conflict handling, and 25% for ease of use. The most persuasive thing this design can show is **a race**:

> The same repo, the same 200 tasks, the same agents, run twice side by side on **the same engine with two presets**.
> **Left (baseline):** the engine configured as a *good* batched merge queue, with no placement, `serializable` everywhere, and batched landing with bisection. That's what the best merge queues do today, so it isn't a strawman.
> **Right:** Beanstalk, with placement, a fast trunk, a validator, fixers and green promotion.
> **Scored only on what can ship:**
> - verified changes reaching **green** per hour;
> - agent-minutes spent waiting;
> - median time from task start to green;
> - repair work spent.
>
> Fast-trunk landings, conflicts, repair tickets and the error-budget gauge are shown but *not scored*. Landing without waiting wins those trivially, and a judge would rightly call that a rigged race.

Off stage, also run **ablations**:
- placement alone, still `serializable`;
- the fast trunk alone, without placement.

That shows how much of any gain comes from scheduling and how much from not blocking. If the right side doesn't win clearly on green throughput, the thesis is wrong, and it is better to learn that on day 2 than on stage. The rest of the demo is the canvas (conflict graph, lanes, budget, and green deltas as decisions), plus one agent proving a UI change on a live preview. `07-red-team-and-decisions.md` has the outline.

## 7. Questioning this thesis

| Objection | Answer, or the test that would settle it |
|---|---|
| **Read sets are noisy.** Reflection, dependency injection, config wiring, codegen, SQL strings and HTTP routes hide dependencies (false negatives). Observed reads over-approximate (false positives). | Read sets do not decide correctness; they decide *what to re-test first*, and tests decide whether a change is fine. **Test:** replay six months of a real repo's merged PRs as if they had run concurrently. Measure whether read-set suspects predict breaking pairs better than plain test impact analysis by changed file. If they don't, drop read sets and keep the rest. |
| **Footprint prediction will be wrong.** | It only needs to beat random placement. Every miss falls through to the fast trunk and a fixer, which is no worse than today. **Test:** collision rate with and without placement on the same task set. |
| **A red fast trunk poisons agents.** New tasks start from broken code and copy broken patterns. | Tasks snapshot from the newest *validated* commit on the fast trunk, not its head. The cost is freshness, so the path's isolation level decides. |
| **Cursor's evidence is one greenfield project** (a browser), run in Cursor's own harness. Enterprise repos may not tolerate red. | That is why isolation is per path and the budget is explicit. `serializable` everywhere is a valid setting. |
| **"It's a merge queue with extra steps."** | Three differences, all measurable in the race: work is placed *before* it starts; nothing blocks agents between commit and validation; repairs go to the right agent with the cause attached. If the race shows no difference, this objection wins. |
| **Fixers can loop**: fix A, break B, fix B, break A. | Repair tickets carry lineage. Two failed repairs on the same pair of intents escalate to a human decision card ("these two intents disagree"), not a third fixer. |
| **The single committer is a gate too**, the thing Cursor warned about. | It is a *mechanical* serial step (merge plus push, seconds) with group commit, not a *judgment* gate (review or tests, minutes). The judgment is asynchronous. Shard it when it saturates. |
| **Does anyone want this?** | The evidence says the pain is real: review queues, conflicts, outages, reverted merges. The bet is that people want *fewer things to look at*, which green deltas and decision cards provide, more than they want a nicer diff viewer. |

## 8. How this fits with the other sets

- **With `claude-10` (sprouts, beans, worlds, the Integrator).**
  - Same as theirs: agents work in their own forks (their "sprouts").
  - Different: Cursor's write-up argues against making a single Integrator the gate every change must pass. In a combined design, **worlds become alternative green candidates** built from the fast trunk. A world is used when humans really must choose between incompatible intents (two designs for one feature), not for every change.
  - The same as mine under another name: their resolver sprouts are my fixers, and their receipts are my attestations.
- **With Codex `02` (outcome, alternatives, runnable candidate).** Their "outcome" is my intent, their "alternatives" are parallel tasks for one intent (best-of-N), and their "integrated candidate" is a green snapshot.
- **With the closest rival entry, Steward** (claims board, PR as a decision; see `claude-03b`). A claims board is a lock table. Cursor's evidence is that agents mishandle locks and that locks serialize, so Beanstalk places work instead of letting agents claim it.
