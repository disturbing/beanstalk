"""Experiment E3: flaky tests for the emulated CI, and the per-test flake history.

The arena has no flaky tests; real suites do (about 2% of runs is common). This module makes the CI runner
flaky on demand and keeps the books a service would keep about it.

Injection model (documented choice: **per run**, not per test file)
    A run that would pass reports red with probability ``FLAKE_RATE``. The draw is a pure function of
    ``(seed, sha, purpose, attempt)``: re-running the same commit for the same purpose is attempt 1, 2, ...
    and gets an independent draw; re-running a whole race on the same commits reproduces every flake.
    Per run (rather than per test file) because the headline parameter is the share of CI runs that fail
    spuriously, and because the arena suite grows from 20 to about 60 test files during a race: a per-file
    rate would silently raise the per-run rate as tasks land, and would do so differently for each policy.
    (A per-file rate q is a per-run rate of 1 - (1 - q)^n, about n*q: 2% per run on 60 files is 0.03% per file.)

    The flake is a specific test failing, as in a real suite. The victim is drawn from a small, fixed pool
    of base-suite test cases (``FLAKE_POOL``, default 6; 0 = any test), so the same tests flake again and
    again. It fails the way a timing flake does in node:test (``test timed out after 5000ms``). Only a run
    that would otherwise pass is flipped: a real red stays red, and the final check never flakes.

Environment variables (all optional; nothing changes unless FLAKE_RATE > 0 or a mitigation is switched on)
    FLAKE_RATE            P(red | tree is green), per CI run (default 0)
    FLAKE_SEED            seed of the draws (default: the race --seed)
    FLAKE_POOL            number of distinct flaky base-suite tests (default 6; 0 = any test)
    FLAKE_PURPOSES        comma list of CI purposes that can flake (default: all except ``final`` and ``dry``)
    FLAKE_LIMIT           stop injecting after this many flakes (0 = no limit; for unit tests)
    FLAKE_TIMEOUT_MS      the timeout quoted in the failure message (default 5000)
    FLAKE_RERUN_PRELAND   v2 mitigation (i): re-run a red pre-land check once before the bean goes back
    FLAKE_RERUN_VALIDATE  v2 mitigation (ii): re-run a red sprout validation; revert only if red twice
    FLAKE_RETRY_BATCH     queue: re-run a red batch once before bisecting it
    FLAKE_CONFIRM_SAME    with a re-run mitigation: a red is confirmed only if a test fails in both runs; two clearly different
                          failures in a row are two flakes, so the check runs a third time (default off; not part of
                          FLAKE_MITIGATE, which stays "re-run once")
    FLAKE_RERUN_SECONDS   emulated latency of a re-run (default: as long as the first run); a few seconds stands for
                          re-running only the failing tests on a warm runner instead of the whole pipeline
    FLAKE_MITIGATE        shorthand: sets the three switches above unless they are set explicitly
    FLAKE_QUARANTINE      flips needed before a test is quarantined (its failures stop gating; 0 = off)

Ground truth. Every CI result says whether it was really green (``true_green``), whether a flake turned it
red (``flaked``) and which test it named (``flake_test``). The policies never read these; the events and the
summary use them to count wrongful reverts, needless reworks and absorbed flakes.

Flake history. ``FlakeBook`` records, per git tree, which tests passed and which failed. A test that both
passes and fails on the same tree is flaky ("flipped"). Re-running a red check on the same tree is what
produces the evidence, so the mitigations feed the history for free.
"""
from __future__ import annotations

import hashlib
import os
from dataclasses import dataclass

EXEMPT_PURPOSES = ("final", "dry")  # the final check and the dry run measure the system, never the CI noise
TRUE = ("1", "true", "yes", "on")


def _u(*parts) -> float:
    """A uniform number in [0, 1) from a hash of ``parts``: deterministic and independent of the platform."""
    digest = hashlib.sha256("|".join(str(p) for p in parts).encode("utf-8")).digest()
    return int.from_bytes(digest[:8], "big") / 2 ** 64


