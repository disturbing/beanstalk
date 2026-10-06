#!/usr/bin/env python3
"""Run the GitHub arm and the Beanstalk arm one after the other on the same arena and seed, then print both rows
of ``kth_green.py``.

Both arms get the identical agent settings (adapter, model, effort, prompts from harness/prompts.py, task order,
concurrency N, CI slots K, turn/time/rework limits, ``--protect-tests landed``, no emulated CI latency); only the forge
differs:

  GitHub arm     race.py --forge github --policy queue          (GitHub's merge queue + Actions; K = build concurrency)
  Beanstalk arm  race.py --forge cloudflare --policy beanstalk-v2 --preset demo   (the deployed gateway; K = ci_slots)

Examples:
  python3 pair.py --gh-owner kintohubtest --gateway $GW --agent replay --agents 4 --ci-slots 2 --seed 7 \\
      --tasks 8 --out runs/pair-shop-replay-4-s7
  python3 pair.py --gh-owner kintohubtest --gateway $GW --agent codex --model gpt-6.1-sol --effort medium \\
      --agents 4 --ci-slots 2 --seed 7 --arena ../real-arena/fastify --repo <arena.git> --out runs/pair-fastify-4-s7
  python3 pair.py ... --dry      # print the two commands only

Outputs: <out>-github/, <out>-beanstalk/, and <out>-pair.md (both kth_green rows and the commands). The arm order
alternates with the seed unless --order is given (odd seeds GitHub first), as doc 17 §1.3's sequential fallback
says. Extra arguments after ``--`` go to both arms.
"""
from __future__ import annotations

import argparse
import json
import os
import shlex
import subprocess
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
SHARED_VALUE = ("agent", "model", "effort", "agents", "ci_slots", "batch", "seed", "budget_usd", "max_turns",
                "agent_timeout", "max_rework", "arena", "repo", "replay_median", "replay_sigma", "codex_bin",
                "claude_bin", "max_wall_minutes", "suite_timeout")


def task_count(arena: str | None, tasks: list[str] | None) -> int:
    if tasks:
        items = [x for t in tasks for x in t.split(",") if x]
        if len(items) == 1 and items[0].isdigit():
            return int(items[0])
        return len(items)
    tdir = os.path.join(arena or os.path.join(HERE, "..", "arena"), "tasks")
    return sum(1 for n in os.listdir(tdir) if n.endswith(".json"))


def build(a: argparse.Namespace, extra: list[str]) -> dict[str, list[str]]:
    shared: list[str] = ["--ci-seconds", "0", "--protect-tests", "landed"]
    for key in SHARED_VALUE:
        value = getattr(a, key)
        if value is not None:
            shared += [f"--{key.replace('_', '-')}", str(value)]
    if a.tasks:
        shared += ["--tasks", *a.tasks]
    if a.shuffle:
        shared.append("--shuffle")
    shared += extra
    py = [sys.executable, os.path.join(HERE, "race.py")]
    github = py + ["--forge", "github", "--policy", "queue", "--gh-owner", a.gh_owner, "--out", f"{a.out}-github",
                   "--force", "--gh-enqueue", a.gh_enqueue] + shared
    if a.gh_repo:
        github += ["--gh-repo", a.gh_repo]
    if a.gh_arena_name:
        github += ["--gh-arena-name", a.gh_arena_name]
    beanstalk = py + ["--policy", "beanstalk-v2", "--snapshot", "head", "--error-budget", "999",
                      "--preland-mode", "optimistic", "--out", f"{a.out}-beanstalk", "--force"]
    if a.b_forge == "cloudflare":
        beanstalk += ["--forge", "cloudflare", "--preset", "demo"]
        if a.gateway:
            beanstalk += ["--gateway", a.gateway]
        if a.max_usd is not None:
            beanstalk += ["--max-usd", str(a.max_usd)]
    beanstalk += shared
    return {"github": github, "beanstalk": beanstalk}


