# Orchestrated race: github

_orchestrated race: arena=fastify, 38 tasks, forge=github, claude (sonnet) with 8 sonnet subagents_

| Metric | Value |
|---|---|
| Forge / repo | github / https://github.com/kintohubtest/beanstalk-orch-fastify-7 |
| Orchestrator | orchestrated race: arena=fastify, 38 tasks, forge=github, claude (sonnet) with 8 sonnet subagents |
| Changes integrated / submitted | 37 / 37 |
| Submitted -> integrated, median / p90 (min) (GitHub: PR opened; Beanstalk: bean pushed) | 5.4 / 13.9 |
| Ready -> integrated, median / p90 (min) (GitHub: enqueued; Beanstalk: pushed) | 3.0 / 6.3 |
| Ready -> stable line, median / p90 (min) | - / - |
| Share of wall time with a change waiting | 0.6243 |
| Mean / max changes waiting at once | 2.658 / 9 |
| Integrated per 10 min | 9 13 11 3 1 0 |
| Kick-outs / red checks / conflicts / re-pushes | 1 / 2 / 1 / 1 |
| Tasks green (acceptance tests on the line) | 38 / 38 |
| Wall (orchestrator) / settled (min) | 50.9 / 51.0 |
| Model spend (USD) | 6.5333 |
| CI minutes | 74.88 (batch 35.48, precheck 39.4) |
| Subagent calls / most running at once | 9 / 9 |
| Final: suite green / tasks accepted / correct | True / 38 of 38 / True |

## Changes

| Change | Task | Ready -> integrated (min) | Kick-outs | Red | Conflicts | Pushes |
|---|---|---|---|---|---|---|
| #137 | t029 | 1.7 | 0 | 0 | 0 | 1 |
| #136 | t030 | 1.4 | 0 | 0 | 0 | 1 |
| #135 | t021 | 1.7 | 0 | 0 | 0 | 1 |
| #134 | t032 | 1.7 | 0 | 0 | 0 | 1 |
| #133 | t018 | 1.3 | 0 | 0 | 0 | 1 |
| #132 | t014 | 1.6 | 0 | 0 | 0 | 1 |
| #131 | t013 | 2.1 | 0 | 0 | 0 | 1 |
| #130 | t023 | 1.4 | 0 | 2 | 0 | 2 |
| #129 | t011 | 5.6 | 0 | 0 | 0 | 1 |
| #128 | t034 | 6.5 | 0 | 0 | 0 | 1 |
| #127 | t010 | 6.5 | 0 | 0 | 0 | 1 |
| #126 | t008 | 5.5 | 0 | 0 | 0 | 1 |
| #125 | t038 | 6.1 | 0 | 0 | 0 | 1 |
| #124 | t017 | 4.1 | 0 | 0 | 0 | 1 |
| #123 | t028 | 6.0 | 0 | 0 | 0 | 1 |
| #122 | t005 | 3.1 | 0 | 0 | 0 | 1 |
| #121 | t009 | 6.9 | 0 | 0 | 0 | 1 |
| #120 | t037 | 4.5 | 0 | 0 | 0 | 1 |
| #119 | t036 | 3.2 | 0 | 0 | 0 | 1 |
| #118 | t015 | 4.3 | 0 | 0 | 0 | 1 |
| #117 | t022 | 1.9 | 0 | 0 | 0 | 1 |
| #116 | t026 | 2.4 | 0 | 0 | 0 | 1 |
| #115 | t016 | 2.9 | 0 | 0 | 0 | 1 |
| #114 | t007 | 2.7 | 0 | 0 | 0 | 1 |
| #113 | t006 | 2.4 | 0 | 0 | 0 | 1 |
| #112 | t033 | 3.0 | 0 | 0 | 0 | 1 |
| #111 | t035 | 5.6 | 0 | 0 | 0 | 1 |
| #110 | t020 | 13.3 | 1 | 0 | 1 | 1 |
| #109 | t003 | 3.4 | 0 | 0 | 0 | 1 |
| #108 | t001 | 5.0 | 0 | 0 | 0 | 1 |
| #107 | t027 | 4.2 | 0 | 0 | 0 | 1 |
| #106 | t004 | 2.3 | 0 | 0 | 0 | 1 |
| #105 | t019 | 1.6 | 0 | 0 | 0 | 1 |
| #104 | t025 | 3.7 | 0 | 0 | 0 | 1 |
| #103 | t024 | 1.8 | 0 | 0 | 0 | 1 |
| #102 | t002 | 1.3 | 0 | 0 | 0 | 1 |
| #101 | t012 | 2.8 | 0 | 0 | 0 | 1 |
