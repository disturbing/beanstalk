# Orchestrated race: beanstalk

_orchestrated race: arena=fastify, 38 tasks, forge=beanstalk, claude (sonnet) with 8 sonnet subagents, guidance=plugin-v2 (the Beanstalk plugin 0.6.0's skill in the lead's and workers' prompts instead of the forge section)_

| Metric | Value |
|---|---|
| Forge / repo | beanstalk / https://beanstalk-gateway.devaccounts-1password.workers.dev/git/race/orch-fastify-7-12063.git |
| Orchestrator | orchestrated race: arena=fastify, 38 tasks, forge=beanstalk, claude (sonnet) with 8 sonnet subagents, guidance=plugin-v2 (the Beanstalk plugin 0.6.0's skill in the lead's and workers' prompts instead of the forge section) |
| Changes integrated / submitted | 39 / 39 |
| Submitted -> integrated, median / p90 (min) (GitHub: PR opened; Beanstalk: bean pushed) | 1.7 / 3.6 |
| Ready -> integrated, median / p90 (min) (GitHub: enqueued; Beanstalk: pushed) | 1.7 / 3.6 |
| Ready -> stable line, median / p90 (min) | 2.8 / 4.5 |
| Share of wall time with a change waiting | 0.9483 |
| Mean / max changes waiting at once | 4.093 / 10 |
| Integrated per 10 min | 13 13 3 10 |
| Kick-outs / red checks / conflicts / re-pushes | 5 / 1 / 4 / 5 |
| Tasks green (acceptance tests on the line) | 38 / 38 |
| Wall (orchestrator) / settled (min) | 36.4 / 36.4 |
| Model spend (USD) | 5.5352 |
| CI minutes | 82.84 (preland 54.23, validate 28.61) |
| Subagent calls / most running at once | 9 / 7 |
| Final: suite green / tasks accepted / correct | True / 38 of 38 / True |

## Changes

| Change | Task | Ready -> integrated (min) | Kick-outs | Red | Conflicts | Pushes |
|---|---|---|---|---|---|---|
| t011 | t011 | 1.7 | 0 | 0 | 0 | 1 |
| t004 | t004 | 1.8 | 0 | 0 | 0 | 1 |
| t001 | t001 | 1.6 | 0 | 0 | 0 | 1 |
| t002 | t002 | 2.1 | 0 | 0 | 0 | 1 |
| t003 | t003 | 2.0 | 0 | 0 | 0 | 1 |
| t012 | t012 | 2.0 | 0 | 0 | 0 | 1 |
| t020 | t020 | 30.1 | 1 | 0 | 1 | 2 |
| t014 | t014 | 1.6 | 0 | 0 | 0 | 1 |
| t009 | t009 | 29.0 | 1 | 0 | 1 | 2 |
| t021 | t021 | 1.1 | 0 | 0 | 0 | 1 |
| t016 | t016 | 1.1 | 0 | 0 | 0 | 1 |
| t019 | t019 | 1.1 | 0 | 0 | 0 | 1 |
| t005 | t005 | 1.2 | 0 | 0 | 0 | 1 |
| t026 | t026 | 1.1 | 0 | 0 | 0 | 1 |
| t018 | t018 | 1.4 | 0 | 0 | 0 | 1 |
| t036 | t036 | 3.7 | 1 | 0 | 1 | 2 |
| t008 | t008 | 1.5 | 0 | 0 | 0 | 1 |
| t028 | t028 | 2.0 | 0 | 0 | 0 | 1 |
| t007 | t007 | 3.4 | 0 | 0 | 0 | 1 |
| t029 | t029 | 2.0 | 0 | 0 | 0 | 1 |
| t030 | t030 | 3.1 | 0 | 0 | 0 | 1 |
| t022 | t022 | 3.0 | 0 | 0 | 0 | 1 |
| t015 | t015 | 1.7 | 0 | 0 | 0 | 1 |
| t038 | t038 | 2.5 | 0 | 0 | 0 | 1 |
| t025 | t025 | 1.3 | 0 | 0 | 0 | 1 |
| t023 | t023 | 21.4 | 1 | 1 | 0 | 2 |
| t024 | t024 | 1.9 | 0 | 0 | 0 | 1 |
| t010 | t010 | 1.8 | 0 | 0 | 0 | 1 |
| t027 | t027 | 1.4 | 0 | 0 | 0 | 1 |
| t033 | t033 | 1.7 | 0 | 0 | 0 | 1 |
| fix-acceptance-tests-t018-t038 | t018 | 1.8 | 0 | 0 | 0 | 1 |
| t006 | t006 | 3.6 | 0 | 0 | 0 | 1 |
| t034 | t034 | 1.5 | 0 | 0 | 0 | 1 |
| t017 | t017 | 1.5 | 0 | 0 | 0 | 1 |
| t035 | t035 | 1.7 | 0 | 0 | 0 | 1 |
| t031 | t031 | 1.4 | 0 | 0 | 0 | 1 |
| t013 | t013 | 3.3 | 1 | 0 | 1 | 2 |
| t032 | t032 | 1.7 | 0 | 0 | 0 | 1 |
| t037 | t037 | 1.3 | 0 | 0 | 0 | 1 |
