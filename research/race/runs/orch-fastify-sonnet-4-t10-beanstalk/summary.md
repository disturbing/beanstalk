# Orchestrated race: beanstalk

_orchestrated race: arena=fastify, 10 tasks, forge=beanstalk, claude (sonnet) with 4 sonnet subagents_

| Metric | Value |
|---|---|
| Forge / repo | beanstalk / https://beanstalk-gateway.<account>.workers.dev/git/race/orch-fastify-7-74560.git |
| Orchestrator | orchestrated race: arena=fastify, 10 tasks, forge=beanstalk, claude (sonnet) with 4 sonnet subagents |
| Changes integrated / submitted | 11 / 11 |
| Submitted -> integrated, median / p90 (min) (GitHub: PR opened; Beanstalk: bean pushed) | 0.9 / 0.9 |
| Ready -> integrated, median / p90 (min) (GitHub: enqueued; Beanstalk: pushed) | 0.9 / 0.9 |
| Ready -> stable line, median / p90 (min) | 0.9 / 0.9 |
| Share of wall time with a change waiting | 0.7326 |
| Mean / max changes waiting at once | 0.733 / 1 |
| Integrated per 10 min | 7 4 |
| Kick-outs / red checks / conflicts / re-pushes | 0 / 0 / 0 / 0 |
| Tasks green (acceptance tests on the line) | 10 / 10 |
| Wall (orchestrator) / settled (min) | 14.0 / 14.0 |
| Model spend (USD) | 2.1 |
| CI minutes | 8.64 (preland 8.64) |
| Subagent calls / most running at once | 10 / 5 |
| Final: suite green / tasks accepted / correct | True / 10 of 10 / True |

## Changes

| Change | Task | Ready -> integrated (min) | Kick-outs | Red | Conflicts | Pushes |
|---|---|---|---|---|---|---|
| t001 | t001 | 1.3 | 0 | 0 | 0 | 1 |
| t002 | t002 | 0.9 | 0 | 0 | 0 | 1 |
| t003 | t003 | 0.9 | 0 | 0 | 0 | 1 |
| t004 | t004 | 0.9 | 0 | 0 | 0 | 1 |
| t005 | t005 | 0.9 | 0 | 0 | 0 | 1 |
| t006 | t006 | 0.9 | 0 | 0 | 0 | 1 |
| t007 | t007 | 0.9 | 0 | 0 | 0 | 1 |
| t008 | t008 | 0.9 | 0 | 0 | 0 | 1 |
| t010 | t010 | 0.9 | 0 | 0 | 0 | 1 |
| t009 | t010 | 0.9 | 0 | 0 | 0 | 1 |
| t009-b | t009 | 0.9 | 0 | 0 | 0 | 1 |
