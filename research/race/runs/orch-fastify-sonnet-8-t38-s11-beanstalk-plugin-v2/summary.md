# Orchestrated race: beanstalk

_orchestrated race: arena=fastify, 38 tasks, forge=beanstalk, claude (sonnet) with 8 sonnet subagents, guidance=plugin-v2 (the Beanstalk plugin 0.6.0's skill in the lead's and workers' prompts instead of the forge section)_

| Metric | Value |
|---|---|
| Forge / repo | beanstalk / https://beanstalk-gateway.devaccounts-1password.workers.dev/git/race/orch-fastify-11-70984.git |
| Orchestrator | orchestrated race: arena=fastify, 38 tasks, forge=beanstalk, claude (sonnet) with 8 sonnet subagents, guidance=plugin-v2 (the Beanstalk plugin 0.6.0's skill in the lead's and workers' prompts instead of the forge section) |
| Changes integrated / submitted | 65 / 66 |
| Submitted -> integrated, median / p90 (min) (GitHub: PR opened; Beanstalk: bean pushed) | 2.1 / 4.1 |
| Ready -> integrated, median / p90 (min) (GitHub: enqueued; Beanstalk: pushed) | 2.1 / 4.1 |
| Ready -> stable line, median / p90 (min) | 3.2 / 5.3 |
| Share of wall time with a change waiting | 0.9512 |
| Mean / max changes waiting at once | 3.536 / 23 |
| Integrated per 10 min | 15 22 3 24 1 |
| Kick-outs / red checks / conflicts / re-pushes | 11 / 10 / 1 / 7 |
| Tasks green (acceptance tests on the line) | 38 / 38 |
| Wall (orchestrator) / settled (min) | 46.2 / 46.2 |
| Model spend (USD) | 5.6199 |
| CI minutes | 109.35 (preland 80.25, validate 29.1) |
| Subagent calls / most running at once | 9 / 8 |
| Final: suite green / tasks accepted / correct | True / 38 of 38 / True |

## Changes

| Change | Task | Ready -> integrated (min) | Kick-outs | Red | Conflicts | Pushes |
|---|---|---|---|---|---|---|
| head-web-stream | None | 1.1 | 0 | 0 | 0 | 1 |
| t002-validator-throw | t002 | 1.3 | 0 | 0 | 0 | 1 |
| trailer-sync-end | None | 1.2 | 0 | 0 | 0 | 1 |
| prefix-slash | None | 1.2 | 0 | 0 | 0 | 1 |
| trust-proxy-t012 | t012 | 1.0 | 0 | 0 | 0 | 1 |
| diag-status | None | 1.1 | 0 | 0 | 0 | 1 |
| t028-falsy-value | t028 | 2.2 | 0 | 0 | 0 | 1 |
| t005 | t005 | 1.2 | 0 | 0 | 0 | 1 |
| decorators | None | 0.8 | 0 | 0 | 0 | 1 |
| trust-proxy-t019 | t019 | 0.8 | 0 | 0 | 0 | 1 |
| t016-serializer-flag | t016 | 1.2 | 0 | 0 | 0 | 1 |
| trailer-dup-completion | None | 0.9 | 0 | 0 | 0 | 1 |
| t006 | t016-serializer-flag | 0.7 | 0 | 0 | 0 | 1 |
| t038-serializer-undefined | t038 | 0.8 | 0 | 0 | 0 | 1 |
| preclose | None | 1.3 | 0 | 0 | 0 | 1 |
| t006-request-logging-fn | t006 | 5.9 | 0 | 0 | 0 | 1 |
| t009-handler-timeout | t038-serializer-undefined | 1.2 | 0 | 0 | 0 | 1 |
| t003-lazy-compilers | t003 | 1.3 | 0 | 0 | 0 | 1 |
| route-url | None | 1.5 | 0 | 0 | 0 | 1 |
| t008 | t008 | 3.0 | 0 | 0 | 0 | 1 |
| trailer-clear-state | None | 6.2 | 4 | 4 | 0 | 2 |
| nf-prehandler | None | 1.3 | 0 | 0 | 0 | 1 |
| diag-async-eh | None | 1.9 | 0 | 0 | 0 | 1 |
| t015 | t015 | 4.9 | 0 | 0 | 0 | 1 |
| request-port-t026 | t026 | 3.2 | 0 | 0 | 0 | 1 |
| content-type-parsing | None | 2.4 | 0 | 0 | 0 | 1 |
| t011-port-parse | t011 | 4.1 | 1 | 0 | 1 | 2 |
| t027-findroute-method | t027 | 2.0 | 0 | 0 | 0 | 1 |
| t017 | t017 | 2.0 | 0 | 0 | 0 | 1 |
| writehead-catch | None | 1.6 | 0 | 0 | 0 | 1 |
| string-body-t037 | t037 | 1.4 | 0 | 0 | 0 | 1 |
| ctp-media-type-message | None | 1.5 | 0 | 0 | 0 | 1 |
| headers-once-t036 | t036 | 2.1 | 0 | 0 | 0 | 1 |
| t009-handler-timeout-impl | ctp-media-type-message | 1.1 | 0 | 0 | 0 | 1 |
| clear-socket-meta | None | - | 4 | 4 | 0 | 4 |
| ctp-regexp-lastindex | None | 1.3 | 0 | 0 | 0 | 1 |
| schema-contenttype-lookup | None | 1.2 | 0 | 0 | 0 | 1 |
| request-media-type | None | 1.2 | 0 | 0 | 0 | 1 |
| http2-chunk-buffers | None | 6.8 | 1 | 1 | 0 | 2 |
| t009-handler-timeout-v2 | request-media-type | 1.3 | 0 | 0 | 0 | 1 |
| t009-handler-timeout-v3 | t009 | 0.8 | 0 | 0 | 0 | 1 |
| t001 | t001 | 1.5 | 0 | 0 | 0 | 1 |
| t004 | t004 | 1.1 | 0 | 0 | 0 | 1 |
| t007 | t007 | 2.6 | 0 | 0 | 0 | 1 |
| t010 | t010 | 3.7 | 0 | 0 | 0 | 1 |
| t012 | t012 | 3.6 | 0 | 0 | 0 | 1 |
| t013 | t013 | 3.6 | 0 | 0 | 0 | 1 |
| t014 | t014 | 3.6 | 0 | 0 | 0 | 1 |
| t018 | t018 | 3.7 | 0 | 0 | 0 | 1 |
| t019 | t019 | 3.7 | 0 | 0 | 0 | 1 |
| t020 | t020 | 3.7 | 0 | 0 | 0 | 1 |
| t021 | t021 | 3.5 | 0 | 0 | 0 | 1 |
| t022 | t022 | 3.6 | 0 | 0 | 0 | 1 |
| t024 | t024 | 3.4 | 0 | 0 | 0 | 1 |
| t025 | t025 | 4.7 | 0 | 0 | 0 | 1 |
| t026 | t026 | 3.3 | 0 | 0 | 0 | 1 |
| t029 | t029 | 3.3 | 0 | 0 | 0 | 1 |
| t030 | t030 | 3.2 | 0 | 0 | 0 | 1 |
| t031 | t031 | 3.2 | 0 | 0 | 0 | 1 |
| t032 | t032 | 3.2 | 0 | 0 | 0 | 1 |
| t033 | t033 | 3.2 | 0 | 0 | 0 | 1 |
| t034 | t034 | 4.1 | 0 | 0 | 0 | 1 |
| t035 | t035 | 3.2 | 0 | 0 | 0 | 1 |
| t036 | t036 | 3.2 | 0 | 0 | 0 | 1 |
| t037 | t037 | 4.0 | 0 | 0 | 0 | 1 |
| t023 | t023 | 5.3 | 1 | 1 | 0 | 2 |
