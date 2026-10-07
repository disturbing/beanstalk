# Load generator run: lg-ab-fastify-8-s13-demo

| run | forge | N | integrated | ready→integrated med / p90 min | ready→stable med / p90 min | enqueue→merged med / p90 min | waiting share (change / worker) | kick-outs (red / conflict) | rebases | upstream files | per 10 min (peak) | max waiting | CI min | red validations | wall min | correct |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| lg-ab-fastify-8-s13-demo | beanstalk | 8 | 38/38 | 1.9 / 3.2 | 2.8 / 3.9 | - | 0.569 / 0.504 | 2 / 2 | 4 | 4 | 19.52 (27) | 8 | 91.64 | 0 | 19.5 | True |

- schedule: `{"kind": "closed", "seed": 13, "think": {"median": 88.25, "sigma": 0.462, "n": 76, "source": "fitted: pair-fastify-codex-4-s7-github, pair-fastify-codex-4-s7-beanstalk"}, "fix": {"median": 65.07, "sigma": 0.311, "n": 10, "source": "fitted: pair-fastify-codex-4-s7-github, pair-fastify-codex-4-s7-beanstalk"}, "time_scale": 1.0, "hold": "integrate"}`
- mode: standalone
- dropped: none
- reactions: `{"conflict": 2, "rebase": 4, "upstream_files_taken": 4, "red": 2, "upstream_after_red": 1}`
- first push → verdict: `{"n": 38, "median": 115.7, "p90": 176.5, "mean": 116.2}`
- CI: `{"preland": {"runs": 52, "minutes": 72.39, "check_minutes": 73.56, "red": 2}, "validation": {"runs": 27, "minutes": 19.25, "red": 0, "cancelled": 0, "targeted": 0, "targeted_tests": 0}, "audit": {"runs": 0, "minutes": 0.0, "red": 0}}`
- aborted: None
- engine: r5c313538224d1caebbd
- verdicts: `{"red": 1, "landed": 38, "conflict": 2, "timeout": 1}`
- checks reused: 6
- final: suite green True, acceptance 38/38 of integrated, matches chain build True
