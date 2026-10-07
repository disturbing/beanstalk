# Load generator run: lg-ab-fastify-8-s11-evidence

| run | forge | N | integrated | ready→integrated med / p90 min | ready→stable med / p90 min | enqueue→merged med / p90 min | waiting share (change / worker) | kick-outs (red / conflict) | rebases | upstream files | per 10 min (peak) | max waiting | CI min | red validations | wall min | correct |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| lg-ab-fastify-8-s11-evidence | beanstalk | 8 | 38/38 | 3.6 / 7.2 | 5.1 / 9.1 | - | 0.691 / 0.629 | 4 / 5 | 9 | 62 | 12.57 (20) | 8 | 167.81 | 0 | 30.2 | True |

- schedule: `{"kind": "closed", "seed": 11, "think": {"median": 88.25, "sigma": 0.462, "n": 76, "source": "fitted: pair-fastify-codex-4-s7-github, pair-fastify-codex-4-s7-beanstalk"}, "fix": {"median": 65.07, "sigma": 0.311, "n": 10, "source": "fitted: pair-fastify-codex-4-s7-github, pair-fastify-codex-4-s7-beanstalk"}, "time_scale": 1.0, "hold": "integrate"}`
- mode: standalone
- dropped: none
- reactions: `{"conflict": 5, "rebase": 9, "upstream_files_taken": 62, "red": 4, "upstream_after_red": 1}`
- first push → verdict: `{"n": 38, "median": 209.3, "p90": 319.2, "mean": 215.8}`
- CI: `{"preland": {"runs": 53, "minutes": 138.3, "check_minutes": 140.64, "red": 4}, "validation": {"runs": 25, "minutes": 26.4, "red": 0, "cancelled": 1, "targeted": 25, "targeted_tests": 5032}, "audit": {"runs": 3, "minutes": 3.11, "red": 0}}`
- aborted: None
- engine: r7e45ebb1d3404280eba
- verdicts: `{"landed": 38, "conflict": 5, "red": 3, "timeout": 1}`
- checks reused: 5
- final: suite green True, acceptance 38/38 of integrated, matches chain build True
