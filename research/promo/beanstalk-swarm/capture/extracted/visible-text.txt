---
workflow: product-launch-video
flow: automation
storyboard: yes
message: "Beanstalk lets your swarm of AI coding agents work together effectively."
destination: youtube
aspect: 1920x1080
language: en
length: 30s
angle: metaphor-contrast
narration: no
capture: no
---

## Intent

A ~30 second, product-first motion-graphics promo for **Beanstalk**, an agent-first git forge on
Cloudflare Workers + Artifacts for teams running swarms of AI coding agents on one codebase.
Destination: YouTube and the Cloudflare competition entry. Positive and confident. No voice-over:
on-screen type carries the story over a music bed and light SFX.

Vocabulary: a **bean** is one agent's change, the **sprout** is the staged line, the **stalk** is
the stable line.

Central metaphor (the owner's idea): git as a **TREE** versus Beanstalk as a **STALK**. Every agent
grows its own branch on the git tree; branches grow long and heavy and something snaps. A beanstalk
grows one strong stem that the agents' beans climb together.

## Beats (confirmed)

1. 0–5 s, the tree: a swarm of agents each pushes out its own git branch; the branches grow long and heavy and sag.
2. 5–9 s, the snap: one branch cracks, and a conflict splinters through the tree. "More agents, more branches, more breakage."
3. 9–14 s, the beanstalk: the same agents, but their beans climb one stalk. Each bean is checked on the exact spot where it will join, and locks in green.
4. 14–19 s, together: a broken bean drops back to its own agent with the reason attached and climbs again. Two beans whose tests clash only on an out-of-date value interlock calmly (reconciled). A real disagreement buds a single decision card for a person.
5. 19–25 s, proof: "12 AI agents · 40 colliding tasks · measured on Cloudflare", then numbers climbing the stalk: "37 of 40 shipped"; "Most of the work green in under 9 min (merge queue: ~20)"; "Stable line correct, every run".
6. 25–30 s, close: the stalk reaches the clouds. "Beanstalk. Your agent swarm, growing together." Small: "Built on Cloudflare Workers + Artifacts".

## Customizations

- No-capture mode: pure invented motion graphics; nothing captured from websites.
- Music bed + light SFX (crack, lock-in clicks, gentle chime), no voice-over.
- Storyboard review: stop at the `storyboard.html` wireframe sketches for owner review before any build or render.

## Notes

- Facts must stay exactly as measured: 12 Claude agents, 40 colliding tasks, 37/40 shipped, 30th task green at 8.9 min vs 19.9 for a batched merge queue, 2.3x sooner to done, stable line correct.
- Not about idle agents; never attack any company. One quiet reference number for "a merge queue" is fine.
- Look: a fresh, distinctive direction grown from the plant metaphor (organic growth vs brittle branches). Must differ from the earlier promo at `promo/beanstalk-30s.html` (dark green, Bricolage Grotesque).
- Paid extra usage: be economical, no needless re-renders.
