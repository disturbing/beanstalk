# Load generator run: lg-fastify-4-s7-github

| run | forge | N | integrated | ready→integrated med / p90 min | ready→stable med / p90 min | enqueue→merged med / p90 min | waiting share (change / worker) | kick-outs (red / conflict) | rebases | upstream files | per 10 min (peak) | max waiting | CI min | red validations | wall min | correct |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| lg-fastify-4-s7-github | github | 4 | 38/38 | 3.1 / 4.9 | 3.1 / 4.9 | 1.8 / 3.1 | 0.691 / 0.647 | 1 / 2 | 3 | 1 | 7.61 (10) | 4 | 75.96 | 0 | 49.9 | True |

- schedule: `{"kind": "closed", "seed": 7, "think": {"median": 88.25, "sigma": 0.462, "n": 76, "source": "fitted: pair-fastify-codex-4-s7-github, pair-fastify-codex-4-s7-beanstalk"}, "fix": {"median": 65.07, "sigma": 0.311, "n": 10, "source": "fitted: pair-fastify-codex-4-s7-github, pair-fastify-codex-4-s7-beanstalk"}, "time_scale": 1.0, "hold": "integrate"}`
- mode: standalone
- dropped: none
- reactions: `{"conflict": 2, "rebase": 3, "red": 1, "upstream_files_taken": 1}`
- first push → verdict: `{"n": 38, "median": 172.0, "p90": 250.9, "mean": 190.9}`
- CI: `{"pull_request": {"runs": 41, "minutes": 38.57, "red": 1}, "merge_group": {"runs": 38, "minutes": 37.39, "red": 0}}`
- aborted: None
- repo: https://github.com/kintohubtest/beanstalk-loadgen-fastify-4-7
- ruleset: `{"check_response_timeout_minutes": 30, "grouping_strategy": "ALLGREEN", "max_entries_to_build": 2, "max_entries_to_merge": 4, "merge_method": "SQUASH", "min_entries_to_merge": 1, "min_entries_to_merge_wait_minutes": 0}`
- API: `{"pushes": 42, "push_wait_s": 1.99, "mutations": 83, "mutation_wait_s": 0.68, "queries": 549, "rest": 639, "rate_limited": 0, "retry_after_s": 0.0, "hourly_cap_waits": 0}`
- kick-outs by GitHub reason: `{"PR_CHECK_FAILED": 1, "merge_conflict": 2}`
- final: suite green True, acceptance 38/38 of integrated, matches chain build True
