---
format: 1920x1080
duration: 30s
message: "Beanstalk lets your swarm of AI coding agents work together effectively."
arc: BAB — before (the git tree breaks) → bridge (one stalk) → after (together) → proof → logo
audience: engineering teams running swarms of AI coding agents on one codebase; competition judges
mode: collaborative
music: warm organic pizzicato strings and marimba, light tension that drops out on a snap, then a lifting, growing, hopeful build; no vocals; ~100 BPM
version: v1
---

# Beanstalk — "growing together" (v1)

## Decisions

- **Message:** Beanstalk lets your swarm of AI coding agents work together effectively.
- **Audience / arc:** teams running many coding agents on one repo, and the competition judges. BAB:
  the git tree (before) breaks under a swarm → one stalk (bridge) → agents growing together (after) →
  measured proof → logo in the clouds.
- **Format:** 1920x1080, ~30 s, no voice-over (on-screen type carries it), music bed + light SFX, no captions.
- **Spine:** **a botanical field-guide plate that keeps growing upward.** The film is drawn as an
  indigo-ink herbarium engraving on parchment. The 12 agents sit on one ground line at the foot of
  the plate in every frame from 01 to 04 (the hero prop). Frame 01 is "Fig. 1 — the git tree";
  frame 03 is "Fig. 2 — the beanstalk". From frame 03 on, the camera only ever climbs: the stalk
  leads every transition upward until it breaks through the clouds.
- **Direction rule:** growth and camera travel **upward**. The only downward motion in the film is
  bad (branches sagging, the snap, the broken bean dropping back), so up = good is felt, not said.
- **Brand:** no capture (invented motion graphics). Preset `biennale-yellow` (frame.md), plus a
  project `leaf` green for locked beans. Paper #E9E5DB ground, ink #1B2566 for every line and word,
  sun #F1EE2E as the bloom (the sun the stalk grows toward), ember #E26B4A only for the crack and
  "sent back", leaf #2E8B57 only for checked-and-locked. Type: Instrument Serif 400 (display,
  italic for the plate captions), Archivo 600 caps micro-labels, JetBrains Mono for every number.
- **Held frame:** frame 06's lockup holds still for the last ~2 s; the line lands on silence-then-chime.
- **Bans:** no dark ground and no Bricolage Grotesque (must differ from `promo/beanstalk-30s.html`);
  no glow, no drop shadows, no rounded cards; no fake product UI or terminal screenshots; no logos of
  any other company and no dig at any company (the merge queue is a quiet reference number only);
  no "idle agents" angle; no invented numbers. Motion failures to avoid: **the slideshow** (each beat
  a fresh card; here the same plant keeps growing) and **the screensaver** (leaves wiggling for
  nothing; every move here is a branch growing, sagging, snapping or a bean climbing).
- **Truthfulness:** the plant is a metaphor; the numbers in frame 05 are the owner's measured run
  (12 Claude agents, 40 colliding tasks, 37/40 shipped, 30th task green at 8.9 min vs 19.9 for a
  batched merge queue, stable line correct). Nothing else is presented as a measurement.

## Still open

- Copy for frames 01, 03 and 04 (the brief gives none) is proposed, not confirmed; see each frame.
- "12 AI agents" (brief copy) vs "12 Claude agents" (fact list): which label goes on screen?
- Whether "2.3x sooner to done" should appear (it is a confirmed fact but not in the beat copy).
- BGM source: not signed in to HeyGen and local MusicGen deps are missing (see sign-in note).

## Frame 1 — The git tree

- scene: Twelve agents on the ground line each push out their own long ink branch from one trunk; the branches lengthen and sag.
- voiceover: onscreen
- duration: 5s
- poster: 4.2s
- transition_in: cut
- status: built
- src: compositions/frames/01-tree.html
- type: pain_point
- persuasion: Recognition (show the familiar model, let it strain)
- beat: curiosity → unease
- blueprint: none (composed: line-draw growth + weight sag)
- asset_candidates: none — typography + SVG ink drawing only

On screen: plate caption top-left, micro-label "FIG. 1" + italic serif "The git tree." Twelve agent
glyphs (small ink rings labelled `a01`–`a12` in mono) on a hairline ground. One trunk; each agent
throws its own branch (12 branches) that keeps lengthening outward; as length grows they bow and sag
downward. Sub-line (proposed): "Every agent grows its own branch." Sun bloom upper right, faint.