def test_id(file: str, name: str) -> str:
    return f"{file} > {name}"


def failing_ids(res) -> list[str]:
    """The failing tests of a CI result as ``file > name`` ids."""
    return [test_id(t["file"], t["name"]) for t in res.failing_tests]


def agree(first: list[str], second: list[str]) -> bool:
    """Do two red runs of one tree fail at least one common test? Unknown (a crash, nothing parsed) counts as agreement, so
    only two clearly different failures read as what they probably are: two flakes."""
    a, b = set(first or ()), set(second or ())
    return not a or not b or bool(a & b)


def _flag(env: dict, key: str, default: bool) -> bool:
    raw = env.get(key)
    return default if raw is None or raw == "" else raw.strip().lower() in TRUE


@dataclass(frozen=True)
class FlakeConfig:
    rate: float = 0.0
    seed: int = 0
    pool: int = 6
    purposes: tuple = ()
    limit: int = 0
    timeout_ms: int = 5000
    rerun_preland: bool = False
    rerun_validate: bool = False
    retry_batch: bool = False
    quarantine_flips: int = 0
    rerun_seconds: float | None = None
    confirm_same: bool = False

    @classmethod
    def from_env(cls, env: dict | None = None, default_seed: int = 0) -> "FlakeConfig":
        env = os.environ if env is None else env
        try:
            rate = float(env.get("FLAKE_RATE") or 0.0)
            seed = int(env.get("FLAKE_SEED") or default_seed)
            pool = int(env.get("FLAKE_POOL") or 6)
            limit = int(env.get("FLAKE_LIMIT") or 0)
            timeout_ms = int(env.get("FLAKE_TIMEOUT_MS") or 5000)
            quarantine = int(env.get("FLAKE_QUARANTINE") or 0)
            rerun_seconds = float(env["FLAKE_RERUN_SECONDS"]) if env.get("FLAKE_RERUN_SECONDS") else None
        except ValueError as e:
            raise SystemExit(f"bad FLAKE_* environment variable: {e}")
        if not 0.0 <= rate <= 1.0:
            raise SystemExit(f"FLAKE_RATE must be between 0 and 1, got {rate}")
        purposes = tuple(p.strip() for p in (env.get("FLAKE_PURPOSES") or "").split(",") if p.strip())
        mitigate = _flag(env, "FLAKE_MITIGATE", False)
        return cls(rate=rate, seed=seed, pool=max(0, pool), purposes=purposes, limit=max(0, limit),
                   timeout_ms=max(1, timeout_ms),
                   rerun_preland=_flag(env, "FLAKE_RERUN_PRELAND", mitigate),
                   rerun_validate=_flag(env, "FLAKE_RERUN_VALIDATE", mitigate),
                   retry_batch=_flag(env, "FLAKE_RETRY_BATCH", mitigate),
                   quarantine_flips=max(0, quarantine),
                   rerun_seconds=None if rerun_seconds is None else max(0.0, rerun_seconds),
                   confirm_same=_flag(env, "FLAKE_CONFIRM_SAME", False))

    def public(self) -> dict:
        return {"rate": self.rate, "seed": self.seed, "model": "per run", "pool": self.pool,
                "purposes": list(self.purposes) or "all but final", "limit": self.limit,
                "timeout_ms": self.timeout_ms, "rerun_preland": self.rerun_preland,
                "rerun_validate": self.rerun_validate, "retry_batch": self.retry_batch,
                "quarantine_flips": self.quarantine_flips, "rerun_seconds": self.rerun_seconds,
                "confirm_same": self.confirm_same}


