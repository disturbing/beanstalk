# Load generator run: lg-fastify-8-s7-beanstalk

| run | forge | N | integrated | ready→integrated med / p90 min | ready→stable med / p90 min | enqueue→merged med / p90 min | waiting share (change / worker) | kick-outs (red / conflict) | rebases | upstream files | per 10 min (peak) | max waiting | CI min | red validations | wall min | correct |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| lg-fastify-8-s7-beanstalk | beanstalk | 8 | 38/38 | 2.4 / 4.5 | 3.2 / 5.1 | - | 0.612 / 0.564 | 4 / 2 | 6 | 8 | 17.51 (23) | 8 | 110.17 | 0 | 21.7 | True |

- schedule: `{"kind": "closed", "seed": 7, "think": {"median": 88.25, "sigma": 0.462, "n": 76, "source": "fitted: pair-fastify-codex-4-s7-github, pair-fastify-codex-4-s7-beanstalk"}, "fix": {"median": 65.07, "sigma": 0.311, "n": 10, "source": "fitted: pair-fastify-codex-4-s7-github, pair-fastify-codex-4-s7-beanstalk"}, "time_scale": 1.0, "hold": "integrate"}`
- mode: standalone
- dropped: none
- reactions: `{"conflict": 2, "rebase": 6, "red": 4, "upstream_files_taken": 8}`
- first push → verdict: `{"n": 38, "median": 137.3, "p90": 193.2, "mean": 136.4}`
- CI: `{"preland": {"runs": 53, "minutes": 88.44, "check_minutes": 90.65, "red": 4}, "validation": {"runs": 30, "minutes": 21.73, "red": 0, "cancelled": 0, "targeted": 0, "targeted_tests": 0}, "audit": {"runs": 0, "minutes": 0.0, "red": 0}}`
- aborted: None
- engine: r2207ad6275286a5d0ec
- verdicts: `{"landed": 38, "conflict": 2, "red": 4}`
- checks reused: 5
- final: suite green True, acceptance 38/38 of integrated, matches chain build True
