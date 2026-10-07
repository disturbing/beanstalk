# Load generator run: lg-fastify-16-s7-github

| run | forge | N | integrated | ready→integrated med / p90 min | ready→stable med / p90 min | enqueue→merged med / p90 min | waiting share (change / worker) | kick-outs (red / conflict) | rebases | upstream files | per 10 min (peak) | max waiting | CI min | red validations | wall min | correct |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| lg-fastify-16-s7-github | github | 16 | 38/38 | 7.1 / 13.5 | 7.1 / 13.5 | 5.6 / 12.0 | 0.805 / 0.585 | 6 / 8 | 14 | 22 | 12.51 (17) | 16 | 82.0 | 0 | 30.4 | True |

- schedule: `{"kind": "closed", "seed": 7, "think": {"median": 88.25, "sigma": 0.462, "n": 76, "source": "fitted: pair-fastify-codex-4-s7-github, pair-fastify-codex-4-s7-beanstalk"}, "fix": {"median": 65.07, "sigma": 0.311, "n": 10, "source": "fitted: pair-fastify-codex-4-s7-github, pair-fastify-codex-4-s7-beanstalk"}, "time_scale": 1.0, "hold": "integrate"}`
- mode: standalone
- dropped: none
- reactions: `{"conflict": 8, "rebase": 14, "upstream_files_taken": 22, "red": 6, "upstream_after_red": 3}`
- first push → verdict: `{"n": 38, "median": 355.2, "p90": 486.2, "mean": 343.9}`
- CI: `{"pull_request": {"runs": 52, "minutes": 47.78, "suite_minutes": 30.85, "red": 6}, "merge_group": {"runs": 38, "minutes": 34.22, "suite_minutes": 22.59, "red": 0}}`
- aborted: None
- repo: https://github.com/kintohubtest/beanstalk-loadgen-fastify-16-7
- ruleset: `{"check_response_timeout_minutes": 30, "grouping_strategy": "ALLGREEN", "max_entries_to_build": 2, "max_entries_to_merge": 4, "merge_method": "SQUASH", "min_entries_to_merge": 1, "min_entries_to_merge_wait_minutes": 0}`
- API: `{"pushes": 53, "push_wait_s": 9.91, "mutations": 87, "mutation_wait_s": 7.63, "queries": 351, "rest": 438, "rate_limited": 0, "retry_after_s": 0.0, "hourly_cap_waits": 0}`
- kick-outs by GitHub reason: `{"PR_CHECK_FAILED": 6, "merge_conflict": 8}`
- final: suite green True, acceptance 38/38 of integrated, matches chain build False
