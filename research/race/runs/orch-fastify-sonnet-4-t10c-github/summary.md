# Orchestrated race: github

_orchestrated race: arena=fastify, 10 tasks, forge=github, claude (sonnet) with 4 sonnet subagents_

| Metric | Value |
|---|---|
| Forge / repo | github / https://github.com/kintohubtest/beanstalk-orch-fastify-7 |
| Orchestrator | orchestrated race: arena=fastify, 10 tasks, forge=github, claude (sonnet) with 4 sonnet subagents |
| Changes integrated / submitted | 10 / 10 |
| Submitted -> integrated, median / p90 (min) (GitHub: PR opened; Beanstalk: bean pushed) | 8.8 / 11.1 |
| Ready -> integrated, median / p90 (min) (GitHub: enqueued; Beanstalk: pushed) | 5.5 / 6.6 |
| Ready -> stable line, median / p90 (min) | - / - |
| Share of wall time with a change waiting | 0.499 |
| Mean / max changes waiting at once | 1.803 / 8 |
| Integrated per 10 min | 1 8 1 |
| Kick-outs / red checks / conflicts / re-pushes | 0 / 0 / 0 / 0 |
| Tasks green (acceptance tests on the line) | 10 / 10 |
| Wall (orchestrator) / settled (min) | 29.7 / 29.8 |
| Model spend (USD) | 2.4514 |
| CI minutes | 17.57 (batch 8.8, precheck 8.77) |
| Subagent calls / most running at once | 10 / 5 |
| Final: suite green / tasks accepted / correct | True / 10 of 10 / True |

## Changes

| Change | Task | Ready -> integrated (min) | Kick-outs | Red | Conflicts | Pushes |
|---|---|---|---|---|---|---|
| #36 | t009 | 1.9 | 0 | 0 | 0 | 1 |
| #35 | t007 | 5.2 | 0 | 0 | 0 | 1 |
| #34 | t010 | 5.7 | 0 | 0 | 0 | 1 |
| #33 | t008 | 5.5 | 0 | 0 | 0 | 1 |
| #32 | t006 | 5.4 | 0 | 0 | 0 | 1 |
| #31 | t005 | 6.5 | 0 | 0 | 0 | 1 |
| #30 | t004 | 5.5 | 0 | 0 | 0 | 1 |
| #29 | t003 | 5.5 | 0 | 0 | 0 | 1 |
| #28 | t001 | 5.2 | 0 | 0 | 0 | 1 |
| #27 | t002 | 7.3 | 0 | 0 | 0 | 1 |
