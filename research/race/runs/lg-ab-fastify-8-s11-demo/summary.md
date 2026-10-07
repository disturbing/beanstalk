# Load generator run: lg-ab-fastify-8-s11-demo

| run | forge | N | integrated | ready→integrated med / p90 min | ready→stable med / p90 min | enqueue→merged med / p90 min | waiting share (change / worker) | kick-outs (red / conflict) | rebases | upstream files | per 10 min (peak) | max waiting | CI min | red validations | wall min | correct |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| lg-ab-fastify-8-s11-demo | beanstalk | 8 | 38/38 | 1.2 / 3.6 | 2.2 / 4.3 | - | 0.498 / 0.413 | 3 / 2 | 5 | 60 | 20.76 (28) | 8 | 72.26 | 0 | 18.3 | True |

- schedule: `{"kind": "closed", "seed": 11, "think": {"median": 88.25, "sigma": 0.462, "n": 76, "source": "fitted: pair-fastify-codex-4-s7-github, pair-fastify-codex-4-s7-beanstalk"}, "fix": {"median": 65.07, "sigma": 0.311, "n": 10, "source": "fitted: pair-fastify-codex-4-s7-github, pair-fastify-codex-4-s7-beanstalk"}, "time_scale": 1.0, "hold": "integrate"}`
- mode: standalone
- dropped: none
- reactions: `{"conflict": 2, "rebase": 5, "upstream_files_taken": 60, "red": 3, "upstream_after_red": 1}`
- first push → verdict: `{"n": 38, "median": 68.9, "p90": 144.0, "mean": 86.1}`
- CI: `{"preland": {"runs": 52, "minutes": 52.06, "check_minutes": 54.71, "red": 3}, "validation": {"runs": 29, "minutes": 20.2, "red": 0, "cancelled": 1, "targeted": 0, "targeted_tests": 0}, "audit": {"runs": 0, "minutes": 0.0, "red": 0}}`
- aborted: None
- engine: rbf78786d4004a343009
- verdicts: `{"landed": 38, "conflict": 2, "red": 2, "timeout": 1}`
- checks reused: 5
- final: suite green True, acceptance 38/38 of integrated, matches chain build True
