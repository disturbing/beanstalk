# Load generator run: lg-ab-fastify-16-s7-demo

| run | forge | N | integrated | ready→integrated med / p90 min | ready→stable med / p90 min | enqueue→merged med / p90 min | waiting share (change / worker) | kick-outs (red / conflict) | rebases | upstream files | per 10 min (peak) | max waiting | CI min | red validations | wall min | correct |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| lg-ab-fastify-16-s7-demo | beanstalk | 16 | 38/38 | 3.0 / 6.5 | 3.8 / 6.9 | - | 0.614 / 0.484 | 7 / 7 | 14 | 114 | 25.95 (36) | 16 | 122.43 | 0 | 14.6 | True |

- schedule: `{"kind": "closed", "seed": 7, "think": {"median": 88.25, "sigma": 0.462, "n": 76, "source": "fitted: pair-fastify-codex-4-s7-github, pair-fastify-codex-4-s7-beanstalk"}, "fix": {"median": 65.07, "sigma": 0.311, "n": 10, "source": "fitted: pair-fastify-codex-4-s7-github, pair-fastify-codex-4-s7-beanstalk"}, "time_scale": 1.0, "hold": "integrate"}`
- mode: standalone
- dropped: none
- reactions: `{"conflict": 7, "rebase": 14, "red": 7, "upstream_files_taken": 114, "upstream_after_red": 2}`
- first push → verdict: `{"n": 38, "median": 118.1, "p90": 250.8, "mean": 149.1}`
- CI: `{"preland": {"runs": 64, "minutes": 103.32, "check_minutes": 105.37, "red": 7}, "validation": {"runs": 22, "minutes": 19.11, "red": 0, "cancelled": 1, "targeted": 0, "targeted_tests": 0}, "audit": {"runs": 0, "minutes": 0.0, "red": 0}}`
- aborted: None
- engine: r16e2deea929a187691f
- verdicts: `{"landed": 38, "red": 6, "conflict": 7, "timeout": 1}`
- checks reused: 3
- final: suite green True, acceptance 38/38 of integrated, matches chain build False