class FlakeBook:
    """Per-test flake history: a test that both passes and fails on the same tree is marked flaky."""

    def __init__(self, quarantine_flips: int = 0):
        self.quarantine_flips = quarantine_flips
        self.passed: dict[str, set[str]] = {}      # tree -> tests seen passing
        self.failed: dict[str, set[str]] = {}      # tree -> tests seen failing
        self.flipped: dict[str, set[str]] = {}     # tree -> tests already counted as flipping on it
        self.flaky: dict[str, dict] = {}           # test -> {"flips", "first_ci", "last_ci", "trees"}
        self.runs = 0

    def record(self, tree: str, run_id: str, passed, failed) -> list[str]:
        """Add one run's outcomes on ``tree``; return the tests that this run showed to be flaky (new flips)."""
        self.runs += 1
        passed, failed = set(passed), set(failed)
        was_p, was_f = self.passed.setdefault(tree, set()), self.failed.setdefault(tree, set())
        done = self.flipped.setdefault(tree, set())
        new = sorted(((failed & was_p) | (passed & was_f)) - done)
        was_p |= passed
        was_f |= failed
        for t in new:
            done.add(t)
            rec = self.flaky.setdefault(t, {"flips": 0, "first_ci": run_id, "last_ci": run_id, "trees": []})
            rec["flips"] += 1
            rec["last_ci"] = run_id
            rec["trees"].append(tree[:10])
        return new

    def is_flaky(self, test: str) -> bool:
        return test in self.flaky

    def is_quarantined(self, test: str) -> bool:
        return self.quarantine_flips > 0 and self.flaky.get(test, {}).get("flips", 0) >= self.quarantine_flips

    def summary(self) -> dict:
        return {"runs_recorded": self.runs, "trees": len(self.passed),
                "tests": {t: r["flips"] for t, r in sorted(self.flaky.items())}}


def locate_test(wt: str, file: str, name: str) -> tuple[int, int]:
    """Line and column of the test named ``name`` in ``file`` (node reports ``test at file:line:col``)."""
    try:
        with open(os.path.join(wt, file), encoding="utf-8", errors="replace") as fh:
            lines = fh.read().splitlines()
    except OSError:
        return 1, 1
    for i, text in enumerate(lines, 1):
        if name in text:
            return i, len(text) - len(text.lstrip()) + 1
    return 1, 1


