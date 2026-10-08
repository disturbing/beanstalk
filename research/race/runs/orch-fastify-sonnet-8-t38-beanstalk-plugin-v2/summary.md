# Orchestrated race: beanstalk

_orchestrated race: arena=fastify, 38 tasks, forge=beanstalk, claude (sonnet) with 8 sonnet subagents, guidance=plugin-v2 (the Beanstalk plugin 0.6.0's skill in the lead's and workers' prompts instead of the forge section)_

| Metric | Value |
|---|---|
| Forge / repo | beanstalk / https://beanstalk-gateway.devaccounts-1password.workers.dev/git/race/orch-fastify-7-35810.git |
| Orchestrator | orchestrated race: arena=fastify, 38 tasks, forge=beanstalk, claude (sonnet) with 8 sonnet subagents, guidance=plugin-v2 (the Beanstalk plugin 0.6.0's skill in the lead's and workers' prompts instead of the forge section) |
| Changes integrated / submitted | 38 / 38 |
| Submitted -> integrated, median / p90 (min) (GitHub: PR opened; Beanstalk: bean pushed) | 2.3 / 4.4 |
| Ready -> integrated, median / p90 (min) (GitHub: enqueued; Beanstalk: pushed) | 2.3 / 4.4 |
| Ready -> stable line, median / p90 (min) | 3.6 / 4.9 |
| Share of wall time with a change waiting | 0.8918 |
| Mean / max changes waiting at once | 4.015 / 10 |
| Integrated per 10 min | 14 21 3 |
| Kick-outs / red checks / conflicts / re-pushes | 1 / 0 / 1 / 1 |
| Tasks green (acceptance tests on the line) | 37 / 38 |
| Wall (orchestrator) / settled (min) | 24.2 / 24.2 |
| Model spend (USD) | 4.4794 |
| CI minutes | 73.32 (preland 46.84, validate 26.48) |
| Subagent calls / most running at once | 15 / 8 |
| Final: suite green / tasks accepted / correct | True / 37 of 38 / True |

## Changes

| Change | Task | Ready -> integrated (min) | Kick-outs | Red | Conflicts | Pushes |
|---|---|---|---|---|---|---|
| t001-head-webstream | t001 | 1.4 | 0 | 0 | 0 | 1 |
| t006-cond-log | t006 | 1.8 | 0 | 0 | 0 | 1 |
| t017-loglevel | t017 | 6.2 | 0 | 0 | 0 | 1 |
| t008-router-opts | t008 | 4.0 | 0 | 0 | 0 | 1 |
| t020-async-diag | t020 | 1.1 | 0 | 0 | 0 | 1 |
| t002-validator-throw | t002 | 1.9 | 0 | 0 | 0 | 1 |
| t025-instance-props | t025 | 2.4 | 0 | 0 | 0 | 1 |
| t018-ctparse | t018 | 2.7 | 0 | 0 | 0 | 1 |
| t014-trailer-once | t014 | 3.7 | 0 | 0 | 0 | 1 |
| t015-route-code | t015 | 4.5 | 0 | 0 | 0 | 1 |
| t016-serializer-flag | t016 | 2.3 | 0 | 0 | 0 | 1 |
| t033-preclose | t033 | 2.1 | 0 | 0 | 0 | 1 |
| t003-lazy-compilers | t003 | 3.6 | 0 | 0 | 0 | 1 |
| t019-fwd | t019 | 2.0 | 0 | 0 | 0 | 1 |
| t004-diag-status | t004 | 1.3 | 0 | 0 | 0 | 1 |
| t022-h2-chunk | t022 | 1.4 | 0 | 0 | 0 | 1 |
| t005-router-types | t005 | 2.3 | 0 | 0 | 0 | 1 |
| t027-findroute | t027 | 2.4 | 0 | 0 | 0 | 1 |
| t009-handler-timeout | t003-lazy-compilers | 2.5 | 0 | 0 | 0 | 1 |
| t028-falsy | t028 | 2.1 | 0 | 0 | 0 | 1 |
| t023-meta | t023 | 2.1 | 0 | 0 | 0 | 1 |
| t029-writehead | t029 | 2.3 | 0 | 0 | 0 | 1 |
| t026-port | t026 | 3.5 | 0 | 0 | 0 | 1 |
| t036-hdr-once | t036 | 1.7 | 0 | 0 | 0 | 1 |
| t007-ctype | t007 | 2.1 | 0 | 0 | 0 | 1 |
| t012-trust | t012 | 1.7 | 0 | 0 | 0 | 1 |
| t037-decode-once | t037 | 4.6 | 0 | 0 | 0 | 1 |
| t024-prefix | t024 | 2.6 | 0 | 0 | 0 | 1 |
| t038-ser-undef | t038 | 2.7 | 0 | 0 | 0 | 1 |
| t032-lastindex | t032 | 4.3 | 0 | 0 | 0 | 1 |
| t010-media-msg | t010 | 2.6 | 0 | 0 | 0 | 1 |
| t030-trailer-clear | t030 | 2.5 | 0 | 0 | 0 | 1 |
| t011-port | t011 | 2.1 | 0 | 0 | 0 | 1 |
| t013-mediatype | t013 | 4.8 | 1 | 0 | 1 | 2 |
| t034-slash | t034 | 1.7 | 0 | 0 | 0 | 1 |
| t021-trailer-dup | t021 | 1.6 | 0 | 0 | 0 | 1 |
| t035-nf-prehandler | t035 | 1.4 | 0 | 0 | 0 | 1 |
| t031-builtin-deps | t031 | 1.0 | 0 | 0 | 0 | 1 |
