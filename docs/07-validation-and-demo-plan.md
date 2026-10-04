# Prove the useful part before building the whole forge

Proposed experiments and sequence, 3 October 2026. None of these experiments has been run. Thresholds below are initial planning judgments to agree before a trial; do not alter them after observing results.

## Recommended first slice

Build one end-to-end journey: **a person asks why a feature is blocked, inspects two integrated previews, sees which evidence is stale, and chooses an exact tested candidate**. Use a small web repository, three to ten agents, and a bounded execution budget. Preserve an ordinary Git clone/push workflow and a readable change list.

The technical spike needs Workers + Artifacts, attempt forks, a simple change/intent record, trusted candidate construction, one supported Linux workflow, two preview instances with seeded data, and a few deterministic canvas components. One human owner resolves product disagreements. The giant fleet simulation comes after these mechanics work.

## Experiments that can reject the thesis

| Experiment | Baseline and method | Proposed success criterion | What would change our mind |
| --- | --- | --- | --- |
| Canvas usefulness | At least 8 reviewers, counterbalanced tasks across PR dashboard, chat+links, and generated canvas | 25% lower median correct-decision time; no increase in missed seeded failures | If chat+links is equally good, make the canvas optional and focus on evidence |
| Combined preview value | Same reviewers inspect 12 tasks, some with cross-change regressions | More integration defects found with no material review-time increase | If combined previews rarely reveal useful information, narrow to app/UI teams |
| Coordination value | Replay realistic overlapping tasks with ordinary worktrees vs scope/intent warnings | 30% less discarded implementation work at similar accepted quality and total compute | If claims become busywork or noisy warnings, simplify to observed diffs and contracts |
| Independence of validation | Seed known bugs, test deletions, self-serving test changes, and false agent success reports | All mandatory gate-bypass cases rejected; detection compared at equal compute | If extra reviewer agents add no value, spend on deterministic and behavioral checks |
| CI portability | Versioned corpus of 20 Linux workflows spanning simple scripts through services and cloud auth | Publish exact per-feature outcomes; every “unchanged” claim reproduces reference behavior | If hidden adapters dominate, launch explicit profiles and external execution routing |
| Useful concurrency | Fixed task set at 1, 5, 20, and 100 active agents with fixed total budgets | Report accepted outcomes/hour, human minutes/outcome and total dollars/outcome | If throughput flattens or quality drops, reduce admission rather than market raw agent count |
| Buyer commitment | 5 teams with actual agent integration pain; observe their last 3 troublesome changes | At least 3 agree to a time-bounded pilot on a real repo and identify a budget owner | Praise without a repo/pilot commitment is weak evidence |
| Migration/export | Import, round-trip history and refs, export accepted work plus evidence manifest | No lost accepted commits; unsupported metadata listed; reversible authority transfer | If adoption requires replacing all tooling, keep GitHub-connected mode longer |

Small studies inform product choices, not statistically definitive market claims. Predefine tasks and severity labels, record participant familiarity, and publish failures as well as successes. For any experiment affecting production work, start in shadow/read-only mode and obtain the team's actual authorization before activating mutations.

## Technical gates

**First: correctness with a tiny team.** Reproduce a semantic conflict across different files. Bind validation to an exact candidate. Prove an agent cannot alter the protected check definition or publish directly to main. Reject stale approvals after a revision change. Ensure a preview displays the exact reviewed version.

**Second: interruption and hostile inputs.** Redeliver events, expire leases, interrupt a push after the remote accepts it, cancel a running job, revoke access during a preview, inject malicious repository instructions, and try cross-tenant cache/credential reuse. Recovery must preserve authority and produce an inspectable terminal outcome.

**Third: controlled capacity.** Start with 10 concurrent agents and 2 builders; then 100 logical agents with a constrained active pool. Ramp to 1,000/10,000 synthetic actors for control-plane load only. Label simulated events, real model calls, active Linux jobs, and live previews separately. Add actual concurrent executions only after quotas and measured cost permit it.

**Fourth: useful economics.** Record all model and runtime expenditure, retries, abandoned attempts, storage peaks, runner idle time, and human review. The numerator is an accepted, useful outcome with an observation window for regressions; counting successful process exits is insufficient.

The detailed [Actions conformance program](05-github-actions-portability.md) and [preview/authentication checks](06-identity-mcp-and-live-previews.md) are part of these gates.

## An 8-minute demo worth building

| Time | What the audience sees | What must really work |
| --- | --- | --- |
| 0:00–0:45 | Ask Jev “Why can't team billing ship?” | View reads actual repo/change/evidence records |
| 0:45–1:45 | Several different agents work in isolated forks | Real concurrent work and attributed events |
| 1:45–2:45 | Two changes merge textually but break a billing contract | Actual combined candidate and failing check |
| 2:45–3:45 | Jev lays out two alternatives with evidence | Typed views, sources, uncertainty and version labels |
| 3:45–4:45 | Open both previews with seeded test accounts | Authentication and immutable candidate routes |
| 4:45–5:30 | A base change makes evidence stale; integration is refused | Server-side stale-input gate |
| 5:30–6:30 | Rebuild and validate; integrate the chosen candidate | Exact commit publication and recovery record |
| 6:30–7:15 | Import a Linux workflow; inspect an unsupported cloud-auth dependency | Honest compatibility report, one demonstrated portable workflow |
| 7:15–8:00 | Show control-plane load and total accepted-work cost | Measured data, clearly labeled simulation and limitations |

An optional build sequence for the competition window: 4–5 October prove Artifacts isolation and publication; 6–7 October implement evidence and previews; 8–9 October connect the canvas and agents; 10–11 October exercise races and constrained scale; 12–13 October reproduce the demo from clean instructions. This is a proposed scope, not a delivery estimate or commitment.

The competition page requests a 5–10 minute demo, open-source code, and run instructions. Rules specify a deadline of **14 October 2026, 11:59 p.m. PDT**, Workers **and Artifacts**, concurrent agents, and an MIT/Apache-2.0/BSD license. Judging weights originality/prototype quality 50%, coordination/context/review/conflicts 25%, and UX 25%. Eligibility is limited to adult legal residents of the US or Canada; timezone alone does not establish eligibility. Verify eligibility before planning an entry. These conditions affect a competition submission, not whether to pursue Beanstalk. [Challenge](https://www.cloudflare.com/git-competition/), [official rules](https://www.cloudflare.com/documents/build-next-gen-git-platform-competition-terms.pdf).

## Decisions still open

- **First user:** agent-heavy product team, independent builder, platform/CI team, or public-source maintainer? The proposed slice targets the first.
- **Authority mode:** GitHub-connected pilot or native Beanstalk? Support one writable authority per repository, even if both modes eventually exist.
- **Autonomy:** which classes of low-risk changes may integrate under standing policy, and who owns exceptions?
- **Initial compatibility profile:** small JavaScript/TypeScript web apps are a practical starting assumption, not an established user requirement.
- **Distribution:** will neutral CLI/MCP integration attract teams using mixed agents, or will they prefer the forge bundled with their editor?
- **Retention:** what provenance does a team need, what must remain private, and what is the permitted cost of keeping rejected experiments?

Resolve these from observed pilot work. They are not blockers to the research in this folder, and they should not be disguised as already approved product requirements.