class Flaker:
    """Decides which runs flake, names the failing test, and holds the flake history."""

    def __init__(self, cfg: FlakeConfig, book: FlakeBook | None = None):
        self.cfg = cfg
        self.book = book or FlakeBook(cfg.quarantine_flips)
        self.attempts: dict[tuple[str, str], int] = {}
        self.base_tests: set[str] = set()
        self.pool: list[tuple[str, str]] | None = None
        self.injected = 0

    @classmethod
    def from_env(cls, default_seed: int = 0, env: dict | None = None) -> "Flaker":
        return cls(FlakeConfig.from_env(env, default_seed))

    @property
    def active(self) -> bool:
        return self.cfg.rate > 0

    def bind_base(self, files) -> None:
        """Remember the base suite's test files: the flaky tests are drawn from them (once)."""
        from .arena import classify
        if not self.base_tests:
            self.base_tests = {f for f in files if classify(f) == "test"}

    # ---- the draw ----------------------------------------------------------------------------------

    def next_attempt(self, sha: str, purpose: str) -> int:
        """0 for the first run of ``sha`` for ``purpose``, 1 for the next, ..."""
        n = self.attempts.get((sha, purpose), 0)
        self.attempts[(sha, purpose)] = n + 1
        return n

    def draw(self, sha: str, purpose: str, attempt: int) -> float:
        return _u(self.cfg.seed, "flake", sha, purpose, attempt)

    def fires(self, sha: str, purpose: str, attempt: int) -> bool:
        """Pure: does this run flake, were it green? Deterministic per (seed, sha, purpose, attempt)."""
        if purpose in EXEMPT_PURPOSES or self.cfg.rate <= 0:
            return False
        if self.cfg.purposes and purpose not in self.cfg.purposes:
            return False
        return self.draw(sha, purpose, attempt) < self.cfg.rate

    def should_flake(self, sha: str, purpose: str, attempt: int) -> bool:
        return self.fires(sha, purpose, attempt) and not (self.cfg.limit and self.injected >= self.cfg.limit)

    def pick_victim(self, sha: str, purpose: str, attempt: int, cases) -> tuple[str, str] | None:
        """The test that fails: one of the pool's tests that this run passed (``cases`` = passing (file, name))."""
        cases = sorted(set(cases))
        if not cases:
            return None
        if self.cfg.pool > 0 and self.pool is None:
            universe = [c for c in cases if c[0] in self.base_tests] or cases
            self.pool = sorted(universe, key=lambda c: _u(self.cfg.seed, "pool", c[0], c[1]))[: self.cfg.pool]
        candidates = cases
        if self.cfg.pool > 0 and self.pool:
            present = set(cases)
            candidates = sorted(c for c in self.pool if c in present) or cases
        return candidates[int(_u(self.cfg.seed, "victim", sha, purpose, attempt) * len(candidates)) % len(candidates)]

    def inject(self, res, wt: str, victim: tuple[str, str]) -> None:
        """Turn a green result into the red a flaky ``victim`` test would have produced."""
        file, name = victim
        line, col = locate_test(wt, file, name)
        ms = self.cfg.timeout_ms
        message = f"test timed out after {ms}ms"
        took = ms + 1.0 + 9.0 * _u(self.cfg.seed, "took", res.sha, res.purpose, res.attempt)
        body = (f"Error [ERR_TEST_FAILURE]: {message}\n    at async Promise.all (index 0) {{\n"
                f"  code: 'ERR_TEST_FAILURE',\n  failureType: 'testTimeoutFailure',\n  cause: '{message}'\n}}\n")
        res.failing_tests = [{"file": file, "name": name, "message": message, "body": body}]
        res.failing_files = [file]
        res.failures = 1
        res.green = False
        res.output = f"failing tests:\n\ntest at {file}:{line}:{col}\n✖ {name} ({took:.6f}ms)\n  '{message}'\n"
        res.flaked = True
        res.flake_test = test_id(file, name)
        self.injected += 1

    # ---- quarantine --------------------------------------------------------------------------------

    def apply_quarantine(self, res) -> list[str]:
        """Drop failures of quarantined tests from a red result; green if nothing else failed."""
        if self.book.quarantine_flips <= 0 or res.green or not res.failing_tests or res.failing_files is None:
            return []
        quarantined = [t for t in res.failing_tests if self.book.is_quarantined(test_id(t["file"], t["name"]))]
        if not quarantined:
            return []
        kept = [t for t in res.failing_tests if t not in quarantined]
        res.quarantined = [test_id(t["file"], t["name"]) for t in quarantined]
        res.quarantined_real = [test_id(t["file"], t["name"]) for t in quarantined
                                if not (res.flaked and test_id(t["file"], t["name"]) == res.flake_test)]
        res.failing_tests = kept
        res.failing_files = sorted({t["file"] for t in kept if t["file"]})
        res.failures = len(kept)
        if not kept and not res.timed_out:
            res.green = True
            res.output = ""
        return res.quarantined


# ---- metrics from events (the summary and flake_report.py read the same numbers) ---------------------------

