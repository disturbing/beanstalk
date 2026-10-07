# Load generator run: cap-after-32

| run | forge | N | integrated | ready→integrated med / p90 min | ready→stable med / p90 min | enqueue→merged med / p90 min | waiting share (change / worker) | kick-outs (red / conflict) | rebases | upstream files | per 10 min (peak) | max waiting | CI min | red validations | wall min | correct |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| cap-after-32 | beanstalk | 32 | 38/38 | 2.5 / 7.0 | 3.5 / 7.9 | - | 0.53 / 0.261 | 16 / 9 | 25 | 192 | 33.0 (37) | 25 | 63.57 | 0 | 11.5 | True |

- schedule: `{"kind": "closed", "seed": 7, "think": {"median": 88.25, "sigma": 0.462, "n": 76, "source": "fitted: pair-fastify-codex-4-s7-github, pair-fastify-codex-4-s7-beanstalk"}, "fix": {"median": 65.07, "sigma": 0.311, "n": 10, "source": "fitted: pair-fastify-codex-4-s7-github, pair-fastify-codex-4-s7-beanstalk"}, "time_scale": 1.0, "hold": "integrate"}`
- mode: standalone
- dropped: none
- reactions: `{"conflict": 9, "rebase": 25, "upstream_files_taken": 192, "red": 16, "upstream_after_red": 7}`
- first push → verdict: `{"n": 38, "median": 94.5, "p90": 174.9, "mean": 110.6}`
- CI: `{"preland": {"runs": 81, "minutes": 49.28, "check_minutes": 61.07, "red": 16}, "validation": {"runs": 19, "minutes": 14.29, "red": 0, "cancelled": 3, "targeted": 0, "targeted_tests": 0}, "audit": {"runs": 0, "minutes": 0.0, "red": 0}}`
- aborted: None
- engine: r3369b222afb0cf7d150
- verdicts: `{"error": 3, "landed": 38, "conflict": 9, "red": 13, "timeout": 3}`
- checks reused: 6
- final: suite green True, acceptance 38/38 of integrated, matches chain build False
