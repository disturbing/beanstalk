#!/usr/bin/env python3
"""Plan which arena tasks to bundle into compound tasks (input to build_long.py).

Constraints (hard):
  * members of a group never conflict textually, except in CHANGELOG.md / README.md (union-resolvable);
  * members are never a designed semantic or textual coupling (those stay between compounds, so the arena's
    designed interactions survive as bean-to-bean interactions);
  * group sizes are 2 or 3 (--triples triples, the rest pairs);
  * every designed SEMANTIC coupling (A, B) must stay "merges cleanly, breaks tests" between the compounds that
    hold A and B: no other member pair across the two groups may conflict textually (CHANGELOG/README by union),
    otherwise the compounds would conflict in text and mask the semantic break;
  * pairs listed in --exclude (natural semantic breaks found while building) never share a group.
Objective (soft): relatedness. Members share a module (+1 per shared source module) and files (+2 per shared
non-hot source file), and the group has one dominant area.

A seeded random-restart hill climb over partitions; prints the plan and the contention it leaves between
compounds (pair conflict rate with and without union merge of CHANGELOG/README).

Usage: python3 plan_groups.py --triples 8 --seed 7 --out groups/long16.json
"""
from __future__ import annotations

import argparse
import itertools
import json
import random
from collections import Counter
from pathlib import Path

HERE = Path(__file__).resolve().parent
UNION_OK = {"CHANGELOG.md", "README.md"}
HOT = {"CHANGELOG.md", "README.md", "src/routes.ts", "src/types.ts", "src/db/migrations/index.ts", "src/config.ts",
       "src/lib/money.ts"}


