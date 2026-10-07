# Orchestrated race: github

_orchestrated race: arena=fastify, 10 tasks, forge=github, claude (sonnet) with 4 sonnet subagents_

| Metric | Value |
|---|---|
| Forge / repo | github / https://github.com/kintohubtest/beanstalk-orch-fastify-7 |
| Orchestrator | orchestrated race: arena=fastify, 10 tasks, forge=github, claude (sonnet) with 4 sonnet subagents |
| Changes integrated / submitted | 12 / 12 |
| Submitted -> integrated, median / p90 (min) (GitHub: PR opened; Beanstalk: bean pushed) | 3.4 / 4.1 |
| Ready -> integrated, median / p90 (min) (GitHub: enqueued; Beanstalk: pushed) | 1.6 / 1.8 |
| Ready -> stable line, median / p90 (min) | - / - |
| Share of wall time with a change waiting | 0.6518 |
| Mean / max changes waiting at once | 1.073 / 4 |
| Integrated per 10 min | 7 5 |
| Kick-outs / red checks / conflicts / re-pushes | 0 / 0 / 0 / 0 |
| Tasks green (acceptance tests on the line) | 10 / 10 |
| Wall (orchestrator) / settled (min) | 17.9 / 18.0 |
| Model spend (USD) | 2.1997 |
| CI minutes | 21.52 (batch 10.77, precheck 10.75) |
| Subagent calls / most running at once | 12 / 5 |
| Final: suite green / tasks accepted / correct | True / 10 of 10 / True |

## Changes

| Change | Task | Ready -> integrated (min) | Kick-outs | Red | Conflicts | Pushes |
|---|---|---|---|---|---|---|
| #14 | t005 | 1.6 | 0 | 0 | 0 | 1 |
| #13 | t009 | 1.8 | 0 | 0 | 0 | 1 |
| #12 | t010 | 1.7 | 0 | 0 | 0 | 1 |
| #11 | t008 | 1.5 | 0 | 0 | 0 | 1 |
| #10 | t007 | 1.4 | 0 | 0 | 0 | 1 |
| #9 | t006 | 1.4 | 0 | 0 | 0 | 1 |
| #8 | t005 | 1.6 | 0 | 0 | 0 | 1 |
| #7 | t002 | 1.4 | 0 | 0 | 0 | 1 |
| #6 | t004 | 2.2 | 0 | 0 | 0 | 1 |
| #5 | t001 | 1.9 | 0 | 0 | 0 | 1 |
| #4 | t002 | 1.4 | 0 | 0 | 0 | 1 |
| #3 | t003 | 1.3 | 0 | 0 | 0 | 1 |
