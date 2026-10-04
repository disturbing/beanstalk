# Demo script: 8 minutes, built on measured results

For the 5–10 minute competition video and the 10-minute live stage slot. Every number on screen is measured (`08` §5, `11`); nothing is projected. Names: a **bean** is an agent's change, the **sprout** is the staged line, the **stalk** is the stable line.

## The one sentence (0:00–0:20)

> "When a dozen coding agents work on the same code, a merge queue makes them wait in line. Beanstalk lets them land without waiting, checks every change on its exact merged tree, repairs with the author who has the context, and asks a human only when two specs genuinely disagree."

## Beat 1: the problem, in three numbers (0:20–1:00)

- **41.7%:** pairs of PRs from different agents conflict (research, `01`).
- **20 agents with locks did the work of 1–3** (Cursor's swarm post).
- **2,092 PRs silently reverted** by a merge queue bug (GitHub, 2026-04-23).

Close the beat with: "So we measured what actually works with real agents."

## Beat 2: the race (1:00–3:30), the money shot

Canvas side-by-side view, replaying two recorded **Cloudflare** runs in sync at 10x: 12 real Claude Code (Sonnet) agents, 40 colliding tasks, the same seed, every landed test protected.
- **Left:** a strong batched merge queue. **Right:** Beanstalk v2.
- Counters tick. At the 30th green, v2 is at 13.8 min and the queue at 19.9. v2 finishes at 17.5 min, the queue at 40.6.
- Point at the queue's red batches (10) resetting its pipeline, and at v2's sprout staying green (3 red validations, each reverted at once).
- Then the honest line: "It costs about 20% more agent spend, and the queue's first greens come sooner. Across five seeds v2 finished first every time: 1.98x on average, 95% CI 1.68–2.28."

## Beat 3: how it works, on the canvas (3:30–5:30)

Switch to the live run canvas (one recorded v2 run, normal speed, scrubbing):
1. **Agent lanes:** a bean finishes, its lane flips to "pre-land check". The check runs on the exact tree it would land on, in the agent's own sandbox, and the agent is released to take the next task.
2. **The sprout timeline:** the bean lands as a green bead. Another bean's check comes back red, and the lane shows "rework: same session". The prompt carries the landed change that broke it (show the diff card). It lands on the second try.
3. **The code map:** two beans light up the same file. One lands; the other re-checks, because reds are frequent here. In a calm repo the system would skip that re-check and run as fast as a queue: the adaptive rule (`11`, v2.2).
4. **The stalk** trails the sprout by one validation and advances in batches. Show the attestation: the tree tested is the tree promoted.

## Beat 4: the human decides meaning (5:30–6:45)

Live, in human mode (`research/exp/e6-decisions/DEMO.md`):
- A decision card appears. **Left:** "Invoices show $1,000.00 with separators." **Right:** "The plain-text invoice prints $1000.00."
- Coop clicks. A test author amends the losing task's tests to the decided spec and proves they fail first; the losing bean re-executes and lands.
- Line: "With this, all 40 tasks shipped, at no extra cost (E6). Agents do the mechanics; people decide what the product means."

## Beat 5: what's underneath (6:45–7:40)

One diagram:

```
agents → gateway Worker → RunDO → runner containers → Artifacts (sprout and stalk refs)
```

- Every integration decision is made on Cloudflare. Agents never hold an Artifacts token. Each bean is a branch, and the git proxy lets an agent push only its own.
- Scale, simulated with real merges from 6,777 openai/codex commits: at 1,000 agents the sprout committer is 1–3% busy. "The bottleneck at scale isn't merging, it's how much independent work you can plan."

## Beat 6: close (7:40–8:00)

"Beanstalk: agents commit without waiting, the stalk stays honest, and the human decides meaning. Open source, on Workers and Artifacts."

## What must be true before recording

- [x] The canvas side-by-side replay of `cf-queue-sonnet-12-s7-landed` vs `cf-v2-sonnet-12-s7-r3` (packages/web, replay adapter): `/race` in `@beanstalk/web`; the race canvas of either run is `/runs/<run>/race`.
- [ ] A fresh v2.2 run on Cloudflare: adaptive re-check plus agent release (engine track), ideally beating 17.5 min. Use it for beats 2–3 if it does.
- [ ] Human-mode decision card on the live canvas.
- [ ] README run instructions and a LICENSE file (competition rules); the owner picks MIT or Apache-2.0.
- [ ] Rehearse three times. Record a fallback clip of beat 4.
