# Load generator run: lg-fastify-16-s13-beanstalk

| run | forge | N | integrated | ready→integrated med / p90 min | ready→stable med / p90 min | enqueue→merged med / p90 min | waiting share (change / worker) | kick-outs (red / conflict) | rebases | upstream files | per 10 min (peak) | max waiting | CI min | red validations | wall min | correct |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| lg-fastify-16-s13-beanstalk | beanstalk | 16 | 38/38 | 0.8 / 3.4 | 1.8 / 4.3 | - | 0.437 / 0.329 | 6 / 4 | 10 | 48 | 38.81 (38) | 13 | 49.4 | 0 | 9.8 | True |

- schedule: `{"kind": "closed", "seed": 13, "think": {"median": 88.25, "sigma": 0.462, "n": 76, "source": "fitted: pair-fastify-codex-4-s7-github, pair-fastify-codex-4-s7-beanstalk"}, "fix": {"median": 65.07, "sigma": 0.311, "n": 10, "source": "fitted: pair-fastify-codex-4-s7-github, pair-fastify-codex-4-s7-beanstalk"}, "time_scale": 1.0, "hold": "integrate"}`
- mode: standalone
- dropped: none
- reactions: `{"conflict": 4, "rebase": 10, "upstream_files_taken": 48, "red": 6, "upstream_after_red": 1}`
- first push → verdict: `{"n": 38, "median": 47.8, "p90": 118.2, "mean": 62.4}`
- CI: `{"preland": {"runs": 61, "minutes": 35.39, "check_minutes": 40.35, "red": 6}, "validation": {"runs": 20, "minutes": 14.01, "red": 0, "cancelled": 3, "targeted": 0, "targeted_tests": 0}, "audit": {"runs": 0, "minutes": 0.0, "red": 0}}`
- aborted: None
- engine: r789fd1da26b89bf8743
- verdicts: `{"error": 2, "landed": 38, "red": 5, "conflict": 4, "timeout": 1}`
- checks reused: 4
- final: suite green True, acceptance 38/38 of integrated, matches chain build False
