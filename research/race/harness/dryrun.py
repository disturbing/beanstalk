"""--dry-run: everything except agent invocations. Writes dry_run.json in the run directory."""
from __future__ import annotations

import json
import os
import subprocess

from .agents import ClaudeAdapter, InvocationSpec
from .core import RaceConfig
from . import prompts


async def run_dry(cfg: RaceConfig) -> dict:
    from race import make_race  # type: ignore
    cfg.force = True
    race = make_race(cfg)
    await race.setup()
    git, ci = race.git, race.ci
    report: dict = {"ok": True, "problems": [], "policy": cfg.policy, "agent": cfg.agent, "arena": cfg.arena,
                    "repo": cfg.repo, "base": race.base_sha, "tasks": {}, "footprint_method": race.footprint_method}
    problems = report["problems"]
    try:
        if cfg.footprint == "haiku":
            race.footprint_method = "lexical"
            report["footprint_note"] = "dry run predicts with the lexical fallback; --footprint haiku would cost money"
        await race.predict_footprints()
        base_res = await ci.run(race.base_sha, "dry", latency=0)
        report["base_suite"] = {"green": base_res.green, "tests": base_res.tests,
                                "suite_seconds": round(base_res.suite_seconds, 3)}
        if not base_res.green:
            problems.append(f"base suite is red: {base_res.failing_files}")
        solution_commits: dict[str, str] = {}
        work = os.path.join(race.work, "dry")
        await git.add_worktree(work, race.base_sha)
        for ts in race.tasks:
            t = ts.task
            row: dict = {"title": t.title, "predicted": ts.selected, "oracle_modules": t.oracle_modules,
                         "acceptance": t.acceptance_paths}
            if not t.acceptance_tests:
                problems.append(f"{t.id}: no acceptance tests")
            # acceptance tests must fail on base
            acc_base = await ci.run(race.base_sha, "dry", latency=0, extra_files=t.acceptance_tests)
            row["acceptance_fails_on_base"] = bool(set(acc_base.failing_files or []) & set(t.acceptance_tests))
            if not row["acceptance_fails_on_base"]:
                problems.append(f"{t.id}: acceptance tests pass on base")
            # reference solution must apply and pass
            if not t.solution:
                row["solution"] = "missing"
                if cfg.agent == "replay":
                    problems.append(f"{t.id}: no solutions/{t.id}.patch (replay needs it)")
            else:
                await git.checkout_detached(work, race.base_sha)
                race.write_acceptance(work, [t])
                p = race.patch_ref(t.solution)[0]
                ap = await git.run("apply", "--whitespace=nowarn", f"-p{p['strip']}", p["path"], cwd=work, check=False)
                if ap.returncode != 0:
                    row["solution"] = f"does not apply: {ap.stderr.strip()[:300]}"
                    problems.append(f"{t.id}: solution patch does not apply")
                else:
                    sha, _ = await git.commit_all(work, f"{t.title}\n\nTask: {t.id}\n")
                    solution_commits[t.id] = sha
                    sol = await ci.run(sha, "dry", latency=0)
                    row["solution"] = "passes" if sol.green else f"fails: {sol.failing_files}"
                    if not sol.green:
                        problems.append(f"{t.id}: base + solution is red")
            report["tasks"][t.id] = row
        # designed couplings under this run's merge drivers
        couplings = []
        seen = set()
        for ts in race.tasks:
            for c in ts.task.couplings:
                other = c.get("with")
                key = tuple(sorted((ts.id, other or "")))
                if not other or key in seen or ts.id not in solution_commits or other not in solution_commits:
                    continue
                seen.add(key)
                a, b = solution_commits[key[0]], solution_commits[key[1]]
                tree, conflicts = await git.merge_tree(race.base_sha, a, b)
                row = {"pair": list(key), "type": c.get("type"), "textual_conflict": tree is None,
                       "conflict_files": conflicts}
                if tree is not None:
                    merged = await git.commit_tree(tree, [a, b], "dry-run pair merge\n")
                    res = await ci.run(merged, "dry", latency=0)
                    row["suite_green"] = res.green
                    row["failing"] = res.failing_files
                couplings.append(row)
        report["couplings"] = couplings
        report["union_merge"] = cfg.union()
        # agent command line
        sample = race.tasks[0] if race.tasks else None
        if cfg.agent in ("claude", "codex") and sample:
            spec = InvocationSpec(inv_id="dry", kind="initial", task_id=sample.id, agent_id="a0",
                                  cwd=os.path.join(race.work, "agents", sample.id), prompt=prompts.initial(sample.task),
                                  budget_cap_usd=cfg.max_invocation_usd)
            argv = race.adapter.argv(spec, "00000000-0000-4000-8000-000000000000") \
                if isinstance(race.adapter, ClaudeAdapter) else race.adapter.argv(spec)  # type: ignore[union-attr]
            binary = cfg.claude_bin if cfg.agent == "claude" else cfg.codex_bin
            ver = subprocess.run([binary, "--version"], capture_output=True, text=True, timeout=30)
            report["agent_cli"] = {"version": (ver.stdout or ver.stderr).strip(), "argv": argv,
                                   "prompt_on_stdin": prompts.initial(sample.task)}
        report["estimate"] = estimate(cfg, len(race.tasks))
    finally:
        await race.registry.kill_all()
    report["ok"] = not problems
    with open(os.path.join(race.out, "dry_run.json"), "w") as fh:
        json.dump(report, fh, indent=2, default=str)
    if race.events:
        race.events.close()
    return report


def estimate(cfg: RaceConfig, n_tasks: int) -> dict:
    """Back-of-envelope duration and cost for a real-agent race (labelled as an estimate)."""
    per_task_min = {"haiku": 3.0, "sonnet": 5.0, "opus": 6.0}.get((cfg.model or "sonnet").split("-")[0], 5.0)
    per_task_usd = {"haiku": 0.15, "sonnet": 0.45, "opus": 0.9}.get((cfg.model or "sonnet").split("-")[0], 0.5)
    rounds = n_tasks / max(cfg.agents, 1)
    return {"note": "estimate only; calibrate from the first real run's summary.json",
            "agent_minutes_per_task": per_task_min, "usd_per_initial_invocation": per_task_usd,
            "wall_minutes_lower_bound": round(rounds * per_task_min + cfg.ci_seconds / 60, 1),
            "usd_initial_only": round(n_tasks * per_task_usd, 2)}
