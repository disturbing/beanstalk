# Load generator run: lg-fastify-16-s11-beanstalk

| run | forge | N | integrated | ready→integrated med / p90 min | ready→stable med / p90 min | enqueue→merged med / p90 min | waiting share (change / worker) | kick-outs (red / conflict) | rebases | upstream files | per 10 min (peak) | max waiting | CI min | red validations | wall min | correct |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| lg-fastify-16-s11-beanstalk | beanstalk | 16 | 38/38 | 1.0 / 4.9 | 2.1 / 5.7 | - | 0.466 / 0.309 | 7 / 6 | 13 | 66 | 30.61 (37) | 12 | 55.18 | 0 | 12.4 | True |

- schedule: `{"kind": "closed", "seed": 11, "think": {"median": 88.25, "sigma": 0.462, "n": 76, "source": "fitted: pair-fastify-codex-4-s7-github, pair-fastify-codex-4-s7-beanstalk"}, "fix": {"median": 65.07, "sigma": 0.311, "n": 10, "source": "fitted: pair-fastify-codex-4-s7-github, pair-fastify-codex-4-s7-beanstalk"}, "time_scale": 1.0, "hold": "integrate"}`
- mode: standalone
- dropped: none
- reactions: `{"conflict": 6, "rebase": 13, "upstream_files_taken": 66, "red": 7, "upstream_after_red": 3}`
- first push → verdict: `{"n": 38, "median": 53.0, "p90": 126.5, "mean": 76.8}`
- CI: `{"preland": {"runs": 65, "minutes": 39.2, "check_minutes": 45.05, "red": 7}, "validation": {"runs": 22, "minutes": 15.98, "red": 0, "cancelled": 1, "targeted": 0, "targeted_tests": 0}, "audit": {"runs": 0, "minutes": 0.0, "red": 0}}`
- aborted: None
- engine: rf1eec0b8688d7b5c4ad
- verdicts: `{"landed": 37, "conflict": 6, "error": 1, "red": 5, "timeout": 2}`
- checks reused: 5
- final: suite green True, acceptance 38/38 of integrated, matches chain build False
