# Orchestrated race: beanstalk

_orchestrated race: arena=fastify, 38 tasks, forge=beanstalk, claude (sonnet) with 8 sonnet subagents_

| Metric | Value |
|---|---|
| Forge / repo | beanstalk / https://beanstalk-gateway.<account>.workers.dev/git/race/orch-fastify-7-89428.git |
| Orchestrator | orchestrated race: arena=fastify, 38 tasks, forge=beanstalk, claude (sonnet) with 8 sonnet subagents |
| Changes integrated / submitted | 38 / 38 |
| Submitted -> integrated, median / p90 (min) (GitHub: PR opened; Beanstalk: bean pushed) | 1.0 / 2.7 |
| Ready -> integrated, median / p90 (min) (GitHub: enqueued; Beanstalk: pushed) | 1.0 / 2.7 |
| Ready -> stable line, median / p90 (min) | 1.9 / 3.6 |
| Share of wall time with a change waiting | 0.8022 |
| Mean / max changes waiting at once | 2.401 / 7 |
| Integrated per 10 min | 17 18 3 |
| Kick-outs / red checks / conflicts / re-pushes | 7 / 1 / 6 / 7 |
| Tasks green (acceptance tests on the line) | 38 / 38 |
| Wall (orchestrator) / settled (min) | 25.8 / 25.8 |
| Model spend (USD) | 5.2522 |
| CI minutes | 60.45 (preland 38.97, validate 21.48) |
| Subagent calls / most running at once | 9 / 9 |
| Final: suite green / tasks accepted / correct | True / 38 of 38 / True |

## Changes

| Change | Task | Ready -> integrated (min) | Kick-outs | Red | Conflicts | Pushes |
|---|---|---|---|---|---|---|
| t002 | t002 | 1.5 | 0 | 0 | 0 | 1 |
| t003 | t003 | 1.4 | 0 | 0 | 0 | 1 |
| t004 | t004 | 1.8 | 0 | 0 | 0 | 1 |
| t001 | t001 | 1.4 | 0 | 0 | 0 | 1 |
| t005 | t005 | 0.9 | 0 | 0 | 0 | 1 |
| t006 | t006 | 2.9 | 1 | 0 | 1 | 2 |
| t011 | t011 | 0.7 | 0 | 0 | 0 | 1 |
| t009 | t009 | 10.7 | 3 | 0 | 3 | 4 |
| t010 | t010 | 0.9 | 0 | 0 | 0 | 1 |
| t012 | t012 | 1.2 | 0 | 0 | 0 | 1 |
| t008 | t008 | 2.7 | 0 | 0 | 0 | 1 |
| t007 | t007 | 2.6 | 0 | 0 | 0 | 1 |
| t019 | t019 | 1.2 | 0 | 0 | 0 | 1 |
| t018 | t018 | 0.9 | 0 | 0 | 0 | 1 |
| t014 | t014 | 1.0 | 0 | 0 | 0 | 1 |
| t013 | t013 | 2.7 | 1 | 0 | 1 | 2 |
| t027 | t027 | 0.9 | 0 | 0 | 0 | 1 |
| t016 | t016 | 0.9 | 0 | 0 | 0 | 1 |
| t020 | t020 | 1.7 | 0 | 0 | 0 | 1 |
| t015 | t015 | 0.9 | 0 | 0 | 0 | 1 |
| t035 | t035 | 0.9 | 0 | 0 | 0 | 1 |
| t024 | t024 | 0.9 | 0 | 0 | 0 | 1 |
| t021 | t021 | 1.0 | 0 | 0 | 0 | 1 |
| t023 | t023 | 6.5 | 1 | 1 | 0 | 2 |
| t026 | t026 | 0.9 | 0 | 0 | 0 | 1 |
| t032 | t032 | 1.0 | 0 | 0 | 0 | 1 |
| t028 | t028 | 0.9 | 0 | 0 | 0 | 1 |
| t034 | t034 | 1.1 | 0 | 0 | 0 | 1 |
| t029 | t029 | 0.9 | 0 | 0 | 0 | 1 |
| t022 | t022 | 0.9 | 0 | 0 | 0 | 1 |
| t036 | t036 | 1.0 | 0 | 0 | 0 | 1 |
| t037 | t037 | 0.9 | 0 | 0 | 0 | 1 |
| t017 | t017 | 0.8 | 0 | 0 | 0 | 1 |
| t025 | t025 | 0.8 | 0 | 0 | 0 | 1 |
| t030 | t030 | 0.9 | 0 | 0 | 0 | 1 |
| t031 | t031 | 1.4 | 1 | 0 | 1 | 2 |
| t033 | t033 | 0.9 | 0 | 0 | 0 | 1 |
| t038 | t038 | 1.1 | 0 | 0 | 0 | 1 |
