# Load generator run: cap-before-32

| run | forge | N | integrated | ready→integrated med / p90 min | ready→stable med / p90 min | enqueue→merged med / p90 min | waiting share (change / worker) | kick-outs (red / conflict) | rebases | upstream files | per 10 min (peak) | max waiting | CI min | red validations | wall min | correct |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| cap-before-32 | beanstalk | 32 | 37/38 | 15.3 / 21.4 | 16.2 / 22.2 | - | 0.799 / 0.572 | 49 / 9 | 58 | 412 | 14.52 (26) | 32 | 436.21 | 0 | 25.5 | True |

- schedule: `{"kind": "closed", "seed": 7, "think": {"median": 88.25, "sigma": 0.462, "n": 76, "source": "fitted: pair-fastify-codex-4-s7-github, pair-fastify-codex-4-s7-beanstalk"}, "fix": {"median": 65.07, "sigma": 0.311, "n": 10, "source": "fitted: pair-fastify-codex-4-s7-github, pair-fastify-codex-4-s7-beanstalk"}, "time_scale": 1.0, "hold": "integrate"}`
- mode: standalone
- dropped: t018
- reactions: `{"red": 49, "rebase": 58, "upstream_after_red": 19, "upstream_files_taken": 412, "conflict": 9}`
- first push → verdict: `{"n": 38, "median": 312.2, "p90": 326.1, "mean": 303.8}`
- CI: `{"preland": {"runs": 125, "minutes": 418.79, "check_minutes": 426.8, "red": 50}, "validation": {"runs": 26, "minutes": 17.42, "red": 0, "cancelled": 0, "targeted": 0, "targeted_tests": 0}, "audit": {"runs": 0, "minutes": 0.0, "red": 0}}`
- aborted: None
- engine: rf43b0c82e54ebea5660
- verdicts: `{"error": 3, "landed": 36, "red": 46, "timeout": 3, "parked": 1, "conflict": 9}`
- checks reused: 8
- final: suite green True, acceptance 37/37 of integrated, matches chain build False
