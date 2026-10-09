# Orchestrated race: beanstalk

_orchestrated race: arena=fastify, 38 tasks, forge=beanstalk, claude (sonnet) with 8 sonnet subagents_

| Metric | Value |
|---|---|
| Forge / repo | beanstalk / https://beanstalk-gateway.devaccounts-1password.workers.dev/git/race/orch-fastify-11-75218.git |
| Orchestrator | orchestrated race: arena=fastify, 38 tasks, forge=beanstalk, claude (sonnet) with 8 sonnet subagents |
| Changes integrated / submitted | 38 / 38 |
| Submitted -> integrated, median / p90 (min) (GitHub: PR opened; Beanstalk: bean pushed) | 1.4 / 4.2 |
| Ready -> integrated, median / p90 (min) (GitHub: enqueued; Beanstalk: pushed) | 1.4 / 4.2 |
| Ready -> stable line, median / p90 (min) | 2.3 / 4.7 |
| Share of wall time with a change waiting | 0.8105 |
| Mean / max changes waiting at once | 2.977 / 6 |
| Integrated per 10 min | 18 14 6 0 |
| Kick-outs / red checks / conflicts / re-pushes | 16 / 12 / 4 / 10 |
| Tasks green (acceptance tests on the line) | 38 / 38 |
| Wall (orchestrator) / settled (min) | 30.3 / 30.3 |
| Model spend (USD) | 4.1512 |
| CI minutes | 79.9 (preland 57.16, validate 22.73) |
| Subagent calls / most running at once | 9 / 9 |
| Final: suite green / tasks accepted / correct | True / 38 of 38 / True |

## Changes

| Change | Task | Ready -> integrated (min) | Kick-outs | Red | Conflicts | Pushes |
|---|---|---|---|---|---|---|
| t002 | t002 | 1.5 | 0 | 0 | 0 | 1 |
| t012 | t012 | 1.8 | 0 | 0 | 0 | 1 |
| t003 | t003 | 1.6 | 0 | 0 | 0 | 1 |
| t005 | t005 | 2.0 | 0 | 0 | 0 | 1 |
| t022 | t022 | 3.2 | 1 | 1 | 0 | 2 |
| t001 | t001 | 1.8 | 0 | 0 | 0 | 1 |
| t004 | t004 | 1.2 | 0 | 0 | 0 | 1 |
| t028 | t028 | 1.4 | 0 | 0 | 0 | 1 |
| t007 | t007 | 2.0 | 0 | 0 | 0 | 1 |
| t006 | t006 | 3.9 | 1 | 0 | 1 | 2 |
| t019 | t019 | 1.1 | 0 | 0 | 0 | 1 |
| t016 | t016 | 1.0 | 0 | 0 | 0 | 1 |
| t014 | t014 | 1.0 | 0 | 0 | 0 | 1 |
| t008 | t008 | 1.4 | 0 | 0 | 0 | 1 |
| t020 | t020 | 1.8 | 0 | 0 | 0 | 1 |
| t018 | t018 | 1.3 | 0 | 0 | 0 | 1 |
| t023 | t023 | 13.0 | 1 | 1 | 0 | 2 |
| t021 | t021 | 1.5 | 0 | 0 | 0 | 1 |
| t017 | t017 | 3.0 | 0 | 0 | 0 | 1 |
| t010 | t010 | 1.3 | 0 | 0 | 0 | 1 |
| t026 | t026 | 13.0 | 7 | 6 | 1 | 5 |
| t038 | t038 | 1.0 | 0 | 0 | 0 | 1 |
| t033 | t033 | 1.0 | 0 | 0 | 0 | 1 |
| t030 | t030 | 5.8 | 4 | 4 | 0 | 2 |
| t035 | t035 | 1.1 | 0 | 0 | 0 | 1 |
| t024 | t024 | 1.0 | 0 | 0 | 0 | 1 |
| t013 | t013 | 1.2 | 0 | 0 | 0 | 1 |
| t009 | t009 | 4.7 | 2 | 0 | 2 | 3 |
| t015 | t015 | 2.8 | 0 | 0 | 0 | 1 |
| t034 | t034 | 1.1 | 0 | 0 | 0 | 1 |
| t032 | t032 | 1.3 | 0 | 0 | 0 | 1 |
| t029 | t029 | 2.0 | 0 | 0 | 0 | 1 |
| t027 | t027 | 1.2 | 0 | 0 | 0 | 1 |
| t011 | t011 | 0.9 | 0 | 0 | 0 | 1 |
| t025 | t025 | 1.0 | 0 | 0 | 0 | 1 |
| t036 | t036 | 2.6 | 0 | 0 | 0 | 1 |
| t031 | t031 | 0.9 | 0 | 0 | 0 | 1 |
| t037 | t037 | 0.9 | 0 | 0 | 0 | 1 |