def metrics(events: list[dict]) -> dict:
    """Flake counts and costs from a race's events. Ground truth comes from the injector's own fields."""
    runs = [e for e in events if e["type"] == "preland.check" or (e["type"] == "ci.end" and e.get("green") is not None
                                                                   and e.get("purpose") != "final")]
    by_purpose: dict[str, int] = {}
    flaked_by: dict[str, int] = {}
    for e in runs:
        p = "preland" if e["type"] == "preland.check" else e.get("purpose", "?")
        by_purpose[p] = by_purpose.get(p, 0) + 1
        if e.get("flaked"):
            flaked_by[p] = flaked_by.get(p, 0) + 1
    cost_of = {e["inv"]: e.get("cost_usd") or 0.0 for e in events if e["type"] == "invocation.end"}
    tools_of = {e["inv"]: e.get("tool_uses") or {} for e in events if e["type"] == "invocation.end"}
    needless = [e for e in events if e["type"] == "rework.start" and e.get("needless")]
    needless_inv = [e["inv"] for e in needless if e.get("inv")]
    reruns: dict[str, dict] = {}
    for e in events:
        if e["type"] == "flake.rerun":
            r = reruns.setdefault(e["purpose"], {"count": 0, "absorbed": 0, "confirmed": 0, "on_flake": 0, "on_real": 0,
                                                 "inconsistent": 0})
            r["count"] += 1
            r[e["outcome"]] = r.get(e["outcome"], 0) + 1
            r["inconsistent"] += 1 if e.get("inconsistent") else 0   # two different failures in a row: a third run decided
            r["on_flake" if e.get("first_flaked") else "on_real"] += 1   # was the red that triggered it a flake or a real red?
    rerun_seconds = sum(e.get("check_seconds") or 0.0 for e in events if e["type"] == "preland.check" and e.get("rerun"))
    rerun_seconds += sum(e.get("ci_seconds") or 0.0 for e in events if e["type"] == "ci.end" and e.get("rerun"))
    reverts = [e for e in events if e["type"] == "revert"]
    wrongful = [e for e in reverts if e.get("flake_only")]
    ejects = [e for e in events if e["type"] == "queue.eject" and e.get("reason") == "red"]
    # A red validation that a later green validation of a descendant exonerates never reaches a revert: the ticket is
    # closed ("green at trunk #n") before the culprit search ends. Count what became of the tickets that flakes opened.
    flaked_val = {e["sha"] for e in events if e["type"] == "ci.end" and e.get("purpose") == "validate" and e.get("flaked")
                  and e.get("sha")}
    flake_tickets = [e["ticket"] for e in events if e["type"] == "ticket.open" and e.get("red_sha") in flaked_val]
    closed_by = {e["ticket"]: e.get("how", "") for e in events if e["type"] == "ticket.close"}
    reverted_tickets = {e.get("ticket") for e in events if e["type"] == "revert"}
    flips: dict[str, int] = {}
    for e in events:
        if e["type"] == "flake.flip":
            flips[e["test"]] = e.get("flips", flips.get(e["test"], 0) + 1)
    # needless reworks in which the agent edited or wrote a file (a commit alone proves nothing: the trunk merge is committed too)
    edited = sum(1 for e in needless if (tools_of.get(e.get("inv"), {}).get("Edit", 0)
                                         + tools_of.get(e.get("inv"), {}).get("Write", 0)) > 0)
    return {
        "ci_runs": by_purpose, "ci_runs_total": sum(by_purpose.values()),
        "flaked_runs": sum(flaked_by.values()), "flaked_runs_by_purpose": flaked_by,
        "reruns": reruns, "rerun_minutes": round(rerun_seconds / 60, 2),
        "needless_reworks": len(needless), "needless_rework_cost_usd": round(sum(cost_of.get(i, 0.0) for i in needless_inv), 4),
        "needless_reworks_that_edited_files": edited,
        "reverts": len(reverts), "wrongful_reverts": len(wrongful),
        "wrongful_revert_tasks": [e.get("task") for e in wrongful],
        "reverts_after_flaky_probes": sum(1 for e in reverts if e.get("probe_flakes")),
        "flaked_validations": len(flaked_val),
        "flake_tickets": len(flake_tickets),
        "flake_tickets_exonerated": sum(1 for t in flake_tickets if closed_by.get(t, "").startswith("green at trunk")),
        "flake_tickets_reverted": sum(1 for t in flake_tickets if t in reverted_tickets),
        "queue_red_ejections": len(ejects), "queue_needless_ejections": sum(1 for e in ejects if e.get("flake_only")),
        "flaky_tests": flips,
    }
