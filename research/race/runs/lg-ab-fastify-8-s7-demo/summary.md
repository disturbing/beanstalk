# Load generator run: lg-ab-fastify-8-s7-demo

| run | forge | N | integrated | ready→integrated med / p90 min | ready→stable med / p90 min | enqueue→merged med / p90 min | waiting share (change / worker) | kick-outs (red / conflict) | rebases | upstream files | per 10 min (peak) | max waiting | CI min | red validations | wall min | correct |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| lg-ab-fastify-8-s7-demo | beanstalk | 8 | 38/38 | 1.6 / 3.5 | 2.2 / 4.1 | - | 0.542 / 0.49 | 3 / 3 | 6 | 8 | 20.56 (27) | 8 | 84.73 | 0 | 18.5 | True |

- schedule: `{"kind": "closed", "seed": 7, "think": {"median": 88.25, "sigma": 0.462, "n": 76, "source": "fitted: pair-fastify-codex-4-s7-github, pair-fastify-codex-4-s7-beanstalk"}, "fix": {"median": 65.07, "sigma": 0.311, "n": 10, "source": "fitted: pair-fastify-codex-4-s7-github, pair-fastify-codex-4-s7-beanstalk"}, "time_scale": 1.0, "hold": "integrate"}`
- mode: standalone
- dropped: none
- reactions: `{"conflict": 3, "rebase": 6, "red": 3, "upstream_files_taken": 8}`
- first push → verdict: `{"n": 38, "median": 91.9, "p90": 147.0, "mean": 98.5}`
- CI: `{"preland": {"runs": 55, "minutes": 66.71, "check_minutes": 67.93, "red": 3}, "validation": {"runs": 28, "minutes": 18.02, "red": 0, "cancelled": 0, "targeted": 0, "targeted_tests": 0}, "audit": {"runs": 0, "minutes": 0.0, "red": 0}}`
- aborted: None
- engine: ra269ba6eb5c4780c2a8
- verdicts: `{"landed": 38, "red": 3, "conflict": 3}`
- checks reused: 7
- final: suite green True, acceptance 38/38 of integrated, matches chain build False
