# Load generator run: lg-fastify-8-s11-github

| run | forge | N | integrated | ready→integrated med / p90 min | ready→stable med / p90 min | enqueue→merged med / p90 min | waiting share (change / worker) | kick-outs (red / conflict) | rebases | upstream files | per 10 min (peak) | max waiting | CI min | red validations | wall min | correct |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| lg-fastify-8-s11-github | github | 8 | 38/38 | 4.3 / 6.9 | 4.3 / 6.9 | 2.6 / 4.9 | 0.726 / 0.656 | 2 / 6 | 8 | 6 | 11.62 (15) | 8 | 79.08 | 0 | 32.7 | True |

- schedule: `{"kind": "closed", "seed": 11, "think": {"median": 88.25, "sigma": 0.462, "n": 76, "source": "fitted: pair-fastify-codex-4-s7-github, pair-fastify-codex-4-s7-beanstalk"}, "fix": {"median": 65.07, "sigma": 0.311, "n": 10, "source": "fitted: pair-fastify-codex-4-s7-github, pair-fastify-codex-4-s7-beanstalk"}, "time_scale": 1.0, "hold": "integrate"}`
- mode: standalone
- dropped: none
- reactions: `{"conflict": 6, "rebase": 8, "upstream_files_taken": 6, "red": 2}`
- first push → verdict: `{"n": 38, "median": 210.0, "p90": 362.1, "mean": 218.4}`
- CI: `{"pull_request": {"runs": 46, "minutes": 43.61, "suite_minutes": 28.65, "red": 2}, "merge_group": {"runs": 38, "minutes": 35.47, "suite_minutes": 23.33, "red": 0}}`
- aborted: None
- repo: https://github.com/kintohubtest/beanstalk-loadgen-fastify-8-11
- ruleset: `{"check_response_timeout_minutes": 30, "grouping_strategy": "ALLGREEN", "max_entries_to_build": 2, "max_entries_to_merge": 4, "merge_method": "SQUASH", "min_entries_to_merge": 1, "min_entries_to_merge_wait_minutes": 0}`
- API: `{"pushes": 47, "push_wait_s": 1.65, "mutations": 83, "mutation_wait_s": 2.11, "queries": 377, "rest": 462, "rate_limited": 0, "retry_after_s": 0.0, "hourly_cap_waits": 0}`
- kick-outs by GitHub reason: `{"PR_CHECK_FAILED": 2, "merge_conflict": 3, "CONFLICTING": 3}`
- final: suite green True, acceptance 38/38 of integrated, matches chain build True
