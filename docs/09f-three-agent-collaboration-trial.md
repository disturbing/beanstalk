# Three-agent collaboration trial

Codex, 2026-10-06. Result: three real coding subagents built a fresh native Git repository while negotiating through Beanstalk's actual MCP Worker, gateway service binding and SQLite RunDO. All ten protected app tests passed. Both consumers recovered a revised promise after a full Worker restart, explicitly accepted it and acknowledged delivery without losing the previous agreement.

The collaboration feature was integrated and committed on `prototype` as `e5f344c`. The trial used frozen compiled Worker bundles; their SHA-256 digests are in the [evidence](../research/bean-collaboration-trial/r1ho1p4lr0/bundle-sha256.json). Other sessions were modifying the shared checkout, so restarts reused that snapshot and the repository check ran in a clean worktree at `e5f344c`. This report does not certify later changes.

## What the agents built

The new repository is `/Users/coop/Workspace/beanstalk-collaboration-demo`, branch `trial`, integrated commit `c033286`. A portable [app snapshot](../research/bean-collaboration-trial/r1ho1p4lr0/app/README.md) and its [Git history](../research/bean-collaboration-trial/r1ho1p4lr0/app-git-history.txt) are saved with the evidence.

| Contributor | Owning bean | Independently authored module | Protected tests |
| --- | --- | --- | --- |
| Shipping | `t001` | Business-day delivery dates, holiday handling and elapsed calendar days | 5 passed |
| Checkout | `t002` | Calendar-day delivery display kept distinct from business days | 2 passed |
| Returns | `t003` | Thirty calendar days from delivery, including weekends | 3 passed |

The scaffold and acceptance tests were committed before implementation. The initial suite failed because the modules did not exist. Each contributor had an exclusive Git worktree and used the plugin's instructions plus an MCP SDK client. Requests and semantic responses went through bean threads; the coordinator supplied operational timing and integrated the source. The protected tests and package scripts stayed unchanged.

## Recorded negotiation and recovery

Run `r1ho1p4lr0` was served locally at `127.0.0.1:8894`. Role capabilities were kept in private runtime files. The journals contain redacted tool calls and actual server responses.

| Step | Checkout | Returns |
| --- | --- | --- |
| Clarification request | Event 3 | Event 6 |
| Provider's exact reply | Event 7 | Event 8 |
| Explicit acceptance of `delivery-contract@1` | Event 10 | Event 11 |
| Provider revised the offer | Shared event 13, revision 2 | Shared event 13, revision 2 |
| Addressed provider note while consumer offline | Event 14 | Event 15 |
| After Worker restart | Same two unread events; reliance still at revision 1 | Same two unread events; reliance still at revision 1 |
| Explicit acceptance of revision 2 | Event 16 | Event 17 |
| After delivery acknowledgement | Zero unread; historical acceptance retained | Zero unread; historical acceptance retained |

The revised offer clarified the shipping implementation's UTC date range and validation. Context retained the exact original wording and labeled the old pin superseded by the current head. Neither the provider revision nor inbox delivery automatically advanced a consumer's reliance. The consumers independently inspected the offer before accepting it through their existing threads. The full pre/post-restart inbox pages were identical; Worker bundle digests were unchanged.

## Checks and practical limits

The combined [app suite](../research/bean-collaboration-trial/r1ho1p4lr0/combined-app-tests.txt) passed all ten tests. Live capability checks rejected stale revisions, editing another bean, changing a retried payload, view-token mutation, contributor-token Git access and use of the token through another run's HTTP path. An exact retry returned its original result. [Access evidence](../research/bean-collaboration-trial/r1ho1p4lr0/access-and-retry-verification.json) and [restart evidence](../research/bean-collaboration-trial/r1ho1p4lr0/restart-verification.json) are saved.

`pnpm check` passed in the clean feature worktree: 511 TypeScript tests plus Rust formatting, Clippy and tests. An initial cold run timed out in six existing engine simulation tests at their five-second threshold; the unchanged rerun passed. No timeout flags or test changes were used. Both check outputs are retained in the evidence directory.

Artifacts and the container runner used the existing external-service fixtures. Those fixtures keep repository data in ephemeral module memory, so ordinary Git-backed Ask context was unavailable after restart; canonical approach discovery, promises, threads and inboxes remained available in SQLite. The native Git repository and coordinator merges validated the code combination. This trial does not establish hosted Artifacts transport, automatic engine landing, production deployment or 1,000-contributor performance. The tested feature checkpoint still uses run-configured beans capped at 200.

## Review or rerun the captured checks

```bash
python3 research/bean-collaboration-trial/r1ho1p4lr0/verify.py
cd /Users/coop/Workspace/beanstalk-collaboration-demo
npm test
```

The [captured harness](../research/bean-collaboration-trial/r1ho1p4lr0/captured-harness/README.md) documents the live setup and its workspace-specific paths. Runtime credentials and SQLite files were excluded from the repository; the local server was stopped after evidence capture.
