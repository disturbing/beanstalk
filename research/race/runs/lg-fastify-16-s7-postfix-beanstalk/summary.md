# Load generator run: lg-fastify-16-s7-postfix-beanstalk

| run | forge | N | integrated | ready→integrated med / p90 min | ready→stable med / p90 min | enqueue→merged med / p90 min | waiting share (change / worker) | kick-outs (red / conflict) | rebases | upstream files | per 10 min (peak) | max waiting | CI min | red validations | wall min | correct |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| lg-fastify-16-s7-postfix-beanstalk | beanstalk | 16 | 38/38 | 1.1 / 3.8 | 2.4 / 4.7 | - | 0.456 / 0.319 | 3 / 7 | 10 | 14 | 34.81 (38) | 14 | 48.67 | 0 | 10.9 | True |

- schedule: `{"kind": "closed", "seed": 7, "think": {"median": 88.25, "sigma": 0.462, "n": 76, "source": "fitted: pair-fastify-codex-4-s7-github, pair-fastify-codex-4-s7-beanstalk"}, "fix": {"median": 65.07, "sigma": 0.311, "n": 10, "source": "fitted: pair-fastify-codex-4-s7-github, pair-fastify-codex-4-s7-beanstalk"}, "time_scale": 1.0, "hold": "integrate"}`
- mode: standalone
- dropped: none
- reactions: `{"conflict": 7, "rebase": 10, "upstream_files_taken": 14, "red": 3}`
- first push → verdict: `{"n": 38, "median": 62.6, "p90": 113.3, "mean": 73.1}`
- CI: `{"preland": {"runs": 60, "minutes": 34.1, "check_minutes": 41.58, "red": 3}, "validation": {"runs": 18, "minutes": 14.57, "red": 0, "cancelled": 1, "targeted": 0, "targeted_tests": 0}, "audit": {"runs": 0, "minutes": 0.0, "red": 0}}`
- aborted: None
- engine: r565fa0fb906d3766f88
- verdicts: `{"error": 3, "landed": 38, "red": 3, "conflict": 7}`
- checks reused: 4
- final: suite green True, acceptance 38/38 of integrated, matches chain build False
