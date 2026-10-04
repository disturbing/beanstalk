# E6: decision cards that ship the loser

**Status (2026-10-03):** done. Three clean Sonnet races (12 agents, seed 7, 40 tasks) against the v2 fair run, plus replay tests and a replay rehearsal of the human-mode demo. Code, tests and run directories: `research/exp/e6-decisions/` (a copy of the harness in `race/`; `research/race` and the arena are untouched). How to click a card yourself: `research/exp/e6-decisions/DEMO.md`.

**Naming (Coop's):** a **bean** is one agent's change in its workspace, the **sprout** is the staged line (the harness's `trunk`), the **stalk** is the stable line (the harness's `green`). Event names and code keep the harness words (`land`, `green.promote`, `trunk_idx`).

**Labels:** **measured** = from a real race (Sonnet agents, the real arena); **replay** = a free race with reference patches; **unit** = a deterministic test.

---

## 0. Summary

| | v2 fair (declines the loser) | E6 keep-landed-adapt | E6 contract-wins | E6 contract-wins, run 2 |
|---|---|---|---|---|
| Tasks green (of 40) | 35 | **40** | **40** | **40** |
| Agent cost | $5.29 | $5.07 | $4.86 | $5.14 |
| Decision cards (designed couplings detected, of 5) | 1 (0) | 8 (5) | 7 (5) | 6 (4: the fifth never contradicted, §3.3) |
| 35th / 40th green, min | 11.3 / never | 10.9 / 17.8 | 11.3 / 21.0 | 11.2 / 17.6 |
| Correct against effective tests (canonical, or amended by a decision) | yes | yes | yes | yes |

All measured; the full tables are in §3.

1. **The real path works.** In every clean run, every loser shipped (5, 7 and 6 losers), and all 40 tasks went green, against 35 for v2, which declines the loser. In seven earlier Sonnet runs, v2 and the queue alike, at least two intents were lost every time. It costs no more: $4.86–5.14 against $5.29. Cards replace the informed reworks that thrash against contradictions (2–4 per run instead of 16), and that pays for the test authors and re-executions ($0.63–1.05 per run).
2. **Earlier cards matter as much as the outcome.** Cards raised when a bean *starts* (its declared partner already landed) decided 3 of the 5 designed couplings before any code was written. That alone removed the silent product decision every earlier run made (t031's agent stripping commas from money), and t036's three doomed reworks.
3. **The human decides meaning, and it shows.** Both oracles ship all 40, but different products. Keep-landed shipped "the signature rule compares goods without shipping; the email shows goods plus tax". Contract-wins shipped "the threshold and the email use the new shipping-inclusive total". That choice belongs on a card, not in an agent's code comment.
4. **The literal adopt-arriving (revert, land, re-execute the reverted bean) never completed with real agents.** In 3 of 3 adoptions, the arriving winner had already built on the loser (a revert conflict, twice) or the revert would have broken a third bean (a cascade, once). Every time E6 adopted in place: it amended the loser's tests and let the winner carry them. The service should make in-place adoption the default.
5. **The test author is cheap and right.** It made 14 amendments across the three runs, with 0 rejected by the parse and fail-first checks, at $0.03–0.09 each. It answered `NO AMENDMENT` 7 times, each time correctly: the decision did not touch the loser's tests.
6. **Two mechanisms were needed to get there**, and both came out of a failed first run (§3.9):
   - decisions must **compose** (an author amending a bean's tests must see every earlier decision on it);
   - culprits need a **dynamic read set** (coverage plus `git blame` plus a leave-one-out probe). It named t033 as t032's culprit out of 24 candidates in all three runs.

---

## 1. The question

v2 raises a decision card when a bean's pre-land check stays red against the same landed bean after two informed reworks. The oracle keeps the landed spec, and the arriving bean is **declined**: dropped, its intent lost. In the v2 fair run (`research/race/runs/opus-v2fair-sonnet-12-s7`, `08` §5.2), that one card cost t032 its place. Four more tasks were dropped without any card.

**The contradictions were never decided by anyone (measured, all seven earlier Sonnet 40-task runs: four v2, three queue).** The arena has three genuine spec contradictions: t023/t036 (tax rounding vs identical refunds), t028/t032 (the signature threshold vs a total that now includes shipping), and t005/t031 (grouped money vs a plain-text invoice that pins `$1000.00`). They resolved like this:

| What happened | v2 runs | queue runs |
|---|---|---|
| t032 (total includes shipping) dropped | 4 of 4 | 3 of 3 |
| One of t023/t036 dropped (t036 six times, t023 once) | 4 of 4 | 3 of 3 |
| t031's agent silently strips the commas from `formatMoney` (`.replace(/,/g, '')`), against its own prompt ("Amounts use the shop's normal currency formatting"). Some of the agents justify it in a code comment ("pasted into expense reports, so amounts carry no digit grouping") | 4 of 4 | 3 of 3 |
| A card raised for a designed coupling | 0 | n/a |

So every run lost two intents, and one product decision was made silently by an agent. That is the real-world failure: two agents disagree about meaning, and one of them quietly wins.

E6 builds the real path: after a decision, the **losing bean is re-executed under the winning spec**, so both intents ship where possible. It then measures greens (can all 40 ship?), the cost of re-executions and spec amendments, time to the k-th green, the number of decisions, and final correctness against the canonical *or* amended tests.

## 2. Design

### 2.1 Outcomes

| Outcome | When | What happens |
|---|---|---|
| **keep-landed** | The landed bean's spec wins | The arriving bean's attempt is discarded. It is re-executed in a fresh session, on a fresh fork of the sprout head, with the decision text and the winner's intent and diff in its prompt (`reexec.start`, `reason: keep-landed`) |
| **adopt-arriving** | The arriving bean's spec wins | One pre-land check of the candidate *sprout minus the landed bean, plus the arriving bean*. If it is green, the revert and the landing are published in one committer turn (`revert`, then `land`), so the sprout never holds the revert alone. Then the reverted bean is re-queued (`task.park`, `task.requeue`) and re-executed against the new contract (`reason: adopt-arriving`) |
| adopt in place | Fallback when the revert conflicts or **cascades**, or with `ADOPT_MODE=in-place` | No revert. The loser's acceptance tests are amended in place and land together with the winner, whose landing must make them pass. The loser's code stays, adapted by the winner where needed. The winner **carries** the amended tests through any later re-execution of its own, where they are restored like protected tests. If the winner is dropped, the amendment is rolled back |
| decline | `DECISION_ORACLE=decline` only | v2's behaviour: the arriving bean is dropped. It is kept to reproduce the baseline in tests |

**Revert cascade.** A landed bean can have dependants by the time a card reverts it. In the arena, t031's plain-text invoice was amended to `$1,000.00` after t005 grouped thousands. Reverting t005 later, to adopt t032's email total, would break t031. When the candidate check fails on a *third* bean's acceptance tests, E6 publishes nothing, logs `decision.cascade`, and adopts in place.

The first version published the revert first and undid it on a cascade. In replay, that left the sprout red for one validation cycle (a red validation and a bisect) and would have poisoned other beans' pre-land checks. Checking the candidate before publishing removes that window.

### 2.2 Spec amendment

Before a loser is re-executed, a **separate test-author session** gets five inputs:

- the decision text;
- the loser's intent and acceptance tests;
- the winner's intent and diff;
- the failing tests;
- a scratch worktree at the snapshot the loser will re-execute from.

The author edits only assertions that contradict the decision, or replies `NO AMENDMENT`. The harness keeps only the loser's acceptance-test files and accepts the amendment if two checks pass:

1. **It parses:** `module.stripTypeScriptTypes` on each changed file. A syntax error also "fails first", so this check matters.
2. **It fails first:** the full suite runs on the snapshot plus the amended files, with the same 60 s emulated latency as a pre-land check. At least one *changed* file must fail there, where the loser is not implemented.

Accepted tests replace the task's acceptance tests, so they are protected like any landed bean's (the own-test restore and `--protect-tests landed`). The `spec.amend` event carries the unified diff, the fail-first evidence and the author's cost. `spec.amend.none` and `spec.amend.rejected` record the other two cases. In-place amendments (§2.1) skip the fail-first run, because the loser *is* implemented on that snapshot. They record `in_place: true`.

### 2.3 Decision modes

| Mode | Who decides |
|---|---|
| `DECISION_ORACLE=landed` ("keep-landed-adapt") | The landed bean always wins |
| `DECISION_ORACLE=contract` ("contract wins") | The bean that changes the shared contract wins. For known pairs this is documented in `decisions/table.json` from the arena's coupling notes. For unknown pairs it is inferred from the red: if the landed bean's acceptance tests fail, the arriving bean changed behaviour they rely on; if only the arriving bean's own tests fail, the landed bean did |
| `DECISION_ORACLE=table` | The documented per-coupling choice, with its decision line. It can keep both contracts (`adapt`). Example: "the signature rule compares the goods without shipping", which ships t028 and t032 unchanged |
| `DECISION_MODE=human` | `harness/cards.py`, a stdlib `http.server` page at `http://127.0.0.1:8765/`. It shows both one-line specs, the failing tests and both diffs, and blocks the card until a click on **keep landed** or **adopt arriving**, with an optional custom decision line. After `HUMAN_TIMEOUT` it falls back to `HUMAN_FALLBACK` (default `table`). `DEMO.md` is the script to try it |

In oracle mode each card waits `DECISION_SECONDS` = 30 s of emulated human latency, as in v2.

### 2.4 Earlier, more frequent cards

| Mechanism | v2 | E6 (race settings) |
|---|---|---|
| Card after failed informed reworks against one landed bean | 2 | `CARD_AFTER=1` |
| Declared coupling pairs (`COUPLING_PRIOR=arena`: the 5 semantic couplings in `tasks/*.json`) | same as others | `CARD_AFTER_KNOWN=-1`: the card is raised **when the bean starts** if its partner already landed (before any code is written), else at its first pre-land red |
| Culprit naming | Owners of failing acceptance tests, then landed commits *after the bean's snapshot* whose writes meet the failing tests' read set | Owners of failing tests: declared partners first, then other owners. When the bean's **own** tests fail, a **dynamic read set** (`dynamic_culprits`, §5.3) replaces v2's static guess. It probes declared partners first, wherever they landed, including **before the snapshot**. v2 missed t023 as the culprit of t036 in all four v2 runs, because t023 had landed before t036 started |
| Optimistic landing | Lands without re-check when files are disjoint | Also re-checks when a declared partner landed (or was reverted) meanwhile (`partner_rechecks`) |
| Red sprout validation | Revert-first, then drop the culprit | Revert-first, then **re-execute** the culprit. If a declared partner is involved, a card decides which of the two is reverted. If the revert conflicts, the culprit's task repairs in place |

**Decisions compose.** A bean can lose more than one card: t032 is coupled to t005, t028 and t033. The test author and every later re-execution of a bean see all decisions in force on it (`decisions_in_force`), and must keep them while applying the new one.

### 2.5 Nothing dropped silently

Two v2 behaviours dropped beans for reasons unrelated to their own work. E6 changes both, and the results attribute every green to the path that produced it.

- **Rescue (`RESCUE=1`).** When the rework budget (3 rounds) runs out, the bean is re-executed once from scratch on the current sprout (`rescue.start`). In the v2 fair run, 4 of 5 drops were budget exhaustion. The four v2 runs dropped 3, 3, 2 and 1 tasks that way.
- **Inherited reds.** A pre-land red whose failing tests already failed in a validation of the sprout it was checked on (with no revert since) belongs to the sprout, not the bean. The bean waits for the sprout to move and re-checks, without spending a rework round (at most 3 times). In the v2 fair run, t003, t007 and t013 each spent a round on the t011/t018 red they had not caused.

**Two harness fixes the runs forced (both in `race/harness/`):**

- **Auth failures stop the race.** During an authentication outage, `claude -p` returns an `is_error` result ("Failed to authenticate. API Error: 403"), not a crash. The harness had booked these as finished reworks (§3.1). Now they abort the race, like a rate limit, and `tools/authcheck.py` (from E3) runs a 1-turn Haiku probe before every real race and scans the events after it.
- **Robust worktree reset.** `git merge --abort` can leave `MERGE_HEAD` behind. v2 dropped the bean at that point, so it never mattered. E6 keeps the bean going, so the next merge crashed. The replay demo rehearsal found this.

### 2.6 Correctness, defined

**Effective tests** of a task are its canonical arena acceptance tests, unless a decision recorded a spec amendment for it; then they are the amended tests, which were fail-first proven on the snapshot the loser re-executed from. A run is **correct** when both hold:

1. the full suite is green on the final stalk commit, which contains every landed bean's committed effective tests plus the base tests; and
2. every green task's effective tests, written fresh from the task record over the final stalk, pass.

The final check also reports two more things:

- **Canonical correctness:** the same check with the original tests.
- **Explained failures:** every canonical failure of a green task must be covered by a recorded amendment (`canonical_failures_unexplained` must be empty).

A canonical failure is the expected trace of a decision, not a defect. An *unexplained* one would be a defect.

## 3. Results

### 3.1 Runs

All races: Sonnet, 12 agents, seed 7, the 40 arena tasks, run through the race slot with these settings:

- `--protect-tests landed --ci-seconds 60 --ci-slots 2 --snapshot head --error-budget 999 --max-wall-minutes 45 --budget-usd 20`
- `PRELAND_MODE=optimistic PRELAND_SECONDS=60`
- E6 settings: `DECISION_SECONDS=30 CARD_AFTER=1 CARD_AFTER_KNOWN=-1 COUPLING_PRIOR=arena SPEC_AMEND=1 RESCUE=1 ADOPT_MODE=revert DYNAMIC_CULPRITS=1` (`race_e6.sh`)

Load is the 1-minute load average from `uptime` at the race's start and end. Auth is the post-race scan for `is_error` results that read 403, "Request not allowed" or "/login" (`tools/authcheck.py --scan`).

| Run | Oracle | Code | Start | Load start → end | Auth | Used for |
|---|---|---|---|---|---|---|
| `research/race/runs/opus-v2fair-sonnet-12-s7` | v2 (declines the loser) | v2 | earlier | not recorded | 0 failures | baseline |
| `e6-keep-sonnet-12-s7-run1-contaminated` | landed | first version | 14:54 | 53 → 21 | **2 failures** (t032's last two reworks, 15:21–15:22) | excluded; lessons only (§3.9) |
| `e6-contract-sonnet-12-s7` | contract | composing decisions, dynamic culprits | 15:25 | 21 → 21 | 0 | results |
| `e6-keep-sonnet-12-s7` | landed | final | 16:36 | 35 → 6 | 0 | results |
| `e6-contract-sonnet-12-s7-r2` | contract | final | 16:38 | 40 → 18 | 0 | results |

Run directories are under `research/exp/e6-decisions/race/runs/`.

- **Code versions.** The contract run predates three fixes: carried in-place amendments, the robust worktree reset and the auth abort (§2.5). Only the first mattered there: one in-place amendment was missing from the final tree, while correctness held (§3.8).
- **Concurrency.** The last two runs overlapped (the race slot allows 2 races at a time), so their clocks ran on a shared machine.

### 3.2 Headline

| | v2 fair | E6 keep-landed | E6 contract | E6 contract r2 |
|---|---|---|---|---|
| Green / dropped | 35 / 5 | **40 / 0** | **40 / 0** | **40 / 0** |
| Drops by reason | 1 declined by a card, 4 out of rework budget | none | none | none |
| Agent cost | $5.29 | $5.07 | $4.86 | $5.14 |
| Decision cards | 1 | 8 | 7 | 6 |
| Red pre-land checks / informed reworks | 17 / 16 | 9 / 3 | 9 / 2 | 9 / 4 |
| Re-executions (decision / rescue) | 0 / 0 | 5 / 0 | 2 / 2 | 2 / 2 |
| Test-author sessions (amended / none needed / rejected) | 0 | 8 (5 / 3 / 0) | 7 (5 / 2 / 0) | 6 (4 / 2 / 0) |
| Adoptions: by revert / in place (why) | 0 | 0 / 0 | 0 / 2 (a conflict; a cascade) | 0 / 1 (a conflict) |
| Red sprout validations | 1 | 0 | 0 | 0 |
| Textual conflicts met | 21 | 12 | 15 | 17 |
| Wall clock, min | 11.3 | 17.8 | 21.0 | 17.6 |
| Task start → green, median / p90, min | 3.7 / 6.1 | 3.6 / 8.4 | 3.4 / 7.7 | 3.2 / 7.2 |
| Correct, effective tests | yes | yes | yes | yes |
| Green tasks passing canonical tests | 35 / 35 | 37 / 40 | 36 / 40 | 36 / 40 |
| Canonical failures not explained by an amendment | 0 | 0 | 0 | 0 |
| Committed tests match the record | yes | yes | **no** (t028, §3.8) | yes |

The t002/t022 and t011/t018 couplings are not contradictions (§3.3), so E6's cards on them only told the arriving bean the contract; the test author answered `NO AMENDMENT`. Rescues shipped t010 in both contract runs. Its first three rounds kept meeting the migration-number collision (t007, t010, t011 and t024 all add migration 6); in the keep-landed run, a card resolved the same collision for t011 (D005).

### 3.3 Contradictions detected against the five designed couplings

| Coupling | Contradiction? | v2 fair | E6 keep-landed | E6 contract | E6 contract r2 |
|---|---|---|---|---|---|
| t002/t022 paginate shape | no: the list returns `page.items` | no card, adapted | start card; no amendment | start card; no amendment | start card; no amendment |
| t005/t031 grouped money | yes | no card; **t031 strips commas** | start card; t031 amended | start card; t031 amended | start card; t031 amended |
| t011/t018 tracking number | no: the email reads the shipment | no card; red sprout, then repaired | pre-land card; the arriving bean re-executed | pre-land card; re-executed | pre-land card; re-executed |
| t023/t036 tax rounding | yes | no card; **t036 dropped** | start card; t036 amended | start card; t036 amended | start card; t036 amended |
| t028/t032 signature vs total | yes, for this example | **t032 dropped** | pre-land card; t032 re-executed (no amendment needed) | pre-land card; t028 amended in place | **no card**: t033 (free shipping) landed first, so the $234 order ships free and the contradiction never surfaced |
| **Designed detected** | | **0 of 5** | **5 of 5** | **5 of 5** | **4 of 5** |
| t005/t032 email total (natural) | yes | card; **t032 declined** | card; t032 amended | card; t005 amended in place (cascade) | card; t005 amended in place |
| t032/t033 free shipping (natural) | yes | (t032 already gone) | card; t032 amended | card; t032 amended | card; t032 amended |
| t003/t023 tax breakdown (natural) | no | t003 dropped (rework budget) | no card needed | no card needed | no card needed |
| Other | | | t007/t011 migration number (mechanical) | | |

**Cards per run: 6 to 8, against 1 in v2.**

- About half are real product decisions: grouped money, tax rounding, the signature threshold, the email total, free shipping.
- Two are notices on contract changes that need no decision. Both v2 and E6 adapt those; the start card only makes the decision explicit.
- One is a mechanical collision that an informed rework would normally fix. `CARD_AFTER=1` raised it after a single failed rework.

At about a minute of human time each (estimated), that is 6 to 8 minutes for 40 tasks.

### 3.4 Every card (the three clean runs)

| Run | Card | Min | Trigger | Arriving meets landed | Winner | Outcome | Loser's tests | Loser green at |
|---|---|---|---|---|---|---|---|---|
| keep | D001 | 2.7 | start | t022 meets t002 | t002 | keep-landed | none needed | ✓ |
| keep | D002 | 4.2 | pre-land | t011 meets t018 | t018 | keep-landed (t011 adapts the template) | none needed | ✓ |
| keep | D003 | 5.4 | start | t031 meets t005 | t005 | keep-landed | amended (`$1,000.00`) | ✓ |
| keep | D004 | 7.0 | start | t036 meets t023 | t023 | keep-landed | amended (`[377, 376, 376]`) | ✓ |
| keep | D005 | 7.2 | pre-land | t011 meets t007 | t007 | keep-landed | amended (migration renumbered) | ✓ |
| keep | D006 | 7.2 | pre-land | t032 meets t028 | t028 | keep-landed | none needed | ✓ |
| keep | D007 | 10.1 | pre-land | t032 meets t005 | t005 | keep-landed | amended (email shows goods + tax) | ✓ |
| keep | D008 | 13.7 | pre-land | t032 meets t033 | t033 | keep-landed | amended (examples under $75) | 17.8 min |
| contract | D001–D004 | 2.8–6.3 | as above | same pairs | contract side | keep-landed | as above | ✓ |
| contract | D005 | 7.9 | pre-land | t032 meets t028 | **t032** | adopt-arriving, **in place**: t032 conflicts with the sprout without t028 | t028 amended in place (`23400` → `23000`) | ✓ |
| contract | D006 | 11.4 | pre-land | t032 meets t005 | **t032** | adopt-arriving, **in place**: reverting t005 would break t031 (cascade) | t005 amended in place (`$42.60` → `$47.60`) | ✓ |
| contract | D007 | 16.5 | pre-land | t032 meets t033 | t033 | keep-landed | t032 amended | 21.0 min |
| contract r2 | D001–D004 | 2.5–6.7 | as above | same pairs | contract side | keep-landed | as above | ✓ |
| contract r2 | D005 | 9.0 | pre-land | t032 meets t005 | **t032** | adopt-arriving, **in place**: conflict | t005 amended in place | ✓ |
| contract r2 | D006 | 13.3 | pre-land | t032 meets t033 | t033 | keep-landed | t032 amended | 17.6 min |

**t032 is the last green in every run.** It is coupled to three beans (t005, t028 and t033) and lost or won a card against each, one after another.

**The test author's amendments were minimal and correct.**

- **t031** (`$1000.00` → `$1,000.00`): four amounts regrouped, nothing else touched.
- **t036:** the refund test became `[377, 376, 376]`, "the first line carries the spare cent". The author read where the agent's own `applyRateToTotal` puts the cent.
- **t005, in place:** `$42.60` → `$47.60`. The author left `$3,195.00` alone, because on that sprout t033's free shipping applies to a $3,000 order.

### 3.5 What shipped: the decision changes the product

| Behaviour on the final stalk | keep-landed | contract-wins (both runs) |
|---|---|---|
| Signature threshold compares | `order.total - order.shippingCost` (the goods: t028's spec kept, t032 adapted it) | `order.total`, shipping included (t032's contract; t028's example amended) |
| Confirmation email "Total:" | goods + tax (`order.total - order.shippingCost`; t005's spec kept, t032 amended) | the new total including shipping (t005 amended) |
| Plain-text invoice amounts | `$1,000.00`, the shop's normal format (in all three runs; v2 runs stripped the commas 7 of 7) | same |
| Line refunds | the tax charged on the line: $3.76, $3.76, $3.77 | same |

All intents shipped in both. Which meaning shipped was the oracle's call: in a product, it is Coop's.

### 3.6 What decisions cost

| | E6 keep-landed | E6 contract | E6 contract r2 |
|---|---|---|---|
| Test-author sessions | 8, $0.39 | 7, $0.35 | 6, $0.31 |
| Decision re-executions (keep-landed losers) | 5, $0.66 | 2, $0.14 | 2, $0.11 |
| Rescue re-executions | 0 | 2, $0.29 | 2, $0.21 |
| **Decision overhead** | **$1.05** | **$0.78** | **$0.63** |
| Informed reworks (v2: 16, $2.75 of rework spend overall) | 3 | 2 | 4 |
| All reworks (conflicts included), count / $ | 16 / $1.85 | 17 / $1.95 | 21 / $2.24 |
| Fail-first runs (emulated 60 s each) | 5, 317 s | 3, 191 s | 3, 190 s |
| Card waits (30 s emulated human latency each) | 240 s | 210 s | 180 s |
| Dynamic culprit runs, local test time | 3, 25 s | 3, 18 s | 3, 12 s |
| Total agent cost | $5.07 | $4.86 | $5.14 |

The decisions pay for themselves. v2 spent its money on reworks against contradictions that could not be reworked away: t036 three times, t032 twice, and t003, t007 and t013 on a red sprout.

### 3.7 Time to the k-th green

| | 20th | 30th | 35th | 38th | 40th |
|---|---|---|---|---|---|
| v2 fair | 7.3 min / $4.79 | 9.7 / $5.21 | 11.3 / $5.29 | never | never |
| E6 keep-landed | 7.4 / $3.35 | 9.8 / $4.31 | 10.9 / $4.31 | 12.4 / $4.62 | 17.8 / $5.07 |
| E6 contract | 6.8 / $2.77 | 10.2 / $4.10 | 11.3 / $4.42 | 13.5 / $4.53 | 21.0 / $4.86 |
| E6 contract r2 | 7.4 / $3.30 | 9.1 / $4.15 | 11.2 / $4.76 | 13.4 / $5.02 | 17.6 / $5.14 |

(`kth_green.py` clock: the first promotion of each task. No task in E6 was green and then reverted, so the final-green clock is identical.)

- **Through the 35th green, E6 matches v2** within ±0.6 min, despite 30 s waits and a test author on the start cards. It spends less money to get there ($4.31–4.76 against $5.29).
- **Then E6 keeps going.** The 38th green comes 1–2 minutes later. The last two to four are the multi-decision beans, chiefly t032, at 17.6–21.0 min.

### 3.8 Correctness

Correctness is defined in §2.6.

- **All three E6 runs are correct.** The suite is green on the final stalk, and every one of the 40 green tasks passes its effective tests.
- **Canonical tests.** 36–37 of the 40 pass. Every canonical failure belongs to a task with a recorded spec amendment (t031, t032 and t036 in all three runs, plus t005 in the contract runs), so `canonical_failures_unexplained` is empty in every run. Some amended tasks also pass their canonical tests: t028 in the contract run, and t011 in the keep run.
- **One integrity defect, found by this check and since fixed.** In the first contract run, t028's in-place amendment was committed into t032's fork. t032 was then rescued onto a fresh fork, which dropped the carried file, so the final tree holds t028's *canonical* test while the record says amended. Both versions pass on that tree (t033's free shipping again), so correctness held. The fix: the winner carries in-place amendments through its re-executions (§2.1). Run 2 confirms it (committed tests intact).

### 3.9 What the excluded first run taught

Run 1 (keep-landed, first version) shipped 39 of 40. It is excluded, for two reasons:

- **Contamination.** An authentication outage made t032's last two reworks return `Failed to authenticate. API Error: 403` as finished results.
- **Policy flaws.** It also exposed two flaws that would have dropped t032 regardless:
  1. **A partner rule that was too eager.** When t032's *own* tests failed, its declared partner t028 was named as the culprit just because it is a partner. That raised a card against t028, while the real culprit was t033's free shipping. The same rule skipped the dynamic finder, whose 8-candidate cap would have missed t033 anyway.
  2. **Amendments that did not compose.** The second test author amended t032's email test without knowing that the first card had decided the email shows goods plus tax. The result was a pair of protected tests no implementation can satisfy.

  The fixes are in §2.4: partners only on their own failing tests, dynamic culprits with partners probed first, 24 candidates, and decisions in force passed to every author and re-execution. Both ran in all three clean runs.

## 4. Verdict

**Ship it: re-executing the loser under the winning spec is the path, and the card is where it starts.**

- **All 40 tasks can now ship.** They did in 3 of 3 clean runs, against 35 in v2, at equal or lower cost.
- **The mechanisms that matter, in order:**
  1. Cards early: at the start of a bean whose declared partner landed, after one failed rework otherwise.
  2. A test author that amends only the contradicting assertions, with a fail-first check.
  3. Decisions that compose.
  4. A dynamic read set to name the culprit of a bean's own failing tests.
- **What to change from the brief:**
  - **Adopt in place by default.** The revert-and-re-execute form of adopt-arriving never completed with real agents (0 of 3).
  - **Prefer contract-wins as the oracle default** when no human answers. It keeps the newer, deliberate contract.

**Caveats:**

- **One seed.** All runs used seed 7.
- **The prior is the arena author's knowledge.** Declared couplings drive the start cards. The dynamic read set covers the pre-land case without the prior, but start cards need a real source in the service (§5.3).
- **Rescue confounds the count.** The rescue rung shipped t010 in two runs for reasons unrelated to decisions.
- **Human latency is emulated** at 30 s per card.

## 5. What the service needs

### 5.1 The decision record

E6 writes one JSON record per card to `<run>/decisions.jsonl` (`harness/decisions.py: Decision`). For the service, the record should be this, stored in the repo Durable Object (SQLite) and mirrored to D1 for the context API:

```json
{
  "id": "D003", "trigger": "start | preland | validation", "status": "decided | applied | shipped | moot",
  "landed":   {"bean": "t023", "sha": "…", "spec": "Tax is rounded once per rate and spread over the lines", "intent": "…"},
  "arriving": {"bean": "t036", "spec": "Identical lines refund identically ($3.76 each)", "intent": "…"},
  "evidence": {"failing_tests": ["src/billing/line-refunds.test.ts > refunds identical lines identically…"],
               "assertion": "expected [376,376,376], got [376,376,377]", "diffs": {"t023": "…", "t036": "…"}},
  "recommendation": {"by": "contract", "winner": "t023", "why": "t023 changes the shared contract (applyRateToTotal)"},
  "decision": {"by": "human:coop | oracle:contract | timeout:table", "winner": "t023",
               "outcome": "keep-landed | adopt-arriving | adopt-in-place",
               "text": "A line refund returns the tax actually charged on that line…", "wait_seconds": 41},
  "symbols": ["src/lib/money.ts#applyRateToTotal", "src/billing/invoice.ts#buildInvoice", "InvoiceLine.tax"],
  "amendments": [{"bean": "t036", "paths": ["src/billing/line-refunds.test.ts"], "diff": "…",
                  "fail_first": {"snapshot": "…", "failing": ["…"]}, "author_session": "…", "cost_usd": 0.07}],
  "reexecutions": [{"bean": "t036", "session": "…", "cost_usd": 0.09, "landed": "…", "green": "…"}],
  "supersedes": null
}
```

E6 has every field except `symbols`, `assertion` and `supersedes`.

### 5.2 The card a human sees

The card is the `harness/cards.py` page, plus three things the race showed are missing:

1. **Header:** the two beans, the trigger, and whether the coupling was declared, detected or natural.
2. **Two columns, landed versus arriving.** Each column has a one-line spec written as *behaviour* (not the task title), the intent, and the diff. When the arriving bean has not started, its acceptance tests stand in for the diff.
3. **The contradiction in one line**, taken from the failing assertion: `expected [376, 376, 376], got [376, 376, 377]`. Missing today: the card shows test names and raw output.
4. **What changed in the contract:** the symbol and its old and new behaviour (`applyRateToTotal` now spreads cents). Missing today: only the table's note gives it, for known pairs.
5. **The recommendation and its reason**, and the timeout fallback with a countdown.
6. **Three actions:** keep landed, adopt arriving, or write a third line. A third line typed with either button becomes the decision text that the loser and the test author read. Example: "the signature rule compares goods without shipping".
7. **A timeline after the click:** the test author's amendment as a diff (the human reviews tests, not code), the re-execution, the landing, then green. Missing today: the page lists only the outcome.

### 5.3 How decisions attach to symbols for future beans

E6 keys decisions by **pair**. A pair is never asked twice, and a decision is applied wherever the pair meets: at start, at the pre-land check, or on the sprout. Decision text appears in later informed reworks that name either bean. That is enough for the arena, not for a real repo. The service should key decisions by **behaviour of a symbol**:

1. **Attach.** When a decision lands, record the symbols it fixes:
   - the winner's changed exported symbols, from the diff;
   - the symbols the loser's amended assertions exercise, from the dynamic read set below.
2. **Surface.** The context API returns *decisions in force* with every read of those symbols. A bean that opens `money.ts` sees "D003: tax is spread; refunds return the tax charged on the line" before it writes code. This is the cheapest card: the one that never has to be raised.
3. **Apply.** A pre-land red whose failing assertions exercise a decided symbol is matched to the decision automatically. The bean is re-executed with the decision, and the test author amends its tests if they contradict it. No new card is raised unless the bean's intent is to *change* the decided behaviour.
4. **Supersede.** Only a new card can supersede a decision. That makes `supersedes` a chain, the repo's history of product meaning.

**Dynamic read set (built in E6, `dynamic_culprits`).** The hard case is a landed bean in the arriving bean's snapshot that breaks the arriving bean's *own* tests, as t023 does under t036. The static read set cannot single it out, because every test imports the app. The finder works in three steps, at no agent cost:

1. Run the failing test files with `node --test --experimental-test-coverage` on the tree the pre-land check ran (0.2–0.5 s on the arena).
2. `git blame` the executed lines. The landed beans that wrote them are the candidates.
3. Confirm each candidate with a leave-one-out probe: revert it from that tree and re-run only those test files. Declared partners go first, then up to 24 candidates by executed lines, 4 at a time.

| Check (standalone, real arena patches) | Candidates by executed lines | Confirmed by leave-one-out |
|---|---|---|
| t036's refund test on base + t023 + t036 | t023 (34 lines) | t023 (1 failing test fixed) |
| t032's total test on base + t023, t009, t033, t038, t026 + t032 | t023 (34), t009 (7), t033 (7), t026 (2), t038 (2) | **t033 only** (3 fixed) |

Line counts alone would have blamed t023; the probe isolates the real culprit. In the races it ran 3 times per run, at 12–25 s per run in total:

- It confirmed t011 for t018 in 2.7–5.3 s.
- It confirmed t033 for t032 from 24 candidates in 2–15 s, six times out of six. t033 was not in the top 10 by executed lines. The first version, capped at 8 candidates, missed it (§3.9).
- Once (t025, keep-landed run) it found no landed bean to blame, and the bean got an ordinary rework instead of a wrong culprit. With this, detection no longer needs the declared-pair prior (replay test `test_dynamic_culprit_finds_the_contract_change_without_the_prior`). The service should run it inside the pre-land check. It reuses what the check already paid for.

### 5.4 The test author as a forge service

A separate session, never the implementer. Its contract:

- **Inputs:** the decision record, the loser's intent and tests, and a worktree at the snapshot the loser will run from.
- **Output:** edits to the loser's test files only, or `NO AMENDMENT`.

The forge accepts an amendment only with the parse check and the fail-first proof. It stores the amendment as a privileged test change linked to the decision, so the human reviews a test diff, never code. Expect one author session per card where the loser's tests are touched, plus fail-first CI time. The cost is in §3.6.

### 5.5 Revert or adopt in place

The brief's adopt-arriving reverts the landed bean and re-executes it. Two hazards showed up in the design and the replay tests:

- The revert can **conflict** with later beans on the same lines.
- It can **cascade**, breaking beans that built on the loser, such as t031's amended grouped amounts after t005.

E6 detects both and falls back to adoption in place. The loser's code stays and its amended tests land with the winner. In the races the fallback was not the exception but the rule: 3 of 3 adoptions ran in place, after 2 conflicts and 1 cascade (§3.4). The arriving winner always had the loser in its fork, because it had merged the sprout during an earlier rework. For the arena's couplings, adoption in place is also cheaper, because the loser's *code* usually already follows the new contract (t028's signature rule reads `order.total`, so it follows t032's new total by itself) and only its tests encode the old one. **Recommendation:** make in-place adoption the default. Keep revert-and-re-execute for a loser whose code itself must change, and only when the candidate check is green.

## 6. Cost of this experiment

| Item | Agent spend |
|---|---|
| Run 1 (excluded) | $5.42 |
| E6 contract | $4.86 |
| E6 keep-landed | $5.07 |
| E6 contract r2 | $5.14 |
| Auth probes (2 × 1-turn Haiku) | $0.01 |
| Replay tests (20 unit and replay tests, 11 replay races) and three demo rehearsals | $0 |
| **Total** | **$20.50** (budget $40) |

## 7. Files and how to reproduce

All paths are under `research/exp/e6-decisions/`.

| Path | What |
|---|---|
| `race/harness/policy_beanstalk_e6.py` | The policy: triggers, outcomes (keep-landed, atomic adopt, in place), spec amendment, dynamic culprits, rescue, inherited reds, final check |
| `race/harness/decisions.py` | Decision record, oracles, table, prompts (re-execution, start, test author) |
| `race/harness/cards.py` | The human card board (stdlib `http.server`) |
| `decisions/table.json` | Per-coupling documentation: contract side, one-line specs, decision texts, the table oracle's choice |
| `decisions/replay/` | Replay fixtures: amended tests and adaptation patches, each verified against the composed reference solutions |
| `race/tests/test_decisions.py` | 20 tests: oracles, board, carry and rollback, and 11 replay races (keep-landed, adopt-arriving, start card, table oracle, human click, human timeout, red validation, cascade, dynamic culprits, decline, rescue) |
| `race/analyze_e6.py`, `results.md` | The comparison tables of §3 (`python3 analyze_e6.py <runs…> --md results.md`) |
| `race_e6.sh` | One race: tests, demo rehearsal, auth probe, uptime, race, auth scan. Run as `research/tools/race-slot.sh research/exp/e6-decisions/race_e6.sh keep\|contract` |
| `race/tools/authcheck.py`, `race/tools/click_bot.py` | E3's auth probe with an events scan; a stand-in for Coop's clicks in rehearsals |
| `demo.sh`, `DEMO.md` | Click a real card in human mode (4 agents, the 10 coupled tasks) |
