# Load generator run: cap-before-16

| run | forge | N | integrated | ready→integrated med / p90 min | ready→stable med / p90 min | enqueue→merged med / p90 min | waiting share (change / worker) | kick-outs (red / conflict) | rebases | upstream files | per 10 min (peak) | max waiting | CI min | red validations | wall min | correct |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| cap-before-16 | beanstalk | 16 | 38/38 | 8.5 / 28.8 | 9.2 / 29.7 | - | 0.792 / 0.714 | 43 / 4 | 47 | 216 | 10.63 (19) | 16 | 410.42 | 0 | 35.8 | True |

- schedule: `{"kind": "closed", "seed": 7, "think": {"median": 88.25, "sigma": 0.462, "n": 76, "source": "fitted: pair-fastify-codex-4-s7-github, pair-fastify-codex-4-s7-beanstalk"}, "fix": {"median": 65.07, "sigma": 0.311, "n": 10, "source": "fitted: pair-fastify-codex-4-s7-github, pair-fastify-codex-4-s7-beanstalk"}, "time_scale": 1.0, "hold": "integrate"}`
- mode: standalone
- dropped: none
- reactions: `{"red": 43, "rebase": 47, "upstream_files_taken": 216, "conflict": 4, "upstream_after_red": 16}`
- first push → verdict: `{"n": 38, "median": 306.3, "p90": 310.9, "mean": 285.1}`
- CI: `{"preland": {"runs": 113, "minutes": 392.72, "check_minutes": 398.7, "red": 43}, "validation": {"runs": 25, "minutes": 17.7, "red": 0, "cancelled": 0, "targeted": 0, "targeted_tests": 0}, "audit": {"runs": 0, "minutes": 0.0, "red": 0}}`
- aborted: None
- engine: r948ffe8d74262e21777
- verdicts: `{"error": 3, "red": 41, "landed": 37, "conflict": 4}`
- checks reused: 10
- final: suite green True, acceptance 38/38 of integrated, matches chain build True