def module_of(p: str) -> str:
    segs = p.split("/")[:-1]
    return "/".join(segs[:2]) if segs else "(root)"


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--triples", type=int, default=8)
    ap.add_argument("--seed", type=int, default=7)
    ap.add_argument("--restarts", type=int, default=400)
    ap.add_argument("--pairs-file", default=str(HERE / "data" / "pairs.json"))
    ap.add_argument("--exclude", default=str(HERE / "groups" / "exclude.json"),
                    help="json list of [a, b] task pairs that must not share a group")
    ap.add_argument("--out", default=str(HERE / "groups" / "long16.json"))
    a = ap.parse_args()
    d = json.loads(Path(a.pairs_file).read_text())
    ids: list[str] = d["ids"]
    files = {i: [f for f in d["files"][i] if not f.endswith(".test.ts")] for i in ids}
    arena = HERE / "arena" / "tasks"
    couple: set[frozenset] = set()
    sem_pairs: set[tuple[str, str]] = set()
    for i in ids:
        t = json.loads((arena / f"{i}.json").read_text())
        for c in t["couplings"]:
            couple.add(frozenset((i, c["with"])))
            if c["type"] == "semantic":
                sem_pairs.add(tuple(sorted((i, c["with"]))))
    exclude: set[frozenset] = set()
    if Path(a.exclude).exists():
        exclude = {frozenset(x) for x in json.loads(Path(a.exclude).read_text())}

    def pair(x: str, y: str) -> dict:
        return d["pairs"][f"{min(x, y)}+{max(x, y)}"]

    def clean_union(x: str, y: str) -> bool:
        p = pair(x, y)
        return (not p["conflict"]) or set(p["files"]) <= UNION_OK

    def ok(x: str, y: str) -> bool:
        if frozenset((x, y)) in couple or frozenset((x, y)) in exclude:
            return False
        return clean_union(x, y)

    def violations(part: list[list[str]]) -> int:
        where = {t: gi for gi, g in enumerate(part) for t in g}
        v = 0
        for x, y in sem_pairs:
            gx, gy = part[where[x]], part[where[y]]
            if gx is gy or not all(clean_union(m, n) for m in gx for n in gy if (m, n) != (x, y) and (n, m) != (x, y)):
                v += 1
        return v

    def rel(x: str, y: str) -> float:
        mx = {module_of(f) for f in files[x]} - {"(root)", "src"}
        my = {module_of(f) for f in files[y]} - {"(root)", "src"}
        s = 1.0 * len(mx & my)
        s += 2.0 * len((set(files[x]) & set(files[y])) - HOT)
        return s

    def group_score(g: list[str]) -> float:
        return sum(rel(x, y) for x, y in itertools.combinations(g, 2))

    def valid(g: list[str]) -> bool:
        return all(ok(x, y) for x, y in itertools.combinations(g, 2))

    rng = random.Random(a.seed)
    n_pairs = (len(ids) - 3 * a.triples) // 2
    assert 3 * a.triples + 2 * n_pairs == len(ids), "sizes must tile the 40 tasks"
    best, best_score = None, -1e9

    def random_partition() -> list[list[str]] | None:
        for _ in range(200):
            pool = ids[:]
            rng.shuffle(pool)
            groups: list[list[str]] = []
            sizes = [3] * a.triples + [2] * n_pairs
            rng.shuffle(sizes)
            okp = True
            for s in sizes:
                g = []
                for t in list(pool):
                    if all(ok(t, m) for m in g):
                        g.append(t)
                        pool.remove(t)
                        if len(g) == s:
                            break
                if len(g) != s:
                    okp = False
                    break
                groups.append(g)
            if okp:
                return groups
        return None

    for _ in range(a.restarts):
        part = random_partition()
        if part is None:
            continue
        def total(pt: list[list[str]]) -> float:
            return sum(group_score(g) for g in pt) - 100.0 * violations(pt)

        cur = total(part)
        improved = True
        while improved:
            improved = False
            for gi, gj in itertools.combinations(range(len(part)), 2):
                for xi in range(len(part[gi])):
                    for xj in range(len(part[gj])):
                        g1, g2 = part[gi][:], part[gj][:]
                        g1[xi], g2[xj] = g2[xj], g1[xi]
                        if not (valid(g1) and valid(g2)):
                            continue
                        old1, old2 = part[gi], part[gj]
                        part[gi], part[gj] = g1, g2
                        new = total(part)
                        if new > cur + 1e-9:
                            cur, improved = new, True
                        else:
                            part[gi], part[gj] = old1, old2
        sc = cur
        if sc > best_score:
            best, best_score = [g[:] for g in part], sc
    assert best is not None, "no valid partition found"

    # name groups by their dominant source module; stable order: by lowest task id
    best = sorted((sorted(g) for g in best), key=lambda g: g[0])
    plan = []
    for k, g in enumerate(best, 1):
        mods = Counter(module_of(f) for t in g for f in files[t] if module_of(f) not in ("(root)", "src"))
        top = [m.replace("src/", "") for m, _ in mods.most_common(2)]
        theme = " and ".join(top) if top else "shared infrastructure"
        plan.append({"id": f"L{k:02d}", "members": g, "theme": theme})
    # contention left between compounds
    owner = {m: g["id"] for g in plan for m in g["members"]}
    cmap: dict[frozenset, set] = {}
    plain = union = 0
    gids = [g["id"] for g in plan]
    for x, y in itertools.combinations(ids, 2):
        if owner[x] == owner[y]:
            continue
        p = pair(x, y)
        if not p["conflict"]:
            continue
        key = frozenset((owner[x], owner[y]))
        cmap.setdefault(key, set()).update(p["files"])
    npairs = len(gids) * (len(gids) - 1) // 2
    plain = len(cmap)
    union = sum(1 for fs in cmap.values() if not fs <= {"CHANGELOG.md"})
    print(f"{len(plan)} compounds ({a.triples} triples, {n_pairs} pairs); objective {best_score:.1f}; "
          f"semantic couplings masked by text conflicts: {violations([g['members'] for g in plan])}")
    for g in plan:
        print(f"  {g['id']} {g['members']}  [{g['theme']}]")
    print(f"compound pairs: {npairs}; conflicting (plain merge) {plain} = {100 * plain / npairs:.0f}%; "
          f"after union of CHANGELOG {union} = {100 * union / npairs:.0f}%")
    print("arena singles: 780 pairs, 58 conflicting = 7.4%")
    Path(a.out).parent.mkdir(parents=True, exist_ok=True)
    Path(a.out).write_text(json.dumps(plan, indent=1) + "\n")
    print("wrote", a.out)


if __name__ == "__main__":
    main()
