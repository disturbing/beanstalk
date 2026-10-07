# Load generator run: lg-fastify-16-s7-beanstalk

| run | forge | N | integrated | ready→integrated med / p90 min | ready→stable med / p90 min | enqueue→merged med / p90 min | waiting share (change / worker) | kick-outs (red / conflict) | rebases | upstream files | per 10 min (peak) | max waiting | CI min | red validations | wall min | correct |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| lg-fastify-16-s7-beanstalk | beanstalk | 16 | 33/38 | 11.0 / 38.1 | 11.7 / 38.7 | - | 0.765 / 0.645 | 105 / 2 | 102 | 490 | 5.49 (13) | 16 | 594.49 | 0 | 60.1 | True |

- schedule: `{"kind": "closed", "seed": 7, "think": {"median": 88.25, "sigma": 0.462, "n": 76, "source": "fitted: pair-fastify-codex-4-s7-github, pair-fastify-codex-4-s7-beanstalk"}, "fix": {"median": 65.07, "sigma": 0.311, "n": 10, "source": "fitted: pair-fastify-codex-4-s7-github, pair-fastify-codex-4-s7-beanstalk"}, "time_scale": 1.0, "hold": "integrate"}`
- mode: standalone
- dropped: t002, t004, t011, t014, t016
- reactions: `{"red": 105, "rebase": 102, "upstream_after_red": 70, "upstream_files_taken": 490, "conflict": 2}`
- first push → verdict: `{"n": 38, "median": 310.4, "p90": 313.5, "mean": 261.4}`
- CI: `{"preland": {"runs": 149, "minutes": 584.69, "check_minutes": 598.24, "red": 105}, "validation": {"runs": 14, "minutes": 9.8, "red": 0, "cancelled": 1, "targeted": 0, "targeted_tests": 0}, "audit": {"runs": 0, "minutes": 0.0, "red": 0}}`
- aborted: None
- engine: rc418c1759a10d6a8377
- verdicts: `{"error": 3, "red": 104, "landed": 33, "conflict": 2}`
- checks reused: 17
- final: suite green True, acceptance 33/33 of integrated, matches chain build False
