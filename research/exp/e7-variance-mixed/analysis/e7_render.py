#!/usr/bin/env python3
"""Splice the generated Part A tables into the report between marker comments.

The report holds <!-- A-TABLES:BEGIN --> ... <!-- A-TABLES:END -->; this script replaces what is between them with
the output of e7_stats.build_markdown (headings demoted two levels so they nest under the report's section 2).
Usage: python3 e7_render.py [--doc /path/to/report.md]
"""
from __future__ import annotations

import argparse
import os
import re
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
import e7_stats as st  # noqa: E402

DOC = "/Users/coop/Workspace/beanstalk/docs/claude-opus/exp/e7-variance-and-mixed-fleet.md"


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__.split("\n\n")[0])
    ap.add_argument("--doc", default=DOC)
    a = ap.parse_args()
    md, _ = st.build_markdown(st.SEEDS)
    md = re.sub(r"(?m)^(#{2,3}) ", lambda m: "#" * (len(m.group(1)) + 2) + " ", md)
    import subprocess
    ledger = subprocess.run([sys.executable, os.path.join(HERE, "e7_ledger.py")], capture_output=True, text=True,
                            check=True).stdout
    with open(a.doc, encoding="utf-8") as fh:
        doc = fh.read()
    for begin, end, text in (("<!-- A-TABLES:BEGIN -->", "<!-- A-TABLES:END -->", md),
                             ("<!-- LEDGER:BEGIN -->", "<!-- LEDGER:END -->", ledger)):
        i, j = doc.index(begin) + len(begin), doc.index(end)
        doc = doc[:i] + "\n\n" + text.rstrip() + "\n\n" + doc[j:]
    with open(a.doc, "w", encoding="utf-8") as fh:
        fh.write(doc)
    print(f"spliced {len(md.splitlines())} table lines and the ledger into {a.doc}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
