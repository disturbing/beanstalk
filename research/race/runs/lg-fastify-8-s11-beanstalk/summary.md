# Load generator run: lg-fastify-8-s11-beanstalk

| run | forge | N | integrated | ready→integrated med / p90 min | ready→stable med / p90 min | enqueue→merged med / p90 min | waiting share (change / worker) | kick-outs (red / conflict) | rebases | upstream files | per 10 min (peak) | max waiting | CI min | red validations | wall min | correct |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| lg-fastify-8-s11-beanstalk | beanstalk | 8 | 38/38 | 1.7 / 5.0 | 2.8 / 5.8 | - | 0.572 / 0.5 | 4 / 2 | 6 | 60 | 17.66 (26) | 8 | 90.77 | 0 | 21.5 | True |

- schedule: `{"kind": "closed", "seed": 11, "think": {"median": 88.25, "sigma": 0.462, "n": 76, "source": "fitted: pair-fastify-codex-4-s7-github, pair-fastify-codex-4-s7-beanstalk"}, "fix": {"median": 65.07, "sigma": 0.311, "n": 10, "source": "fitted: pair-fastify-codex-4-s7-github, pair-fastify-codex-4-s7-beanstalk"}, "time_scale": 1.0, "hold": "integrate"}`
- mode: standalone
- dropped: none
- reactions: `{"conflict": 2, "rebase": 6, "upstream_files_taken": 60, "red": 4, "upstream_after_red": 1}`
- first push → verdict: `{"n": 38, "median": 94.7, "p90": 168.8, "mean": 117.1}`
- CI: `{"preland": {"runs": 54, "minutes": 69.27, "check_minutes": 71.42, "red": 4}, "validation": {"runs": 26, "minutes": 21.5, "red": 0, "cancelled": 2, "targeted": 0, "targeted_tests": 0}, "audit": {"runs": 0, "minutes": 0.0, "red": 0}}`
- aborted: None
- engine: rc6e8e728b8501d77f07
- verdicts: `{"landed": 37, "conflict": 2, "red": 3, "timeout": 1, "error": 1}`
- checks reused: 7
- final: suite green True, acceptance 38/38 of integrated, matches chain build True
