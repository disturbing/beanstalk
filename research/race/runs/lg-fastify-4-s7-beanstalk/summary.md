# Load generator run: lg-fastify-4-s7-beanstalk

| run | forge | N | integrated | ready→integrated med / p90 min | ready→stable med / p90 min | enqueue→merged med / p90 min | waiting share (change / worker) | kick-outs (red / conflict) | rebases | upstream files | per 10 min (peak) | max waiting | CI min | red validations | wall min | correct |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| lg-fastify-4-s7-beanstalk | beanstalk | 4 | 38/38 | 1.1 / 2.2 | 1.7 / 2.6 | - | 0.452 / 0.433 | 1 / 2 | 3 | 2 | 13.58 (17) | 4 | 57.62 | 0 | 28.0 | True |

- schedule: `{"kind": "closed", "seed": 7, "think": {"median": 88.25, "sigma": 0.462, "n": 76, "source": "fitted: pair-fastify-codex-4-s7-github, pair-fastify-codex-4-s7-beanstalk"}, "fix": {"median": 65.07, "sigma": 0.311, "n": 10, "source": "fitted: pair-fastify-codex-4-s7-github, pair-fastify-codex-4-s7-beanstalk"}, "time_scale": 1.0, "hold": "integrate"}`
- mode: standalone
- dropped: none
- reactions: `{"conflict": 2, "rebase": 3, "red": 1, "upstream_files_taken": 2}`
- first push → verdict: `{"n": 38, "median": 61.7, "p90": 81.1, "mean": 66.5}`
- CI: `{"preland": {"runs": 47, "minutes": 40.7, "check_minutes": 42.17, "red": 1}, "validation": {"runs": 24, "minutes": 16.92, "red": 0, "cancelled": 1, "targeted": 0, "targeted_tests": 0}, "audit": {"runs": 0, "minutes": 0.0, "red": 0}}`
- aborted: None
- engine: r205ca65072a280e2aed
- verdicts: `{"landed": 38, "conflict": 2, "red": 1}`
- checks reused: 16
- final: suite green True, acceptance 38/38 of integrated, matches chain build False
