#!/usr/bin/env python3
"""Assign ids, build every task in a temp repo, and write arena/tasks/*.json + arena/solutions/*.patch.

The id order comes from a seeded search (the best-balanced of the shuffles tried), so rebuilding is
deterministic. Takes a few minutes: every task is built and its tests are run twice. Afterwards run
materialize.py and validate.py. Also writes author/ids.json (slug -> id, and the seed used).

    python3 author/build_all.py
"""
import argparse, glob, importlib, json, os, random, sys

sys.dont_write_bytecode = True
HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
from lib import REGISTRY, build, oracle_json, TASKS_DIR, SOL_DIR  # noqa: E402


def pick_order(slugs, results, seeds):
    """Shuffle the slugs so that each window of ten ids has a similar share of billing and hot-file tasks."""
    cat = {s: ("src/billing" in results[s]["modules"], bool(results[s]["hot"])) for s in slugs}
    pairs = {frozenset((s, other)) for s in slugs for other, _, _ in REGISTRY[s].couplings}

    def score(order):
        sc = 0.0
        for w in range(0, len(order), 10):
            win = order[w:w + 10]
            b = sum(1 for s in win if cat[s][0])
            h = sum(1 for s in win if cat[s][1])
            sc += (b - 4.5) ** 2 + (h - 4.25) ** 2
        for p in pairs:  # keep coupled tasks apart, but not always far apart
            a, b = tuple(p)
            if abs(order.index(a) - order.index(b)) < 2:
                sc += 50
        return sc

    best = None
    for seed in range(1, seeds):
        order = slugs[:]
        random.Random(seed).shuffle(order)
        sc = score(order)
        if best is None or sc < best[0]:
            best = (sc, seed, order)
    return best


def main(argv=None) -> int:
    ap = argparse.ArgumentParser(description=__doc__.split("\n\n")[0], epilog=__doc__.split("\n\n", 1)[1],
                                 formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--seeds", type=int, default=4000, help="shuffle seeds 1..N-1 to try when ordering ids (default: 4000)")
    args = ap.parse_args(argv)

    for f in sorted(glob.glob(os.path.join(HERE, "tasks_*.py"))):
        importlib.import_module(os.path.basename(f)[:-3])
    slugs = sorted(REGISTRY)
    for s in slugs:  # couplings must be declared on both tasks
        for other, kind, _ in REGISTRY[s].couplings:
            assert any(o == s and k == kind for o, k, _ in REGISTRY[other].couplings), (s, other, kind)

    results = {s: build(REGISTRY[s], check=False) for s in slugs}
    score, seed, order = pick_order(slugs, results, args.seeds)
    print(f"{len(slugs)} tasks, order seed {seed}, balance score {score:.2f}")
    id_of = {s: f"t{i + 1:03d}" for i, s in enumerate(order)}

    for old in TASKS_DIR.glob("t*.json"):
        old.unlink()
    for old in SOL_DIR.glob("t*.patch"):
        old.unlink()
    bad = 0
    for s in order:
        t = REGISTRY[s]
        r = build(t, check=True, write_as=id_of[s])
        ok = r["base_fails"] and r["sol_passes"]
        bad += not ok
        (TASKS_DIR / f"{id_of[s]}.json").write_text(json.dumps(oracle_json(t, id_of[s], r, id_of), indent=2, ensure_ascii=False) + "\n")
        print(f"{id_of[s]} {s:26s} {'OK' if ok else 'BAD'} files={len(r['paths'])} mods={len(r['modules'])}")
    with open(os.path.join(HERE, "ids.json"), "w") as fh:
        json.dump({"seed": seed, "ids": id_of}, fh, indent=1)
    print("failures", bad)
    return 1 if bad else 0


if __name__ == "__main__":
    sys.exit(main())
