# Load generator run: lg-ab-fastify-16-s7-evidence

| run | forge | N | integrated | ready→integrated med / p90 min | ready→stable med / p90 min | enqueue→merged med / p90 min | waiting share (change / worker) | kick-outs (red / conflict) | rebases | upstream files | per 10 min (peak) | max waiting | CI min | red validations | wall min | correct |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| lg-ab-fastify-16-s7-evidence | beanstalk | 16 | 37/38 | 14.5 / 34.9 | 14.6 / 35.3 | - | 0.804 / 0.723 | 75 / 3 | 78 | 390 | 7.25 (15) | 16 | 585.74 | 0 | 51.0 | True |

- schedule: `{"kind": "closed", "seed": 7, "think": {"median": 88.25, "sigma": 0.462, "n": 76, "source": "fitted: pair-fastify-codex-4-s7-github, pair-fastify-codex-4-s7-beanstalk"}, "fix": {"median": 65.07, "sigma": 0.311, "n": 10, "source": "fitted: pair-fastify-codex-4-s7-github, pair-fastify-codex-4-s7-beanstalk"}, "time_scale": 1.0, "hold": "integrate"}`
- mode: standalone
- dropped: t004
- reactions: `{"red": 75, "rebase": 78, "upstream_after_red": 44, "upstream_files_taken": 390, "conflict": 3}`
- first push → verdict: `{"n": 38, "median": 311.1, "p90": 314.5, "mean": 279.8}`
- CI: `{"preland": {"runs": 139, "minutes": 558.06, "check_minutes": 571.39, "red": 76}, "validation": {"runs": 26, "minutes": 25.62, "red": 0, "cancelled": 2, "targeted": 24, "targeted_tests": 4377}, "audit": {"runs": 3, "minutes": 2.05, "red": 0}}`
- aborted: None
- engine: r69f81c57c0394c25daf
- verdicts: `{"red": 63, "error": 2, "landed": 36, "conflict": 3, "timeout": 11, "parked": 1}`
- checks reused: 13
- final: suite green True, acceptance 37/37 of integrated, matches chain build False
