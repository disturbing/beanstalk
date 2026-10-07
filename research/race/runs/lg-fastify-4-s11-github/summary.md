# Load generator run: lg-fastify-4-s11-github

| run | forge | N | integrated | ready→integrated med / p90 min | ready→stable med / p90 min | enqueue→merged med / p90 min | waiting share (change / worker) | kick-outs (red / conflict) | rebases | upstream files | per 10 min (peak) | max waiting | CI min | red validations | wall min | correct |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| lg-fastify-4-s11-github | github | 4 | 38/38 | 3.0 / 5.9 | 3.0 / 5.9 | 1.7 / 2.8 | 0.707 / 0.674 | 1 / 2 | 3 | 2 | 7.4 (11) | 4 | 74.42 | 0 | 51.4 | True |

- schedule: `{"kind": "closed", "seed": 11, "think": {"median": 88.25, "sigma": 0.462, "n": 76, "source": "fitted: pair-fastify-codex-4-s7-github, pair-fastify-codex-4-s7-beanstalk"}, "fix": {"median": 65.07, "sigma": 0.311, "n": 10, "source": "fitted: pair-fastify-codex-4-s7-github, pair-fastify-codex-4-s7-beanstalk"}, "time_scale": 1.0, "hold": "integrate"}`
- mode: standalone
- dropped: none
- reactions: `{"conflict": 2, "rebase": 3, "upstream_files_taken": 2, "red": 1}`
- first push → verdict: `{"n": 38, "median": 181.5, "p90": 279.9, "mean": 205.4}`
- CI: `{"pull_request": {"runs": 41, "minutes": 38.6, "suite_minutes": 25.27, "red": 1}, "merge_group": {"runs": 38, "minutes": 35.82, "suite_minutes": 23.39, "red": 0}}`
- aborted: None
- repo: https://github.com/kintohubtest/beanstalk-loadgen-fastify-4-11
- ruleset: `{"check_response_timeout_minutes": 30, "grouping_strategy": "ALLGREEN", "max_entries_to_build": 2, "max_entries_to_merge": 4, "merge_method": "SQUASH", "min_entries_to_merge": 1, "min_entries_to_merge_wait_minutes": 0}`
- API: `{"pushes": 42, "push_wait_s": 0.0, "mutations": 81, "mutation_wait_s": 1.0, "queries": 601, "rest": 683, "rate_limited": 0, "retry_after_s": 0.0, "hourly_cap_waits": 0}`
- kick-outs by GitHub reason: `{"merge_conflict": 2, "PR_CHECK_FAILED": 1}`
- final: suite green True, acceptance 38/38 of integrated, matches chain build True
