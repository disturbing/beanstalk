# Cloudflare Artifacts: a push of a revert fails with "stored delta chain contains a cycle"

**Seen:** 2026-10-03, about 23:30 HKT, account `2c7358a6…`, namespace `beanstalk-race`, repo `race-8598u7h6ss`, during a real-agent cloud race (`research/race/runs/cf-v2-sonnet-12-s7-r2`).

**What happened.** Beanstalk's runner container pushed a revert commit to a candidate ref with plain `git push --porcelain <artifacts-url> <sha>:refs/beanstalk/candidates/<sha>`. Artifacts answered:

```
remote: Processing objects: 100% (8/8)
error: remote unpack failed: stored delta chain contains a cycle
error: failed to push some refs to 'https://<account>.artifacts.cloudflare.net/git/beanstalk-race/race-8598u7h6ss.git'
```

**Likely cause (our reading, unconfirmed by Cloudflare).**
1. A revert recreates an *older* version of a file.
2. Git's pack for the push encodes that old blob as a delta against the *newer* blob, which the server already has.
3. The server apparently stores the newer blob as a delta against the old one from the earlier push.
4. Resolving the new object then walks old → new → old.

Any workflow that reverts, or reintroduces earlier content, can hit this. Revert-first trunks do it routinely.

**Workaround in Beanstalk.** The runner now pushes with `-c pack.window=0`, so the pack carries whole objects and no deltas (`packages/runner/src/git/cache.rs`, `NO_DELTAS`). The cost is larger pushes; correctness is unaffected.

**Ask for Cloudflare.**
- Detect cycles on ingest and store the object whole (break the chain), or re-delta only against objects whose own chain doesn't pass through the incoming one.
- Return a retryable error with a hint (`--no-thin` or `pack.window=0`) until fixed.
