# Load generator run: lg-ab-fastify-8-s13-evidence

| run | forge | N | integrated | ready→integrated med / p90 min | ready→stable med / p90 min | enqueue→merged med / p90 min | waiting share (change / worker) | kick-outs (red / conflict) | rebases | upstream files | per 10 min (peak) | max waiting | CI min | red validations | wall min | correct |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| lg-ab-fastify-8-s13-evidence | beanstalk | 8 | 38/38 | 5.0 / 10.9 | 6.0 / 12.2 | - | 0.75 / 0.671 | 10 / 0 | 10 | 5 | 10.3 (17) | 8 | 221.98 | 0 | 36.9 | True |

- schedule: `{"kind": "closed", "seed": 13, "think": {"median": 88.25, "sigma": 0.462, "n": 76, "source": "fitted: pair-fastify-codex-4-s7-github, pair-fastify-codex-4-s7-beanstalk"}, "fix": {"median": 65.07, "sigma": 0.311, "n": 10, "source": "fitted: pair-fastify-codex-4-s7-github, pair-fastify-codex-4-s7-beanstalk"}, "time_scale": 1.0, "hold": "integrate"}`
- mode: standalone
- dropped: none
- reactions: `{"red": 10, "rebase": 10, "upstream_files_taken": 5, "upstream_after_red": 1}`
- first push → verdict: `{"n": 38, "median": 297.0, "p90": 318.4, "mean": 256.1}`
- CI: `{"preland": {"runs": 59, "minutes": 188.72, "check_minutes": 191.93, "red": 10}, "validation": {"runs": 27, "minutes": 28.89, "red": 0, "cancelled": 1, "targeted": 27, "targeted_tests": 5448}, "audit": {"runs": 4, "minutes": 4.37, "red": 0}}`
- aborted: None
- engine: r56964edf39ac84efd9f
- verdicts: `{"red": 9, "landed": 38, "timeout": 1}`
- checks reused: 5
- final: suite green True, acceptance 38/38 of integrated, matches chain build True
