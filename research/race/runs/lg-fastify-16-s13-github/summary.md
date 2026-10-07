# Load generator run: lg-fastify-16-s13-github

| run | forge | N | integrated | ready→integrated med / p90 min | ready→stable med / p90 min | enqueue→merged med / p90 min | waiting share (change / worker) | kick-outs (red / conflict) | rebases | upstream files | per 10 min (peak) | max waiting | CI min | red validations | wall min | correct |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| lg-fastify-16-s13-github | github | 16 | 38/38 | 7.1 / 16.2 | 7.1 / 16.2 | 5.4 / 10.8 | 0.774 / 0.585 | 17 / 13 | 30 | 220 | 11.71 (15) | 16 | 93.14 | 0 | 32.5 | True |

- schedule: `{"kind": "closed", "seed": 13, "think": {"median": 88.25, "sigma": 0.462, "n": 76, "source": "fitted: pair-fastify-codex-4-s7-github, pair-fastify-codex-4-s7-beanstalk"}, "fix": {"median": 65.07, "sigma": 0.311, "n": 10, "source": "fitted: pair-fastify-codex-4-s7-github, pair-fastify-codex-4-s7-beanstalk"}, "time_scale": 1.0, "hold": "integrate"}`
- mode: standalone
- dropped: none
- reactions: `{"conflict": 13, "rebase": 30, "red": 17, "upstream_after_red": 11, "upstream_files_taken": 220}`
- first push → verdict: `{"n": 38, "median": 321.0, "p90": 496.5, "mean": 325.3}`
- CI: `{"pull_request": {"runs": 68, "minutes": 57.09, "suite_minutes": 35.85, "red": 17}, "merge_group": {"runs": 38, "minutes": 36.05, "suite_minutes": 23.73, "red": 0}}`
- aborted: None
- repo: https://github.com/kintohubtest/beanstalk-loadgen-fastify-16-13
- ruleset: `{"check_response_timeout_minutes": 30, "grouping_strategy": "ALLGREEN", "max_entries_to_build": 2, "max_entries_to_merge": 4, "merge_method": "SQUASH", "min_entries_to_merge": 1, "min_entries_to_merge_wait_minutes": 0}`
- API: `{"pushes": 69, "push_wait_s": 13.82, "mutations": 89, "mutation_wait_s": 8.61, "queries": 354, "rest": 455, "rate_limited": 0, "retry_after_s": 0.0, "hourly_cap_waits": 0}`
- kick-outs by GitHub reason: `{"PR_CHECK_FAILED": 17, "CONFLICTING": 4, "merge_conflict": 9}`
- final: suite green True, acceptance 38/38 of integrated, matches chain build False
