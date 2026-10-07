# Load generator run: cap-after-16

| run | forge | N | integrated | ready→integrated med / p90 min | ready→stable med / p90 min | enqueue→merged med / p90 min | waiting share (change / worker) | kick-outs (red / conflict) | rebases | upstream files | per 10 min (peak) | max waiting | CI min | red validations | wall min | correct |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| cap-after-16 | beanstalk | 16 | 38/38 | 1.2 / 3.4 | 2.2 / 3.9 | - | 0.469 / 0.347 | 2 / 6 | 8 | 12 | 37.59 (38) | 14 | 53.77 | 0 | 10.1 | True |

- schedule: `{"kind": "closed", "seed": 7, "think": {"median": 88.25, "sigma": 0.462, "n": 76, "source": "fitted: pair-fastify-codex-4-s7-github, pair-fastify-codex-4-s7-beanstalk"}, "fix": {"median": 65.07, "sigma": 0.311, "n": 10, "source": "fitted: pair-fastify-codex-4-s7-github, pair-fastify-codex-4-s7-beanstalk"}, "time_scale": 1.0, "hold": "integrate"}`
- mode: standalone
- dropped: none
- reactions: `{"conflict": 6, "rebase": 8, "upstream_files_taken": 12, "red": 2}`
- first push → verdict: `{"n": 38, "median": 59.3, "p90": 119.6, "mean": 75.3}`
- CI: `{"preland": {"runs": 57, "minutes": 39.74, "check_minutes": 45.83, "red": 2}, "validation": {"runs": 22, "minutes": 14.03, "red": 0, "cancelled": 0, "targeted": 0, "targeted_tests": 0}, "audit": {"runs": 0, "minutes": 0.0, "red": 0}}`
- aborted: None
- engine: rdc383e9d1b7c0cd126e
- verdicts: `{"landed": 38, "red": 2, "conflict": 6}`
- checks reused: 4
- final: suite green True, acceptance 38/38 of integrated, matches chain build False
