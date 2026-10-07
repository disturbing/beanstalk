# Orchestrated race: github

_orchestrated race: arena=fastify, 10 tasks, forge=github, claude (sonnet) with 4 sonnet subagents_

| Metric | Value |
|---|---|
| Forge / repo | github / https://github.com/kintohubtest/beanstalk-orch-fastify-7 |
| Orchestrator | orchestrated race: arena=fastify, 10 tasks, forge=github, claude (sonnet) with 4 sonnet subagents |
| Changes integrated / submitted | 10 / 10 |
| Submitted -> integrated, median / p90 (min) (GitHub: PR opened; Beanstalk: bean pushed) | 4.1 / 13.3 |
| Ready -> integrated, median / p90 (min) (GitHub: enqueued; Beanstalk: pushed) | 1.8 / 2.6 |
| Ready -> stable line, median / p90 (min) | - / - |
| Share of wall time with a change waiting | 0.3323 |
| Mean / max changes waiting at once | 0.497 / 4 |
| Integrated per 10 min | 4 4 1 1 |
| Kick-outs / red checks / conflicts / re-pushes | 0 / 0 / 0 / 0 |
| Tasks green (acceptance tests on the line) | 10 / 10 |
| Wall (orchestrator) / settled (min) | 35.8 / 38.8 |
| Model spend (USD) | 2.8629 |
| CI minutes | 19.15 (batch 9.13, precheck 10.02) |
| Subagent calls / max in one message / background | 10 / 1 / 10 |
| Final: suite green / tasks accepted / correct | True / 10 of 10 / True |

## Changes

| Change | Task | Ready -> integrated (min) | Kick-outs | Red | Conflicts | Pushes |
|---|---|---|---|---|---|---|
| #25 | t010 | 1.9 | 0 | 0 | 0 | 1 |
| #24 | t009 | 1.9 | 0 | 0 | 0 | 1 |
| #23 | t006 | 1.8 | 0 | 0 | 0 | 1 |
| #22 | t007 | 1.3 | 0 | 0 | 0 | 1 |
| #21 | t008 | 1.5 | 0 | 0 | 0 | 1 |
| #20 | t005 | 1.8 | 0 | 0 | 0 | 1 |
| #19 | t004 | 3.1 | 0 | 0 | 0 | 1 |
| #18 | t001 | 2.5 | 0 | 0 | 0 | 1 |
| #17 | t002 | 1.8 | 0 | 0 | 0 | 1 |
| #16 | t003 | 1.6 | 0 | 0 | 0 | 1 |
