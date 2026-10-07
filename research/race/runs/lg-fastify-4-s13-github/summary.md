# Load generator run: lg-fastify-4-s13-github

| run | forge | N | integrated | ready→integrated med / p90 min | ready→stable med / p90 min | enqueue→merged med / p90 min | waiting share (change / worker) | kick-outs (red / conflict) | rebases | upstream files | per 10 min (peak) | max waiting | CI min | red validations | wall min | correct |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| lg-fastify-4-s13-github | github | 4 | 38/38 | 2.9 / 4.4 | 2.9 / 4.4 | 1.7 / 2.7 | 0.668 / 0.628 | 1 / 3 | 4 | 2 | 8.2 (10) | 4 | 73.5 | 0 | 46.3 | True |

- schedule: `{"kind": "closed", "seed": 13, "think": {"median": 88.25, "sigma": 0.462, "n": 76, "source": "fitted: pair-fastify-codex-4-s7-github, pair-fastify-codex-4-s7-beanstalk"}, "fix": {"median": 65.07, "sigma": 0.311, "n": 10, "source": "fitted: pair-fastify-codex-4-s7-github, pair-fastify-codex-4-s7-beanstalk"}, "time_scale": 1.0, "hold": "integrate"}`
- mode: standalone
- dropped: none
- reactions: `{"conflict": 3, "rebase": 4, "red": 1, "upstream_files_taken": 2}`
- first push → verdict: `{"n": 38, "median": 167.7, "p90": 189.8, "mean": 165.8}`
- CI: `{"pull_request": {"runs": 42, "minutes": 38.81, "suite_minutes": 25.4, "red": 1}, "merge_group": {"runs": 38, "minutes": 34.69, "suite_minutes": 22.81, "red": 0}}`
- aborted: None
- repo: https://github.com/kintohubtest/beanstalk-loadgen-fastify-4-13
- ruleset: `{"check_response_timeout_minutes": 30, "grouping_strategy": "ALLGREEN", "max_entries_to_build": 2, "max_entries_to_merge": 4, "merge_method": "SQUASH", "min_entries_to_merge": 1, "min_entries_to_merge_wait_minutes": 0}`
- API: `{"pushes": 43, "push_wait_s": 3.09, "mutations": 83, "mutation_wait_s": 0.37, "queries": 533, "rest": 618, "rate_limited": 0, "retry_after_s": 0.0, "hourly_cap_waits": 0}`
- kick-outs by GitHub reason: `{"PR_CHECK_FAILED": 1, "merge_conflict": 2, "CONFLICTING": 1}`
- final: suite green True, acceptance 37/38 of integrated, matches chain build True
