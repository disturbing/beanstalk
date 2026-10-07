# Load generator run: lg-fastify-8-s7-github

| run | forge | N | integrated | ready→integrated med / p90 min | ready→stable med / p90 min | enqueue→merged med / p90 min | waiting share (change / worker) | kick-outs (red / conflict) | rebases | upstream files | per 10 min (peak) | max waiting | CI min | red validations | wall min | correct |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| lg-fastify-8-s7-github | github | 8 | 38/38 | 4.0 / 6.9 | 4.0 / 6.9 | 2.5 / 3.7 | 0.715 / 0.648 | 6 / 4 | 10 | 65 | 12.24 (16) | 8 | 78.64 | 0 | 31.0 | True |

- schedule: `{"kind": "closed", "seed": 7, "think": {"median": 88.25, "sigma": 0.462, "n": 76, "source": "fitted: pair-fastify-codex-4-s7-github, pair-fastify-codex-4-s7-beanstalk"}, "fix": {"median": 65.07, "sigma": 0.311, "n": 10, "source": "fitted: pair-fastify-codex-4-s7-github, pair-fastify-codex-4-s7-beanstalk"}, "time_scale": 1.0, "hold": "integrate"}`
- mode: standalone
- dropped: none
- reactions: `{"conflict": 4, "rebase": 10, "upstream_files_taken": 65, "red": 6, "upstream_after_red": 3}`
- first push → verdict: `{"n": 38, "median": 215.8, "p90": 299.4, "mean": 212.1}`
- CI: `{"pull_request": {"runs": 48, "minutes": 42.89, "red": 6}, "merge_group": {"runs": 38, "minutes": 35.75, "red": 0}}`
- aborted: None
- repo: https://github.com/kintohubtest/beanstalk-loadgen-fastify-8-7
- ruleset: `{"check_response_timeout_minutes": 30, "grouping_strategy": "ALLGREEN", "max_entries_to_build": 2, "max_entries_to_merge": 4, "merge_method": "SQUASH", "min_entries_to_merge": 1, "min_entries_to_merge_wait_minutes": 0}`
- API: `{"pushes": 49, "push_wait_s": 7.91, "mutations": 81, "mutation_wait_s": 2.09, "queries": 346, "rest": 435, "rate_limited": 0, "retry_after_s": 0.0, "hourly_cap_waits": 0}`
- kick-outs by GitHub reason: `{"PR_CHECK_FAILED": 6, "merge_conflict": 2, "CONFLICTING": 2}`
- final: suite green True, acceptance 38/38 of integrated, matches chain build True
