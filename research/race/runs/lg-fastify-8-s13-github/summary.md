# Load generator run: lg-fastify-8-s13-github

| run | forge | N | integrated | ready→integrated med / p90 min | ready→stable med / p90 min | enqueue→merged med / p90 min | waiting share (change / worker) | kick-outs (red / conflict) | rebases | upstream files | per 10 min (peak) | max waiting | CI min | red validations | wall min | correct |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| lg-fastify-8-s13-github | github | 8 | 38/38 | 3.7 / 5.1 | 3.7 / 5.1 | 2.5 / 3.7 | 0.718 / 0.656 | 3 / 3 | 6 | 6 | 12.84 (17) | 8 | 73.57 | 0 | 29.6 | True |

- schedule: `{"kind": "closed", "seed": 13, "think": {"median": 88.25, "sigma": 0.462, "n": 76, "source": "fitted: pair-fastify-codex-4-s7-github, pair-fastify-codex-4-s7-beanstalk"}, "fix": {"median": 65.07, "sigma": 0.311, "n": 10, "source": "fitted: pair-fastify-codex-4-s7-github, pair-fastify-codex-4-s7-beanstalk"}, "time_scale": 1.0, "hold": "integrate"}`
- mode: standalone
- dropped: none
- reactions: `{"conflict": 3, "rebase": 6, "upstream_files_taken": 6, "red": 3, "upstream_after_red": 1}`
- first push → verdict: `{"n": 38, "median": 219.5, "p90": 276.9, "mean": 216.1}`
- CI: `{"pull_request": {"runs": 44, "minutes": 39.48, "suite_minutes": 25.83, "red": 3}, "merge_group": {"runs": 38, "minutes": 34.09, "suite_minutes": 22.59, "red": 0}}`
- aborted: None
- repo: https://github.com/kintohubtest/beanstalk-loadgen-fastify-8-13
- ruleset: `{"check_response_timeout_minutes": 30, "grouping_strategy": "ALLGREEN", "max_entries_to_build": 2, "max_entries_to_merge": 4, "merge_method": "SQUASH", "min_entries_to_merge": 1, "min_entries_to_merge_wait_minutes": 0}`
- API: `{"pushes": 45, "push_wait_s": 5.1, "mutations": 82, "mutation_wait_s": 5.56, "queries": 356, "rest": 440, "rate_limited": 0, "retry_after_s": 0.0, "hourly_cap_waits": 0}`
- kick-outs by GitHub reason: `{"PR_CHECK_FAILED": 3, "merge_conflict": 3}`
- final: suite green True, acceptance 38/38 of integrated, matches chain build True
