# Orchestrated race: github

_orchestrated race: arena=fastify, 38 tasks, forge=github, claude (sonnet) with 4 sonnet subagents_

| Metric | Value |
|---|---|
| Forge / repo | github / https://github.com/kintohubtest/beanstalk-orch-fastify-7 |
| Orchestrator | orchestrated race: arena=fastify, 38 tasks, forge=github, claude (sonnet) with 4 sonnet subagents |
| Changes integrated / submitted | 38 / 38 |
| Submitted -> integrated, median / p90 (min) (GitHub: PR opened; Beanstalk: bean pushed) | 7.6 / 14.8 |
| Ready -> integrated, median / p90 (min) (GitHub: enqueued; Beanstalk: pushed) | 4.0 / 6.5 |
| Ready -> stable line, median / p90 (min) | - / - |
| Share of wall time with a change waiting | 0.8639 |
| Mean / max changes waiting at once | 3.653 / 10 |
| Integrated per 10 min | 8 15 11 3 1 |
| Kick-outs / red checks / conflicts / re-pushes | 1 / 1 / 1 / 1 |
| Tasks green (acceptance tests on the line) | 38 / 38 |
| Wall (orchestrator) / settled (min) | 46.2 / 46.3 |
| Model spend (USD) | 5.4981 |
| CI minutes | 76.0 (batch 35.77, precheck 40.23) |
| Subagent calls / most running at once | 8 / 4 |
| Final: suite green / tasks accepted / correct | True / 38 of 38 / True |

## Changes

| Change | Task | Ready -> integrated (min) | Kick-outs | Red | Conflicts | Pushes |
|---|---|---|---|---|---|---|
| #99 | t009 | 1.6 | 0 | 0 | 0 | 1 |
| #98 | t029 | 5.5 | 0 | 0 | 0 | 1 |
| #97 | t008 | 4.0 | 0 | 0 | 0 | 1 |
| #96 | t019 | 1.9 | 0 | 0 | 0 | 1 |
| #95 | t007 | 22.9 | 1 | 0 | 1 | 1 |
| #94 | t018 | 4.6 | 0 | 0 | 0 | 1 |
| #93 | t028 | 4.2 | 0 | 0 | 0 | 1 |
| #92 | t017 | 4.0 | 0 | 0 | 0 | 1 |
| #91 | t027 | 4.5 | 0 | 0 | 0 | 1 |
| #90 | t016 | 3.2 | 0 | 0 | 0 | 1 |
| #89 | t015 | 3.5 | 0 | 0 | 0 | 1 |
| #88 | t014 | 5.2 | 0 | 0 | 0 | 1 |
| #87 | t026 | 4.2 | 0 | 0 | 0 | 1 |
| #86 | t013 | 6.0 | 0 | 0 | 0 | 1 |
| #85 | t038 | 6.7 | 0 | 0 | 0 | 1 |
| #84 | t037 | 5.4 | 0 | 0 | 0 | 1 |
| #83 | t025 | 3.1 | 0 | 0 | 0 | 1 |
| #82 | t006 | 3.7 | 0 | 0 | 0 | 1 |
| #81 | t024 | 7.0 | 0 | 0 | 0 | 1 |
| #80 | t036 | 6.4 | 0 | 0 | 0 | 1 |
| #79 | t023 | 4.5 | 0 | 0 | 0 | 1 |
| #78 | t035 | 6.8 | 0 | 0 | 0 | 1 |
| #77 | t034 | 5.6 | 0 | 0 | 0 | 1 |
| #76 | t005 | 5.4 | 0 | 0 | 0 | 1 |
| #75 | t012 | 5.1 | 0 | 0 | 0 | 1 |
| #74 | t033 | 2.8 | 0 | 0 | 0 | 1 |
| #73 | t022 | 5.5 | 0 | 1 | 0 | 2 |
| #72 | t032 | 2.4 | 0 | 0 | 0 | 1 |
| #71 | t011 | 3.8 | 0 | 0 | 0 | 1 |
| #70 | t004 | 1.4 | 0 | 0 | 0 | 1 |
| #69 | t021 | 3.2 | 0 | 0 | 0 | 1 |
| #68 | t031 | 2.4 | 0 | 0 | 0 | 1 |
| #67 | t020 | 1.8 | 0 | 0 | 0 | 1 |
| #66 | t003 | 2.6 | 0 | 0 | 0 | 1 |
| #65 | t010 | 1.9 | 0 | 0 | 0 | 1 |
| #64 | t030 | 1.7 | 0 | 0 | 0 | 1 |
| #63 | t002 | 2.5 | 0 | 0 | 0 | 1 |
| #62 | t001 | 1.8 | 0 | 0 | 0 | 1 |
