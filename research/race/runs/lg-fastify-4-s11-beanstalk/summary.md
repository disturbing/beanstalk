# Load generator run: lg-fastify-4-s11-beanstalk

| run | forge | N | integrated | ready→integrated med / p90 min | ready→stable med / p90 min | enqueue→merged med / p90 min | waiting share (change / worker) | kick-outs (red / conflict) | rebases | upstream files | per 10 min (peak) | max waiting | CI min | red validations | wall min | correct |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| lg-fastify-4-s11-beanstalk | beanstalk | 4 | 38/38 | 2.1 / 3.1 | 2.9 / 3.9 | - | 0.609 / 0.579 | 0 / 2 | 2 | 2 | 9.9 (13) | 4 | 103.71 | 0 | 38.4 | True |

- schedule: `{"kind": "closed", "seed": 11, "think": {"median": 88.25, "sigma": 0.462, "n": 76, "source": "fitted: pair-fastify-codex-4-s7-github, pair-fastify-codex-4-s7-beanstalk"}, "fix": {"median": 65.07, "sigma": 0.311, "n": 10, "source": "fitted: pair-fastify-codex-4-s7-github, pair-fastify-codex-4-s7-beanstalk"}, "time_scale": 1.0, "hold": "integrate"}`
- mode: standalone
- dropped: none
- reactions: `{"conflict": 2, "rebase": 2, "upstream_files_taken": 2}`
- first push → verdict: `{"n": 38, "median": 127.5, "p90": 175.1, "mean": 125.0}`
- CI: `{"preland": {"runs": 45, "minutes": 82.21, "check_minutes": 83.43, "red": 0}, "validation": {"runs": 28, "minutes": 21.5, "red": 0, "cancelled": 0, "targeted": 0, "targeted_tests": 0}, "audit": {"runs": 0, "minutes": 0.0, "red": 0}}`
- aborted: None
- engine: r1350bdf1997642203f7
- verdicts: `{"landed": 38, "conflict": 2}`
- checks reused: 11
- final: suite green True, acceptance 38/38 of integrated, matches chain build True
