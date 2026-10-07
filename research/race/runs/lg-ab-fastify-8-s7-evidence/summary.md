# Load generator run: lg-ab-fastify-8-s7-evidence

| run | forge | N | integrated | ready→integrated med / p90 min | ready→stable med / p90 min | enqueue→merged med / p90 min | waiting share (change / worker) | kick-outs (red / conflict) | rebases | upstream files | per 10 min (peak) | max waiting | CI min | red validations | wall min | correct |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| lg-ab-fastify-8-s7-evidence | beanstalk | 8 | 38/38 | 3.0 / 6.6 | 3.9 / 8.1 | - | 0.66 / 0.593 | 4 / 4 | 8 | 52 | 14.72 (22) | 8 | 145.38 | 0 | 25.8 | True |

- schedule: `{"kind": "closed", "seed": 7, "think": {"median": 88.25, "sigma": 0.462, "n": 76, "source": "fitted: pair-fastify-codex-4-s7-github, pair-fastify-codex-4-s7-beanstalk"}, "fix": {"median": 65.07, "sigma": 0.311, "n": 10, "source": "fitted: pair-fastify-codex-4-s7-github, pair-fastify-codex-4-s7-beanstalk"}, "time_scale": 1.0, "hold": "integrate"}`
- mode: standalone
- dropped: none
- reactions: `{"conflict": 4, "rebase": 8, "red": 4, "upstream_files_taken": 52, "upstream_after_red": 1}`
- first push → verdict: `{"n": 38, "median": 156.4, "p90": 215.8, "mean": 154.5}`
- CI: `{"preland": {"runs": 58, "minutes": 112.63, "check_minutes": 114.81, "red": 4}, "validation": {"runs": 27, "minutes": 29.9, "red": 0, "cancelled": 5, "targeted": 25, "targeted_tests": 5016}, "audit": {"runs": 4, "minutes": 2.86, "red": 0}}`
- aborted: None
- engine: r1601e4346100d407dd5
- verdicts: `{"landed": 38, "red": 4, "conflict": 4}`
- checks reused: 5
- final: suite green True, acceptance 38/38 of integrated, matches chain build True