Motion: first stroke draws at 0.1 s (trunk), branches draw on staggered 0.15 s, each branch then
rotates down 4–9° on its joint (sine.inOut) through 5 s. SFX: soft wood creaks under the sag.
Constraint: no leaves, no fruit; it should feel heavy, not pretty.

narrativeRole: show git's mental model meeting a swarm — one branch per agent.
keyMessage: more agents means more, longer branches.

## Frame 2 — The snap

- scene: The heaviest branch cracks at its joint; an ember crack splinters through the trunk into two other branches; the line lands.
- voiceover: onscreen
- duration: 4s
- poster: 2.8s
- transition_in: cut
- status: built
- src: compositions/frames/02-snap.html
- type: pain_point
- persuasion: Pain agitation (escalation by consequence)
- beat: tension → snap
- blueprint: kinetic-type-beats (three-word relay, adapted)
- asset_candidates: none — typography + SVG ink drawing only

handoff_in: tree, agents and ground line continue from frame 01 at identical position, scale 1, opacity 1, branches at their final sag.

On screen: at 0.3 s the longest branch snaps (ember hairline crack), drops 30 px; ember splinter
lines race through two neighbouring branches (a conflict). Headline builds word-group by word-group,
left: "More agents," / "more branches," / "more breakage." (Instrument Serif headline, ink; "more
breakage." in italic).

Motion: camera micro-shake 6 px for 0.2 s on the snap; splinter draws in 0.35 s; words land on
beats at 1.2 / 1.9 / 2.6 s, hold to 4 s. SFX: dry branch snap (0.3 s), music drops out, a low thud
on "breakage." Constraint: no red alarms, no skull/error icons; the crack is the only drama.

narrativeRole: the old model breaks under a swarm. The pain, stated once.
keyMessage: more agents, more branches, more breakage.

## Frame 3 — The beanstalk

- scene: The broken tree dissolves; the same twelve agents remain; one green-ink stalk grows from the centre and each agent's bean climbs it, is checked at the exact spot where it joins, and locks in green.
- voiceover: onscreen
- duration: 5s
- poster: 3.8s
- transition_in: crossfade
- status: built
- src: compositions/frames/03-stalk.html
- type: product_intro
- persuasion: Negative contrast resolved (same agents, different shape)
- beat: relief + clarity
- blueprint: none (composed: stroke-grow + climbing tokens, camera tilt-up begins)
- asset_candidates: none — typography + SVG ink drawing only

handoff_in: agents + ground line at identical position from frame 02; tree and headline fade out over 0.4 s while the agents hold.

On screen: plate caption "FIG. 2" + italic serif "The beanstalk." One stalk draws upward from the
centre of the ground line (the music returns). Each agent releases a bean (small pod shape, ink
outline, mono label like `bean a07`). Beans climb in a stagger, spiralling around the stalk; at its
joint each bean shows a tiny "checked here" tick ring, then fills leaf green and locks to the stalk.
Right-side annotation (proposed): "Each bean is checked where it will join." Wordmark appears
small: "Beanstalk".

Motion: stalk grows 0.1–1.8 s (power2.out); beans climb 1.0–4.6 s staggered; each lock = fill leaf +
1.0→1.08→1.0 scale pop; camera begins a slow 80 px tilt up from 3.5 s. SFX: soft wooden click per
lock (pitched up gradually). Constraint: no merge arrows, no git icons; the stalk is the product.

narrativeRole: introduce Beanstalk as the answer, with the vocabulary (bean, stalk) taught visually.
keyMessage: one stalk; every agent's bean climbs it and is checked where it joins.

## Frame 4 — Together

- scene: Three moments on the same stalk: a broken bean drops back to its agent with a reason tag and climbs again; two beans that clash on an out-of-date value interlock calmly; a real disagreement buds one decision card for a person.
- voiceover: onscreen
- duration: 5s
- poster: 3.9s
- transition_in: cut
- status: built
- src: compositions/frames/04-together.html
- type: feature_showcase
- persuasion: Show-don't-tell (rule of three)
- beat: control + trust
- blueprint: camera-journey (adapted: three stations on one stalk, sub-shape A)
- asset_candidates: none — typography + SVG ink drawing only

handoff_in: stalk, locked beans and agents continue from frame 03 at its final camera tilt (80 px up), scale 1, opacity 1.

On screen, three callouts annotated like a botanical plate (numbered leader lines, serif italic):
(1) a bean with an ember outline falls back down to `a04`; a small tag clipped to it reads "sent
back · reason attached" (proposed); it climbs again and locks green. (2) two beans meet side by side
on the stalk, nudge, then interlock like paired leaves: label "reconciled" (proposed; sub-line "only
an out-of-date value"). (3) a bud swells off the stalk into a single parchment card with a hairline
border: "DECISION · 1" "Needs a person" (proposed), held.

Motion: the three moments overlap in a left→right→up path, 0.1 / 1.6 / 3.0 s; camera eases up
120 px over the frame. SFX: soft drop + ping (sent back), two gentle clicks (reconcile), single
chime (decision card). Constraint: no chat bubbles, no faces; the person is implied by the card.

narrativeRole: show the swarm working together, including how failures and disagreements are handled.
keyMessage: broken beans go home with a reason, small clashes reconcile, real ones go to one person.

## Frame 5 — Proof

- scene: The camera climbs the stalk; a measurement plate label sets the test, then three numbers climb the stalk one by one, each locking green like a bean.
- voiceover: onscreen
- duration: 6s
- poster: 5.2s
- transition_in: push-slide UP
- status: built
- src: compositions/frames/05-proof.html
- type: social_proof
- persuasion: Statistical proof
- beat: confidence
- blueprint: dataviz-countup (adapted: stat climb on the stalk)
- asset_candidates: none — typography + SVG ink drawing only

handoff_in: the stalk enters continuously from below at the same x (960) and stroke width; agents are now off-frame below.

On screen: a mono micro-label rule across the top: "12 AI AGENTS · 40 COLLIDING TASKS · MEASURED ON
CLOUDFLARE". Stalk on the left third; three numbered leaves branch right, each holding one claim:
(1) numeral-md "37 of 40" + "shipped"; (2) "Most of the work green in under 9 min" with a quiet
mono aside "(merge queue: ~20)"; (3) "Stable line correct, every run". Sun bloom behind the top leaf.

Motion: label rule draws 0.1–0.6 s; each claim climbs into place and locks with a leaf tick at
1.0 / 2.6 / 4.0 s; "37" counts up from 0; "9" counts up; camera keeps climbing 160 px over the frame.
SFX: rising pings on each lock, music builds. Constraint: no bar charts; no logos; the merge-queue
figure stays small (ink at mono-aside size, never struck through or mocked).

narrativeRole: measured evidence for the message.
keyMessage: 37 of 40 shipped, most of the work green in under 9 minutes, stable line always correct.

## Frame 6 — Into the clouds

- scene: The stalk breaks through a layer of ink-line clouds into a full sun bloom; the wordmark and line land and hold.
- voiceover: onscreen
- duration: 5s
- poster: 4.2s
- transition_in: push-slide UP
- status: built
- src: compositions/frames/06-clouds.html
- type: branding
- persuasion: Future pacing (aspiration)
- beat: aspiration → peace of mind
- blueprint: logo-assemble-lockup (adapted: the stalk's last curl draws the wordmark's underline)
- asset_candidates: none — typography + SVG ink drawing only

handoff_in: stalk continues from frame 05 at x 960, climbing; clouds part as it passes.

On screen: ink-line clouds part; the stalk tip curls into a small spiral tendril beside the
wordmark. Display serif "Beanstalk." centred-left; italic line under it "Your agent swarm, growing
together."; micro-label at the foot: "BUILT ON CLOUDFLARE WORKERS + ARTIFACTS". Full sun bloom
behind; pagenum "06 / 06" bottom right.

Motion: clouds slide apart 0.1–1.2 s; tendril curls 1.0–1.8 s; wordmark rises 24 px + fades in at
1.4 s; line at 2.2 s; foot label at 2.8 s; still hold 3.0–5.0 s (the held frame). SFX: riser into
the break-through, soft sparkle + chime as the wordmark lands, music resolves. Constraint: no URL
invented; no cursor, no button.

narrativeRole: brand lock with the promise in the product's own metaphor.
keyMessage: Beanstalk: your agent swarm, growing together.
