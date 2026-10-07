# Orchestrated race: beanstalk

_orchestrated race: arena=fastify, 38 tasks, forge=beanstalk, claude (sonnet) with 4 sonnet subagents_

| Metric | Value |
|---|---|
| Forge / repo | beanstalk / https://beanstalk-gateway.<account>.workers.dev/git/race/orch-fastify-7-84759.git |
| Orchestrator | orchestrated race: arena=fastify, 38 tasks, forge=beanstalk, claude (sonnet) with 4 sonnet subagents |
| Changes integrated / submitted | 39 / 39 |
| Submitted -> integrated, median / p90 (min) (GitHub: PR opened; Beanstalk: bean pushed) | 1.5 / 2.2 |
| Ready -> integrated, median / p90 (min) (GitHub: enqueued; Beanstalk: pushed) | 1.5 / 2.2 |
| Ready -> stable line, median / p90 (min) | 2.3 / 3.5 |
| Share of wall time with a change waiting | 0.7291 |
| Mean / max changes waiting at once | 1.758 / 4 |
| Integrated per 10 min | 10 12 10 7 0 |
| Kick-outs / red checks / conflicts / re-pushes | 5 / 5 / 0 / 2 |
| Tasks green (acceptance tests on the line) | 38 / 38 |
| Wall (orchestrator) / settled (min) | 42.8 / 42.8 |
| Model spend (USD) | 8.9512 |
| CI minutes | 82.36 (preland 51.15, validate 31.21) |
| Subagent calls / most running at once | 12 / 4 |
| Final: suite green / tasks accepted / correct | True / 38 of 38 / True |

## Changes

| Change | Task | Ready -> integrated (min) | Kick-outs | Red | Conflicts | Pushes |
|---|---|---|---|---|---|---|
| t001 | t001 | 1.8 | 0 | 0 | 0 | 1 |
| t014 | t014 | 2.0 | 0 | 0 | 0 | 1 |
| t015 | t015 | 2.0 | 0 | 0 | 0 | 1 |
| t007 | t007 | 1.5 | 0 | 0 | 0 | 1 |
| t002 | t002 | 2.9 | 0 | 0 | 0 | 1 |
| t016 | t016 | 1.2 | 0 | 0 | 0 | 1 |
| t021 | t021 | 1.2 | 0 | 0 | 0 | 1 |
| t010 | t010 | 1.5 | 0 | 0 | 0 | 1 |
| t017 | t017 | 3.0 | 0 | 0 | 0 | 1 |
| t030 | t030 | 15.0 | 5 | 5 | 0 | 3 |
| t003 | t003 | 1.6 | 0 | 0 | 0 | 1 |
| t004 | t004 | 1.9 | 0 | 0 | 0 | 1 |
| t013 | t013 | 3.0 | 0 | 0 | 0 | 1 |
| t005 | t005 | 2.0 | 0 | 0 | 0 | 1 |
| t006 | t006 | 1.1 | 0 | 0 | 0 | 1 |
| t019 | t019 | 1.2 | 0 | 0 | 0 | 1 |
| t018 | t018 | 1.4 | 0 | 0 | 0 | 1 |
| t008 | t008 | 1.6 | 0 | 0 | 0 | 1 |
| t032 | t032 | 1.1 | 0 | 0 | 0 | 1 |
| t024 | t024 | 1.2 | 0 | 0 | 0 | 1 |
| t033 | t033 | 1.3 | 0 | 0 | 0 | 1 |
| t012 | t012 | 1.5 | 0 | 0 | 0 | 1 |
| t025 | t025 | 1.1 | 0 | 0 | 0 | 1 |
| t034 | t034 | 1.6 | 0 | 0 | 0 | 1 |
| t011 | t011 | 1.3 | 0 | 0 | 0 | 1 |
| t031 | t031 | 1.4 | 0 | 0 | 0 | 1 |
| t035 | t035 | 1.2 | 0 | 0 | 0 | 1 |
| t027 | t027 | 1.5 | 0 | 0 | 0 | 1 |
| t020 | t020 | 1.8 | 0 | 0 | 0 | 1 |
| t029 | t029 | 1.6 | 0 | 0 | 0 | 1 |
| t028 | t028 | 1.3 | 0 | 0 | 0 | 1 |
| t023 | t023 | 1.4 | 0 | 0 | 0 | 1 |
| t009 | t009 | 1.9 | 0 | 0 | 0 | 1 |
| t037 | t037 | 1.7 | 0 | 0 | 0 | 1 |
| t026 | t026 | 1.8 | 0 | 0 | 0 | 1 |
| t036 | t036 | 1.3 | 0 | 0 | 0 | 1 |
| t022 | t022 | 1.3 | 0 | 0 | 0 | 1 |
| fixtests | t032 | 1.1 | 0 | 0 | 0 | 1 |
| t038 | t038 | 1.1 | 0 | 0 | 0 | 1 |
