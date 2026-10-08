# Orchestrated race: beanstalk

_orchestrated race: arena=fastify, 38 tasks, forge=beanstalk, claude (sonnet) with 8 sonnet subagents, guidance=plugin (the Beanstalk plugin's skill in the lead's and workers' prompts instead of the forge section)_

| Metric | Value |
|---|---|
| Forge / repo | beanstalk / https://beanstalk-gateway.<account>.workers.dev/git/race/orch-fastify-7-28106.git |
| Orchestrator | orchestrated race: arena=fastify, 38 tasks, forge=beanstalk, claude (sonnet) with 8 sonnet subagents, guidance=plugin (the Beanstalk plugin's skill in the lead's and workers' prompts instead of the forge section) |
| Changes integrated / submitted | 39 / 39 |
| Submitted -> integrated, median / p90 (min) (GitHub: PR opened; Beanstalk: bean pushed) | 2.8 / 7.3 |
| Ready -> integrated, median / p90 (min) (GitHub: enqueued; Beanstalk: pushed) | 2.8 / 7.3 |
| Ready -> stable line, median / p90 (min) | 3.8 / 8.2 |
| Share of wall time with a change waiting | 0.7662 |
| Mean / max changes waiting at once | 4.284 / 13 |
| Integrated per 10 min | 12 21 6 0 |
| Kick-outs / red checks / conflicts / re-pushes | 7 / 5 / 2 / 4 |
| Tasks green (acceptance tests on the line) | 38 / 38 |
| Wall (orchestrator) / settled (min) | 34.6 / 34.6 |
| Model spend (USD) | 5.5217 |
| CI minutes | 92.03 (preland 63.54, validate 28.48) |
| Subagent calls / most running at once | 8 / 8 |
| Final: suite green / tasks accepted / correct | True / 38 of 38 / True |

## Changes

| Change | Task | Ready -> integrated (min) | Kick-outs | Red | Conflicts | Pushes |
|---|---|---|---|---|---|---|
| t001-head-webstream | t001 | 1.9 | 0 | 0 | 0 | 1 |
| t012-trustproxy-null | t012 | 1.4 | 0 | 0 | 0 | 1 |
| t025-instance-props | t025 | 1.6 | 0 | 0 | 0 | 1 |
| t006-conditional-logging | t006 | 1.8 | 0 | 0 | 0 | 1 |
| fix-validator-throw | None | 1.8 | 0 | 0 | 0 | 1 |
| t014-trailer-end | t014 | 3.6 | 0 | 0 | 0 | 1 |
| t004-diag-status | t004 | 1.7 | 0 | 0 | 0 | 1 |
| t035-callnotfound-prehandler | t035 | 1.3 | 0 | 0 | 0 | 1 |
| t005-defaultroute-types | t005 | 6.6 | 1 | 0 | 1 | 2 |
| t019-no-socket-forwarded | t019 | 1.6 | 0 | 0 | 0 | 1 |
| t020-async-eh-diag | t020 | 1.1 | 0 | 0 | 0 | 1 |
| t031-dep-builtins | t031 | 1.8 | 0 | 0 | 0 | 1 |
| t023-socket-meta | t023 | 14.8 | 1 | 1 | 0 | 2 |
| falsy-validator | None | 1.7 | 0 | 0 | 0 | 1 |
| t030-remove-trailers | t030 | 16.8 | 4 | 4 | 0 | 2 |
| contenttype-schema | None | 1.4 | 0 | 0 | 0 | 1 |
| t029-writehead | t029 | 2.0 | 0 | 0 | 0 | 1 |
| t007-content-type-parsing | t007 | 2.9 | 0 | 0 | 0 | 1 |
| serializer-flag | None | 3.7 | 0 | 0 | 0 | 1 |
| t037-decode-once | t037 | 10.1 | 0 | 0 | 0 | 1 |
| t015-array-dup-route-code | t015 | 2.3 | 0 | 0 | 0 | 1 |
| t026-port-from-host | t026 | 2.2 | 0 | 0 | 0 | 1 |
| serialize-undefined | None | 3.2 | 0 | 0 | 0 | 1 |
| t010-media-type-message | t010 | 4.0 | 0 | 0 | 0 | 1 |
| t017-route-loglevel | t017 | 7.0 | 0 | 0 | 0 | 1 |
| t022-h2-chunk | t022 | 6.4 | 0 | 0 | 0 | 1 |
| lazy-compilers | None | 4.2 | 0 | 0 | 0 | 1 |
| t033-preclose-once | t033 | 3.1 | 0 | 0 | 0 | 1 |
| t024-prefix-double-slash | t024 | 4.0 | 0 | 0 | 0 | 1 |
| t011-port-parsing | serialize-undefined | 3.7 | 0 | 0 | 0 | 1 |
| t036-headers-once | t036 | 3.5 | 0 | 0 | 0 | 1 |
| t008-routeroptions-mutation | t008 | 3.1 | 0 | 0 | 0 | 1 |
| t021-trailer-dup | t021 | 2.8 | 0 | 0 | 0 | 1 |
| t027-findroute-method | t027 | 2.9 | 0 | 0 | 0 | 1 |
| t013-request-media-type | t013 | 2.2 | 0 | 0 | 0 | 1 |
| t034-hidden-prefix-url | t034 | 1.8 | 0 | 0 | 0 | 1 |
| t009-handler-timeout | t009 | 8.8 | 1 | 0 | 1 | 2 |
| t032-regexp-lastindex | t032 | 1.6 | 0 | 0 | 0 | 1 |
| t011-port-parsing-fix | t011 | 1.9 | 0 | 0 | 0 | 1 |
