#!/usr/bin/env python3
"""Build and verify tasks in temp repos; writes nothing to the arena.

For each task: apply its edits to a copy of app/, check that the acceptance tests fail on base and
that base + solution passes the whole suite. With no arguments, checks every task.

    python3 author/check.py quebec-tax session-expiry
"""
import argparse, glob, importlib, os, sys

sys.dont_write_bytecode = True
HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
from lib import REGISTRY, build  # noqa: E402


def main(argv=None) -> int:
    ap = argparse.ArgumentParser(description=__doc__.split("\n\n")[0], epilog=__doc__.split("\n\n", 1)[1],
                                 formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("slugs", nargs="*", help="task slugs to check (default: all)")
    args = ap.parse_args(argv)
    for f in sorted(glob.glob(os.path.join(HERE, "tasks_*.py"))):
        importlib.import_module(os.path.basename(f)[:-3])
    unknown = [s for s in args.slugs if s not in REGISTRY]
    if unknown:
        ap.error(f"unknown task slug(s): {', '.join(unknown)}")
    bad = 0
    for slug in args.slugs or list(REGISTRY):
        r = build(REGISTRY[slug])
        ok = r["base_fails"] and r["sol_passes"]
        bad += not ok
        print(f"{'OK ' if ok else 'BAD'} {slug:28s} files={len(r['paths'])} mods={len(r['modules'])} "
              f"base_fail={r['base_fails']} sol_pass={r['sol_passes']} tests={r['sol_summary'].get('tests')}")
        if not r["sol_passes"]:
            out = r["sol_output"]
            i = out.find("failing tests:")
            print(out[i:i + 1800] if i >= 0 else out[-1800:])
        if not r["base_fails"]:
            print("   (acceptance tests PASS on base: summary", r["base_summary"], ")")
    print("failures:", bad)
    return 1 if bad else 0


if __name__ == "__main__":
    sys.exit(main())
