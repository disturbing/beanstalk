# Load generator run: lg-fastify-8-s13-beanstalk

| run | forge | N | integrated | ready→integrated med / p90 min | ready→stable med / p90 min | enqueue→merged med / p90 min | waiting share (change / worker) | kick-outs (red / conflict) | rebases | upstream files | per 10 min (peak) | max waiting | CI min | red validations | wall min | correct |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| lg-fastify-8-s13-beanstalk | beanstalk | 8 | 38/38 | 0.8 / 2.4 | 1.6 / 2.6 | - | 0.393 / 0.343 | 2 / 2 | 4 | 5 | 27.46 (34) | 6 | 46.61 | 0 | 13.8 | True |

- schedule: `{"kind": "closed", "seed": 13, "think": {"median": 88.25, "sigma": 0.462, "n": 76, "source": "fitted: pair-fastify-codex-4-s7-github, pair-fastify-codex-4-s7-beanstalk"}, "fix": {"median": 65.07, "sigma": 0.311, "n": 10, "source": "fitted: pair-fastify-codex-4-s7-github, pair-fastify-codex-4-s7-beanstalk"}, "time_scale": 1.0, "hold": "integrate"}`
- mode: standalone
- dropped: none
- reactions: `{"conflict": 2, "rebase": 4, "red": 2, "upstream_files_taken": 5}`
- first push → verdict: `{"n": 38, "median": 45.6, "p90": 83.6, "mean": 55.3}`
- CI: `{"preland": {"runs": 49, "minutes": 27.13, "check_minutes": 29.08, "red": 2}, "validation": {"runs": 30, "minutes": 19.48, "red": 0, "cancelled": 1, "targeted": 0, "targeted_tests": 0}, "audit": {"runs": 0, "minutes": 0.0, "red": 0}}`
- aborted: None
- engine: rcd2ffef08929edcf1cd
- verdicts: `{"landed": 38, "red": 2, "conflict": 2, "error": 1}`
- checks reused: 4
- final: suite green True, acceptance 38/38 of integrated, matches chain build True
