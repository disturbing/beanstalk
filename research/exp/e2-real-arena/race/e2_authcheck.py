#!/usr/bin/env python3
"""Claude authentication check for e2 races (the same idea as E3's authcheck.py, written for this folder).

  python3 e2_authcheck.py            a 1-turn Haiku call through the harness's Claude adapter (about $0.005):
                                     exit 0 = ok, 76 = authentication / 403 failure, 1 = any other failure
  python3 e2_authcheck.py RUN ...    scan finished runs: exit 76 if any invocation failed on authentication

Why: during an authentication outage ("403 Request not allowed", "please run /login") ``claude -p`` returns a result
with ``is_error`` set, not a crash, so the harness books it as an agent attempt that changed nothing and the race goes
on. A race that overlapped an outage is contaminated and its summary does not say so.
"""
from __future__ import annotations

import asyncio
import json
import os
import re
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
AUTH_FAILED = 76
AUTH = re.compile(r"\b(401|403)\b|not allowed|authenticat|unauthori[sz]ed|forbidden|/login|please run .?login|"
                  r"invalid api key|oauth|token (has )?expired|permission_error", re.I)


def contaminated(run: str) -> list[str]:
    bad = []
    with open(os.path.join(run, "events.jsonl"), encoding="utf-8") as fh:
        for line in fh:
            e = json.loads(line)
            if e.get("type") != "invocation.end":
                continue
            text = f"{e.get('infra_error') or ''} {e.get('result_text') or ''} {e.get('subtype') or ''}"
            if (e.get("is_error") or e.get("infra_error")) and AUTH.search(text):
                bad.append(f"{e.get('inv')} {e.get('task')}: {text.strip()[:160]}")
    return bad


async def probe() -> int:
    from harness.agents import ClaudeAdapter, InvocationSpec
    from harness.procs import ProcRegistry, Runner, Sandbox
    work = os.path.join(HERE, "runs", "_authcheck", "work")
    cwd = os.path.join(work, "cwd")
    os.makedirs(cwd, exist_ok=True)
    runner = Runner(Sandbox(work), ProcRegistry())
    ad = ClaudeAdapter(runner, model="haiku", max_turns=1, timeout=120, transcripts=os.path.join(work, "transcripts"),
                       output_format="json", persist_sessions=False)
    spec = InvocationSpec(inv_id="authcheck", kind="classifier", task_id=None, agent_id=None, cwd=cwd,
                          prompt="Reply with the single word OK.", no_tools=True, max_turns=1, timeout=120,
                          budget_cap_usd=0.05)
    res = await ad.run(spec)
    text = f"{res.infra_error or ''} {res.result_text or ''} {res.subtype or ''}"
    print(f"authcheck: ok={res.ok} is_error={res.is_error} subtype={res.subtype} cost=${res.cost_usd:.4f} "
          f"text={text.strip()[:160]!r}")
    import datetime as dt
    with open(os.path.join(HERE, "runs", "e2-probes.jsonl"), "a", encoding="utf-8") as fh:  # counted by e2_spent.py
        fh.write(json.dumps({"ts": dt.datetime.now().isoformat(timespec="seconds"), "kind": "authcheck",
                             "cost_usd": res.cost_usd, "ok": res.ok and not res.is_error}) + "\n")
    if (res.is_error or res.infra_error or not res.ok) and AUTH.search(text):
        return AUTH_FAILED
    return 0 if res.ok and not res.is_error and not res.infra_error else 1


def main() -> int:
    if len(sys.argv) > 1:
        code = 0
        for run in sys.argv[1:]:
            bad = contaminated(run)
            print(f"{run}: {len(bad)} invocation(s) failed on authentication" + ("".join(f"\n  {b}" for b in bad)))
            code = AUTH_FAILED if bad else code
        return code
    return asyncio.run(probe())


if __name__ == "__main__":
    sys.exit(main())
