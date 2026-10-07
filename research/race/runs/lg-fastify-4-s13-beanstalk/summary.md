# Load generator run: lg-fastify-4-s13-beanstalk

| run | forge | N | integrated | ready→integrated med / p90 min | ready→stable med / p90 min | enqueue→merged med / p90 min | waiting share (change / worker) | kick-outs (red / conflict) | rebases | upstream files | per 10 min (peak) | max waiting | CI min | red validations | wall min | correct |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| lg-fastify-4-s13-beanstalk | beanstalk | 4 | 38/38 | 0.7 / 1.4 | 1.4 / 2.0 | - | 0.361 / 0.341 | 1 / 2 | 3 | 2 | 15.86 (19) | 4 | 38.59 | 0 | 24.0 | True |

- schedule: `{"kind": "closed", "seed": 13, "think": {"median": 88.25, "sigma": 0.462, "n": 76, "source": "fitted: pair-fastify-codex-4-s7-github, pair-fastify-codex-4-s7-beanstalk"}, "fix": {"median": 65.07, "sigma": 0.311, "n": 10, "source": "fitted: pair-fastify-codex-4-s7-github, pair-fastify-codex-4-s7-beanstalk"}, "time_scale": 1.0, "hold": "integrate"}`
- mode: standalone
- dropped: none
- reactions: `{"conflict": 2, "rebase": 3, "red": 1, "upstream_files_taken": 2}`
- first push → verdict: `{"n": 38, "median": 42.8, "p90": 48.5, "mean": 45.4}`
- CI: `{"preland": {"runs": 46, "minutes": 24.49, "check_minutes": 26.56, "red": 1}, "validation": {"runs": 23, "minutes": 14.1, "red": 0, "cancelled": 1, "targeted": 0, "targeted_tests": 0}, "audit": {"runs": 0, "minutes": 0.0, "red": 0}}`
- aborted: None
- engine: r3ada9a0b463b1906d25
- verdicts: `{"landed": 38, "red": 1, "conflict": 2}`
- checks reused: 16
- final: suite green True, acceptance 38/38 of integrated, matches chain build False
