# Click a real decision card (E6 demo)

A small race, 4 agents on the 10 coupled arena tasks, with decision cards in **human mode**: a local page shows each card and waits for your click. The losing bean is then re-executed under the winning spec, after a separate test-author session has amended its acceptance tests where they encode the losing behaviour.

## Run it

From the repository root:

```bash
research/exp/e6-decisions/demo.sh            # real Sonnet sessions: about $1-3 and 10-20 minutes
research/exp/e6-decisions/demo.sh replay     # free rehearsal: reference patches, 5 s emulated CI
```

- The script waits for a machine-wide race slot (`research/tools/race-slot.sh`, first come, first served). The real-agent run then makes a 1-turn Haiku call first (`tools/authcheck.py`, under a cent). If the CLI is logged out or the API answers 403, the demo stops there with exit 76: log in again and rerun.
- A browser tab opens on **http://127.0.0.1:8765/**. The board refreshes every 3 seconds. A new card also prints its URL in the terminal: `[cards] D001: t036 meets t023 (start) -> http://127.0.0.1:8765/card/D001`.
- Each card waits **10 minutes** for you. After that the table oracle answers for you, and the card says so.
- To change the defaults, set them in the environment: `HUMAN_TIMEOUT=120 HUMAN_PORT=8800 HUMAN_OPEN=0 research/exp/e6-decisions/demo.sh`.

The tasks are `t002 t005 t011 t018 t022 t023 t028 t031 t032 t036`: the five designed semantic couplings, plus the natural one between t005 and t032.

**The replay rehearsal is for the board, not the outcomes.** Replay agents apply the arena's reference patches, plus a few fixtures for the decided semantics in `decisions/replay/`. They cannot adapt code to an arbitrary click. A choice the fixtures don't cover leaves a bean that can't be fixed, and it is dropped after its rescue. An example is keeping t018's template over t011's tracking-number move. In the last rehearsal (`race/runs/demo-human-replay-check`: two clicks, the rest timeouts), 6 of 10 beans went green. With real agents, the loser re-implements its task under your decision.

## What a card shows

| Part of the card | Content |
|---|---|
| Header | Card id, the two beans, the trigger: `start` (a declared partner had already landed when the bean started), `preland` (the merged tree stayed red after an informed rework), or `validation` (the sprout went red) |
| Left and right boxes | The **landed** bean and the **arriving** bean: one-line spec, title and diff. A `start` card shows the arriving bean's spec and acceptance tests instead of a diff, because it has not run yet |
| Failing tests | The tests that failed on the merged tree, with output. A `start` card has none: it is raised before any code is written |
| Decide | **Keep landed**: the landed spec stands, and the arriving bean is re-executed under it. **Adopt arriving**: the landed bean is reverted from the sprout, the arriving bean lands, and the reverted bean is re-executed against the new contract. The button the oracle would press has a highlighted border. The text box takes an optional decision line (a third option, such as "the signature rule compares the goods without shipping"), which the loser and the test author read |

## Cards you will probably see

| Card | Pair | What it decides | Oracle suggestion |
|---|---|---|---|
| `t022 meets t002` (start) | invoice list vs `paginate()` returning `{ items, total }` | Not a contradiction: the list sends `page.items` | keep landed; the test author should reply NO AMENDMENT |
| `t031 meets t005` (start) | plain-text invoice `$1000.00` vs grouped money `$1,000.00` | Does the text invoice use the shop's normal format? | keep landed: t031's tests are amended to `$1,000.00` |
| `t036 meets t023` (start) | identical line refunds vs tax spread over lines | Which rounding wins | keep landed: t036's test expects $3.76, $3.76 and $3.77 |
| `t032 meets t028` (start or pre-land) | total with shipping vs the signature threshold | Does the $250 rule include shipping? | the table keeps both specs: the signature rule compares goods without shipping |
| `t018 meets t011` (pre-land) | tracking-number email vs tracking on the shipment | Not a contradiction: the email reads the shipment | keep landed |
| `t032 meets t005` (pre-land) | new order total in the email vs the grouped-email test pinning `$42.60` | Does the email show shipping? | the contract changer (t032) wins |

Try **Adopt arriving** on `t032 meets t005` to watch a revert. If reverting t005 would break a bean built on it (t031 after its amendment), the forge puts t005 back and adopts in place instead. It amends t005's tests and lands them with t032. The board notes the outcome under the card.

## After the click

Watch the terminal or `runs/demo-human-*/events.jsonl` for:

| Event | Meaning |
|---|---|
| `decision.made` | Your choice (`mode: human`) or the timeout fallback (`mode: human-timeout`) |
| `spec.author` → `spec.amend` / `spec.amend.none` / `spec.amend.rejected` | The test author's session. An amendment is accepted only if it parses and fails on the snapshot the loser re-executes from (`fail_first` names the failing tests) |
| `reexec.start` (`reason: keep-landed` or `adopt-arriving`) | The loser's re-execution, in a fresh session on a fresh fork of the sprout |
| `revert`, `task.park`, `task.requeue` | Adopt arriving: the landed loser leaves the sprout, waits for the winner to land, then re-executes |
| `decision.cascade`, `land` with `reapplied: true` | A revert broke a third bean, so it was undone and the decision was adopted in place |

When the race ends:

```bash
cat research/exp/e6-decisions/race/runs/demo-human-*/summary.md       # greens, decisions, amendments, cost
cat research/exp/e6-decisions/race/runs/demo-human-*/decisions.jsonl  # one decision record per card
(cd research/exp/e6-decisions/race && python3 analyze_e6.py runs/demo-human-<stamp>)
```

`final.check` in the summary reports correctness twice:

- **Effective**: every green bean passes its amended tests where a decision amended them, and its canonical tests otherwise.
- **Canonical**: the original tests. Any canonical failure must be listed under `canonical_failures_explained`, that is, covered by an amendment.

## If something goes wrong

- **Port in use:** the board takes the next free port and prints it. Use the printed URL.
- **No browser tab:** open the URL printed after `[cards] decision cards:` yourself.
- **Stopping early:** Ctrl-C stops the race cleanly; agents are killed and the summary is still written. After a SIGKILL, clean up with `python3 race.py --reap --out <run>` from `research/exp/e6-decisions/race`.
- **Budget:** the demo is capped at $5 (`--budget-usd 5`).
