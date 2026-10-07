# Load generator run: lg-fastify-16-s11-github

| run | forge | N | integrated | ready→integrated med / p90 min | ready→stable med / p90 min | enqueue→merged med / p90 min | waiting share (change / worker) | kick-outs (red / conflict) | rebases | upstream files | per 10 min (peak) | max waiting | CI min | red validations | wall min | correct |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| lg-fastify-16-s11-github | github | 16 | 38/38 | 6.6 / 12.7 | 6.6 / 12.7 | 5.2 / 10.5 | 0.775 / 0.613 | 13 / 7 | 20 | 127 | 13.68 (18) | 16 | 83.75 | 0 | 27.8 | True |

- schedule: `{"kind": "closed", "seed": 11, "think": {"median": 88.25, "sigma": 0.462, "n": 76, "source": "fitted: pair-fastify-codex-4-s7-github, pair-fastify-codex-4-s7-beanstalk"}, "fix": {"median": 65.07, "sigma": 0.311, "n": 10, "source": "fitted: pair-fastify-codex-4-s7-github, pair-fastify-codex-4-s7-beanstalk"}, "time_scale": 1.0, "hold": "integrate"}`
- mode: standalone
- dropped: none
- reactions: `{"conflict": 7, "rebase": 20, "upstream_files_taken": 127, "red": 13, "upstream_after_red": 7}`
- first push → verdict: `{"n": 38, "median": 360.5, "p90": 407.2, "mean": 310.4}`
- CI: `{"pull_request": {"runs": 58, "minutes": 48.0, "suite_minutes": 29.5, "red": 13}, "merge_group": {"runs": 38, "minutes": 35.75, "suite_minutes": 23.34, "red": 0}}`
- aborted: None
- repo: https://github.com/kintohubtest/beanstalk-loadgen-fastify-16-11
- ruleset: `{"check_response_timeout_minutes": 30, "grouping_strategy": "ALLGREEN", "max_entries_to_build": 2, "max_entries_to_merge": 4, "merge_method": "SQUASH", "min_entries_to_merge": 1, "min_entries_to_merge_wait_minutes": 0}`
- API: `{"pushes": 59, "push_wait_s": 8.2, "mutations": 86, "mutation_wait_s": 10.47, "queries": 268, "rest": 368, "rate_limited": 0, "retry_after_s": 0.0, "hourly_cap_waits": 0}`
- kick-outs by GitHub reason: `{"PR_CHECK_FAILED": 13, "merge_conflict": 7}`
- final: suite green True, acceptance 38/38 of integrated, matches chain build False