def main(argv: list[str] | None = None) -> int:
    argv = sys.argv[1:] if argv is None else argv
    extra: list[str] = []
    if "--" in argv:
        i = argv.index("--")
        argv, extra = argv[:i], argv[i + 1:]
    ap = argparse.ArgumentParser(description=__doc__.split("\n\n")[0], epilog=__doc__.split("\n\n", 1)[1],
                                 formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--out", required=True, help="prefix: <out>-github, <out>-beanstalk, <out>-pair.md")
    ap.add_argument("--gh-owner", default=os.environ.get("BEANSTALK_GH_OWNER"))
    ap.add_argument("--gh-repo")
    ap.add_argument("--gh-arena-name")
    ap.add_argument("--gh-enqueue", choices=["direct", "auto"], default="direct")
    ap.add_argument("--gateway", default=os.environ.get("BEANSTALK_GATEWAY"))
    ap.add_argument("--max-usd", type=float, help="Beanstalk arm: agent + infra spend cap")
    ap.add_argument("--b-forge", choices=["cloudflare", "local"], default="cloudflare",
                    help="the Beanstalk arm's forge (local only for development: the measured arm is cloudflare)")
    ap.add_argument("--order", choices=["gb", "bg"], help="arm order (default: GitHub first on odd seeds)")
    ap.add_argument("--k", nargs="+", type=int, help="k-th greens (default 50/75/90%% of the tasks)")
    ap.add_argument("--dry", action="store_true", help="print the commands and exit")
    ap.add_argument("--tasks", nargs="+")
    ap.add_argument("--shuffle", action="store_true")
    ap.add_argument("--agent", default="replay")
    ap.add_argument("--agents", type=int, default=4)
    ap.add_argument("--ci-slots", type=int, default=2)
    ap.add_argument("--batch", type=int, default=4)
    ap.add_argument("--seed", type=int, default=7)
    for key in ("model", "effort", "arena", "repo", "codex_bin", "claude_bin"):
        ap.add_argument(f"--{key.replace('_', '-')}")
    for key in ("budget_usd", "agent_timeout", "replay_median", "replay_sigma", "max_wall_minutes", "suite_timeout"):
        ap.add_argument(f"--{key.replace('_', '-')}", type=float)
    for key in ("max_turns", "max_rework"):
        ap.add_argument(f"--{key.replace('_', '-')}", type=int)
    a = ap.parse_args(argv)
    if not a.gh_owner:
        ap.error("--gh-owner (or $BEANSTALK_GH_OWNER) is required")
    if a.b_forge == "cloudflare" and not a.gateway and not a.dry:
        ap.error("--gateway (or $BEANSTALK_GATEWAY) is required for the Beanstalk arm")
    cmds = build(a, extra)
    order = a.order or ("gb" if a.seed % 2 else "bg")
    arms = ["github", "beanstalk"] if order == "gb" else ["beanstalk", "github"]
    for arm in arms:
        print(f"# {arm}: " + shlex.join(cmds[arm]), flush=True)
    if a.dry:
        return 0
    codes = {}
    for arm in arms:
        codes[arm] = subprocess.run(cmds[arm], cwd=HERE).returncode
        print(f"# {arm} exit {codes[arm]}", flush=True)
    n = task_count(a.arena, a.tasks)
    ks = a.k or sorted({max(1, round(n * f)) for f in (0.5, 0.75, 0.9)})
    runs = [f"{a.out}-github", f"{a.out}-beanstalk"]
    md = f"{a.out}-pair.md"
    res = subprocess.run([sys.executable, os.path.join(HERE, "kth_green.py"), *runs, "--k", *map(str, ks)],
                         cwd=HERE, capture_output=True, text=True)
    print(res.stdout, end="")
    with open(os.path.join(HERE, md) if not os.path.isabs(md) else md, "w", encoding="utf-8") as fh:
        fh.write(res.stdout + "\n" + "\n".join(f"- {arm} (exit {codes[arm]}): `{shlex.join(cmds[arm][1:])}`"
                                              for arm in arms) + "\n")
    with open(os.path.join(HERE, f"{a.out}-pair.json") if not os.path.isabs(a.out) else f"{a.out}-pair.json", "w",
              encoding="utf-8") as fh:
        json.dump({"order": arms, "codes": codes, "commands": cmds, "k": ks}, fh, indent=2)
    return 0 if all(c == 0 for c in codes.values()) else 3


if __name__ == "__main__":
    sys.exit(main())
