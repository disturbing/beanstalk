"""Overhead of traced checks: runs a release runner and asks it for untraced and traced checks of
one commit, plus per-file untraced node runs for the decomposition. Runs inside bs-runner-test.

  python3 measure.py --repo /corpora/arena.git --label shop [--ref main] [--cmd '["node","--test"]']
"""

import argparse
import json
import os
import shutil
import subprocess
import sys
import time
import urllib.request

PORT = 8181


def post(path, body, timeout=900):
    req = urllib.request.Request(f"http://127.0.0.1:{PORT}{path}", data=json.dumps(body).encode(),
                                 headers={"content-type": "application/json"})
    with urllib.request.urlopen(req, timeout=timeout) as resp:
        return json.loads(resp.read())


def get(path):
    with urllib.request.urlopen(f"http://127.0.0.1:{PORT}{path}", timeout=30) as resp:
        return json.loads(resp.read())


def git(*args, cwd=None):
    return subprocess.run(["git", *args], cwd=cwd, check=True, capture_output=True, text=True).stdout.strip()


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--repo", required=True)
    ap.add_argument("--ref", default="main")
    ap.add_argument("--label", required=True)
    ap.add_argument("--cmd", default='["node","--test"]')
    ap.add_argument("--runs", type=int, default=3)
    ap.add_argument("--out", default="/out")
    args = ap.parse_args()
    cmd = json.loads(args.cmd)
    bare = f"/repos/{args.label}.git"
    shutil.rmtree(bare, ignore_errors=True)
    git("clone", "--quiet", "--bare", args.repo, bare)
    sha = git("rev-parse", args.ref, cwd=bare)
    env = dict(os.environ, PORT=str(PORT), WORK_DIR="/work", REMOTE_SCHEMES="https,file", RUST_LOG="warn",
               BEANSTALK_GIT_SHA="local")
    runner = subprocess.Popen(["/target/release/runner"], env=env, stdout=subprocess.DEVNULL)
    try:
        for _ in range(100):
            try:
                health = get("/healthz")
                break
            except OSError:
                time.sleep(0.1)
        print("health", health, "cpus", os.cpu_count(), flush=True)
        body = {"repo": f"file://{bare}", "token": "local", "sha": sha, "cmd": cmd}
        post("/v1/check", body)  # warm: fetch and node's compile cache
        rows = {"untraced": [], "traced": []}
        for i in range(args.runs):
            for mode in ("untraced", "traced"):
                t0 = time.perf_counter()
                res = post("/v1/check", {**body, "trace": mode == "traced"})
                wall = time.perf_counter() - t0
                rows[mode].append({"wall": wall, "suite_seconds": res["suite_seconds"], "green": res["green"],
                                   "tests": res["tests"], "failing_files": res["failing_files"],
                                   "maps": res.get("read_maps")})
                print(f"{mode} #{i}: suite={res['suite_seconds']:.2f}s wall={wall:.2f}s green={res['green']} "
                      f"tests={res['tests']} failing={res['failing_files']}", flush=True)
        maps = rows["traced"][-1]["maps"]
        files = [m["file"] for m in maps["files"]]
        # Decomposition: each file in its own untraced process (as traced, without strace).
        checkout = f"/tmp/co-{args.label}"
        shutil.rmtree(checkout, ignore_errors=True)
        git("worktree", "add", "--detach", checkout, sha, cwd=bare)
        options = [a for a in cmd[1:] if a.startswith("-")]
        per_file = []
        t_all = time.perf_counter()
        for f in files:
            t0 = time.perf_counter()
            subprocess.run([cmd[0], *options, "--test-reporter=dot", "--", f], cwd=checkout,
                           stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL, env=dict(os.environ, CI="1"))
            per_file.append(time.perf_counter() - t0)
        per_file_wall = time.perf_counter() - t_all
        med = lambda xs: sorted(xs)[len(xs) // 2]
        untraced = med([r["suite_seconds"] for r in rows["untraced"]])
        traced = med([r["suite_seconds"] for r in rows["traced"]])
        traced_files = [m for m in maps["files"]]
        summary = {
            "label": args.label, "sha": sha, "cpus": os.cpu_count(), "test_files": len(files),
            "untraced_suite_s": untraced, "traced_suite_s": traced, "ratio": traced / untraced,
            "per_file_untraced_sequential_s": per_file_wall,
            "per_file_traced_sum_s": sum(m["seconds"] for m in traced_files),
            "trace_vs_per_file_ratio": sum(m["seconds"] for m in traced_files) / per_file_wall,
            "mean_reads": sum(len(m["reads"]) for m in traced_files) / len(files),
            "mean_probes": sum(len(m["probes"]) for m in traced_files) / len(files),
            "mean_dirs": sum(len(m["dirs"]) for m in traced_files) / len(files),
            "mean_packages": sum(len(m["packages"]) for m in traced_files) / len(files),
            "map_json_bytes": len(json.dumps(maps)),
            "all_traced": all(m["traced"] for m in traced_files),
            "verdicts_agree": all(r["green"] == rows["untraced"][0]["green"] for r in rows["traced"]),
            "runs": {k: [{kk: vv for kk, vv in r.items() if kk != "maps"} for r in v] for k, v in rows.items()},
        }
        os.makedirs(args.out, exist_ok=True)
        json.dump(summary, open(f"{args.out}/overhead-{args.label}.json", "w"), indent=1)
        json.dump(maps, open(f"{args.out}/maps-{args.label}.json", "w"), indent=1)
        print(json.dumps({k: v for k, v in summary.items() if k != "runs"}, indent=1))
    finally:
        runner.terminate()


if __name__ == "__main__":
    sys.exit(main())
