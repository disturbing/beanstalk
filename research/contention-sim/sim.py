#!/usr/bin/env python3
"""Discrete-event simulator for the Beanstalk contention study (research step 3).

Compares integration policies for many concurrent coding agents. Every policy shares one
backlog, one pool of identical agents, one CI pool of R runner slots and one interaction
model (textual conflicts, semantic breaks, self-failures, flakes). Only changes that reach
a VALIDATED GREEN branch count as throughput.

Policies
  serial             merge queue, batch size 1, one test at a time
  batched            bors/Mergify-style batches of k with bisection, speculative train over R runners
  batched-aimd       the same with an AIMD-adaptive batch size
  batched-par        batched with affected-target independence (Uber/Aviator style): batches that
                     share no module test and land in parallel instead of in one linear train
  batched+place      batched plus footprint placement of task starts
  beanstalk          placement + non-blocking fast trunk + async validation + causal repair
  beanstalk-noplace  fast trunk without placement

Every latent outcome (does pair (a, b) conflict? does change a fail on its own?) is a hash of
(seed, task ids), so all policies face the identical world for a given seed (common random
numbers). Standard library only; deterministic given --seed. See README.md for the model.
"""
from __future__ import annotations

import argparse
import bisect
import copy
import heapq
import json
import math
import os
import random
import sys
from collections import deque

HERE = os.path.dirname(os.path.abspath(__file__))

# --------------------------------------------------------------------------------------
# Defaults. A params file overrides these; --set key=value overrides the params file.
# Times are minutes unless the key says otherwise.
# --------------------------------------------------------------------------------------
DEFAULTS: dict = {
    # scale
    "agents": 20,                  # N
    "tasks_per_agent": 10,         # M = tasks_per_agent * N unless "tasks" is set
    "tasks": None,
    "ci_slots": None,              # R; None -> max(ci_slots_min, round(ci_slots_per_agent * N))
    "ci_slots_per_agent": 0.1,
    "ci_slots_min": 2,
    # CI
    "test_minutes": 10.0,          # T
    "test_jitter_sigma": 0.1,      # lognormal jitter on T
    "flake_rate": 0.02,            # f: a run reports red although the tree is fine
    # agents
    "work_median_min": 20.0,       # D
    "work_sigma": 0.7,             # s (lognormal)
    "r_conf": 0.3,                 # rework after a textual conflict, x original work time
    "r_fix": 0.4,                  # fix after a red, x original work time
    "p_self": 0.15,                # a change version fails CI on its own
    "fixer_pool": 0,               # 0 = fixers come from the same N agents
    # interaction model
    "conflict_model": "per_file",  # per_file | class
    "p_per_file": 0.06,            # per shared non-dissolvable file (per_file model)
    "p_per_file_diss": 0.3,        # per shared dissolvable file (lockfile, changelog, ...)
    "p_file": 0.11,                # class model: P(conflict | >= 1 shared file)
    "p_module": 0.002,             # P(conflict | shared module, no shared file)
    "p_disjoint": 0.0,             # P(conflict | no shared module)
    "dissolvable_share": 0.15,     # class model: share of file conflicts merge drivers remove
    "merge_drivers": True,         # commutative merge drivers on (both policies)
    "q_sem": 0.01,                 # clean merge, shared non-commutative module -> tests fail
    "dependency_rate": 0.05,       # share of tasks that need an earlier task in their base
    "dep_window": 20,
    # placement signal
    "placement_model": "pair",     # pair: a held task flags a candidate with the measured pair-level
                                   #   operating point (flag_recall if the pair would conflict, else
                                   #   flag_clean); module: predicted module sets must not intersect
    "flag_recall": 0.60,           # share of conflicting pairs flagged (step 2 'conflict recall')
    "flag_clean": 0.25,            # share of clean pairs flagged (step 2 'clean flag rate')
    # module-level placement only
    "prediction_model": "perturb", # perturb: actual modules perturbed by recall/precision |
                                   # empirical: step 2's real predicted sets (calibrated params only)
    "recall": 0.8,                 # rho
    "precision": 0.6,              # pi
    # mechanical merge step: queue candidate build and Beanstalk committer round (c)
    "commit_round_s": 10.0,
    "commit_per_change_s": 1.0,
    # queues
    "batch_k": 4,
    "spec_depth": 20,              # max units in the speculative train (capped by R)
    "aimd_k_start": 4,
    "aimd_k_min": 1,
    "aimd_k_max": 32,
    "queue_agents": "bound",       # bound: author waits for its PR to land | released
    "requeue": "front",            # an ejected PR keeps its queue position (front) or goes to the back
    "queue_suspects": False,       # queue reads failing tests to eject culprits instead of bisecting
    "queue_partition": "none",     # none: one linear train | modules: module-disjoint units are independent
    "build_scan": 32,              # queue entries examined per candidate build (>= 4k)
    # beanstalk
    "snapshot": "head",            # tasks fork from the fast-trunk head | the green commit
    "green_mode": "prefix",        # prefix: green = a fully passing fast-trunk commit (the spec)
                                   # quarantine: green = head minus known culprits and dependents
    "a_suspect": 0.7,              # read/write-set suspects contain the true culprit
    "budget": True,                # error-budget controller
    "budget_open_reds": 3,         # B
    "budget_max_age_min": 30.0,    # A
    # placement
    "placement_fallback": "least-overlap",   # wait | least-overlap
    "place_window": 128,           # backlog entries the scheduler considers per decision
    "place_cap": 1,                # placeable if every predicted module has < cap holders
                                   # (1 = no overlap, the spec; larger = bounded sharing, an extension)
    # footprints
    "footprint": {
        "model": "parametric",
        "gen_seed": 7,
        "n_changes": 5000,
        "n_modules": 120,
        "module_zipf": 1.2,
        "module_size_median": 30,
        "module_size_sigma": 1.3,
        "mods_per_change_mean": 2.5,
        "files_per_module_mean": 4.5,
        "diss_file_share": 0.1,
        "zipf_s": 1.0,
        "block_len": 20,
    },
    # run control: a run stops early (complete = false) past either cap; metrics then cover the
    # simulated horizon. Deterministic (event count, not wall clock).
    "max_hours": 100000.0,
    "max_events": 4000000,
    "stall_hours": 500.0,          # stop when green has not advanced for this long (livelock)
}

POLICIES: dict = {
    "serial":            {"kind": "queue", "place": False, "aimd": False, "fixed": {"batch_k": 1, "spec_depth": 1}},
    "batched":           {"kind": "queue", "place": False, "aimd": False, "fixed": {}},
    "batched-aimd":      {"kind": "queue", "place": False, "aimd": True,  "fixed": {}},
    "batched-par":       {"kind": "queue", "place": False, "aimd": False, "fixed": {"queue_partition": "modules"}},
    "batched+place":     {"kind": "queue", "place": True,  "aimd": False, "fixed": {}},
    "beanstalk":         {"kind": "bean",  "place": True,  "aimd": False, "fixed": {}},
    "beanstalk-noplace": {"kind": "bean",  "place": False, "aimd": False, "fixed": {}},
}

BUSY, REWORK, BLOCKED, IDLE = 0, 1, 2, 3
FILE_BASE = 1 << 20          # file id = module * FILE_BASE + popularity rank

# --------------------------------------------------------------------------------------
# Hash-based latent randomness (common random numbers across policies)
# --------------------------------------------------------------------------------------
M64 = (1 << 64) - 1
INV64 = 1.0 / 18446744073709551616.0


def mix64(z: int) -> int:
    z &= M64
    z = ((z ^ (z >> 30)) * 0xBF58476D1CE4E5B9) & M64
    z = ((z ^ (z >> 27)) * 0x94D049BB133111EB) & M64
    return z ^ (z >> 31)


def make_key(seed: int, tag: str) -> int:
    h = 0x12345
    for ch in tag.encode():
        h = mix64(h * 131 + ch)
    return mix64(h ^ mix64(seed * 0x9E3779B97F4A7C15 + 0x7F4A7C15))


def uni(key: int, a: int, b: int = 0) -> float:
    """Uniform [0, 1) that depends only on (key, a, b)."""
    z = (key ^ ((a * 0xD6E8FEB86659FD93 + b * 0xC2B2AE3D27D4EB4F + 0x165667B19E3779F9) & M64))
    z = ((z ^ (z >> 30)) * 0xBF58476D1CE4E5B9) & M64
    z = ((z ^ (z >> 27)) * 0x94D049BB133111EB) & M64
    return (z ^ (z >> 31)) * INV64


# --------------------------------------------------------------------------------------
# Params
# --------------------------------------------------------------------------------------
def deep_merge(base: dict, over: dict) -> dict:
    out = copy.deepcopy(base)
    for k, v in (over or {}).items():
        if isinstance(v, dict) and isinstance(out.get(k), dict):
            out[k] = deep_merge(out[k], v)
        else:
            out[k] = copy.deepcopy(v)
    return out


def load_params(path: str | None) -> dict:
    """DEFAULTS merged with a params file ('none' = built-in defaults only)."""
    if not path or path == "none":
        return copy.deepcopy(DEFAULTS)
    with open(path) as fh:
        data = json.load(fh)
    return deep_merge(DEFAULTS, data)


def parse_value(text: str):
    try:
        return json.loads(text)
    except json.JSONDecodeError:
        return text


def apply_sets(params: dict, sets: list[str] | None) -> dict:
    """--set key=value (value parsed as JSON when possible; dotted keys reach into dicts)."""
    p = copy.deepcopy(params)
    for s in sets or []:
        key, _, val = s.partition("=")
        target = p
        parts = key.split(".")
        for part in parts[:-1]:
            target = target.setdefault(part, {})
        target[parts[-1]] = parse_value(val)
    return p


def ci_slots_for(params: dict, n_agents: int) -> int:
    if params.get("ci_slots"):
        return int(params["ci_slots"])
    return max(int(params["ci_slots_min"]), int(round(params["ci_slots_per_agent"] * n_agents)))


# --------------------------------------------------------------------------------------
# Footprints
# --------------------------------------------------------------------------------------
def _geometric(rng: random.Random, mean: float) -> int:
    """Number of failures before a success, with the given mean (support 0, 1, 2, ...)."""
    if mean <= 0:
        return 0
    p = 1.0 / (1.0 + mean)
    return int(math.log(1.0 - rng.random()) / math.log(1.0 - p))


_PARAMETRIC_CACHE: dict = {}


def parametric_footprints(fp: dict) -> tuple[list[dict], list[list[tuple[int, int]]]]:
    """A synthetic repo: Zipf-popular modules (popular ones are bigger) and a change list.

    The change list plays the role of the empirical corpus; it is fixed by gen_seed, so the
    'repo' does not change with the simulation seed (cached per process).
    """
    key = json.dumps({k: v for k, v in fp.items() if k not in ("zipf_s", "block_len", "diss_file_share")},
                     sort_keys=True)
    if key not in _PARAMETRIC_CACHE:
        _PARAMETRIC_CACHE[key] = _parametric_footprints(fp)
    modules, changes = _PARAMETRIC_CACHE[key]
    return copy.deepcopy(modules), [list(c) for c in changes]


def _parametric_footprints(fp: dict):
    rng = random.Random(f"parametric-{fp.get('gen_seed', 7)}")
    n_mod = int(fp.get("n_modules", 120))
    a = float(fp.get("module_zipf", 1.15))
    weights = [1.0 / (r + 1) ** a for r in range(n_mod)]
    sizes = sorted((max(1, int(round(fp.get("module_size_median", 30) *
                                      math.exp(fp.get("module_size_sigma", 1.3) * rng.gauss(0, 1)))))
                    for _ in range(n_mod)), reverse=True)
    modules = [{"name": f"M{r + 1}", "size": sizes[r], "commutative": False} for r in range(n_mod)]
    cum = []
    acc = 0.0
    for w in weights:
        acc += w
        cum.append(acc)
    changes = []
    for _ in range(int(fp.get("n_changes", 5000))):
        n_m = min(n_mod, 1 + _geometric(rng, fp.get("mods_per_change_mean", 2.5) - 1.0))
        chosen: list[int] = []
        while len(chosen) < n_m:
            m = bisect.bisect_left(cum, rng.random() * acc)
            if m not in chosen:
                chosen.append(m)
        entry = []
        for m in chosen:
            nf = 1 + _geometric(rng, fp.get("files_per_module_mean", 4.0) - 1.0)
            entry.append((m, min(nf, sizes[m])))
        changes.append(entry)
    return modules, changes


class FootprintModel:
    """Module sets and per-module file counts bootstrapped from a change list; files drawn
    from a per-module Zipf popularity distribution, so file overlap (and overlap class) can
    be derived for any pair."""

    def __init__(self, fp: dict):
        self.fp = fp
        if fp.get("model", "parametric") == "empirical":
            modules = fp["modules"]
            changes = [[(int(m), int(n)) for m, n in ch] for ch in fp["changes"] if ch]
        else:
            modules, changes = parametric_footprints(fp)
        if not changes:
            raise ValueError("footprint model has no changes")
        self.n_mod = len(modules)
        self.names = [m.get("name", f"M{i + 1}") for i, m in enumerate(modules)]
        self.size = [max(1, int(m.get("size", 1))) for m in modules]
        self.comm = [bool(m.get("commutative", False)) for m in modules]
        self.diss_ranks = [frozenset(int(r) for r in m.get("diss_ranks", [])) for m in modules]
        cleaned = []
        for ch in changes:
            e = [(m, max(1, min(n, self.size[m]))) for m, n in ch if 0 <= m < self.n_mod]
            if e:
                cleaned.append(e)
        self.changes = cleaned
        # step 2's real predicted module sets, aligned with the change list (None where absent)
        predicted = fp.get("predicted")
        self.predicted = None
        if predicted and fp.get("model") == "empirical" and len(predicted) == len(changes):
            keep = [i for i, ch in enumerate(changes) if any(0 <= m < self.n_mod for m, _ in ch)]
            self.predicted = [predicted[i] for i in keep]
        self.pred_idx = [i for i, p in enumerate(self.predicted or []) if p is not None]
        cnt = [0] * self.n_mod
        for ch in self.changes:
            for m, _ in ch:
                cnt[m] += 1
        self.pop = [c / len(self.changes) for c in cnt]
        self.zipf_s = float(fp.get("zipf_s", 1.0))
        self.block_len = max(1, int(fp.get("block_len", 20)))
        self.diss_file_share = float(fp.get("diss_file_share", 0.0))
        self.diss_key = make_key(int(fp.get("gen_seed", 7)), "diss-file")
        self._cum: list = [None] * self.n_mod
        # popularity table over non-commutative modules, for false-positive predictions
        self.nc_mods = [m for m in range(self.n_mod) if not self.comm[m] and self.pop[m] > 0]
        acc = 0.0
        self.nc_cum = []
        for m in self.nc_mods:
            acc += self.pop[m]
            self.nc_cum.append(acc)

    def zipf_cum(self, m: int) -> list[float]:
        c = self._cum[m]
        if c is None:
            s = self.zipf_s
            c = []
            acc = 0.0
            for r in range(self.size[m]):
                acc += 1.0 / (r + 1) ** s
                c.append(acc)
            self._cum[m] = c
        return c

    def is_diss(self, m: int, rank: int) -> bool:
        if self.comm[m] or rank in self.diss_ranks[m]:
            return True
        return self.diss_file_share > 0 and uni(self.diss_key, m, rank) < self.diss_file_share

    def draw_files(self, rng: random.Random, m: int, n: int) -> list[int]:
        size = self.size[m]
        if n >= size:
            return list(range(size))
        cum = self.zipf_cum(m)
        total = cum[-1]
        got: set[int] = set()
        tries = 0
        while len(got) < n and tries < 60 * n:
            got.add(bisect.bisect_left(cum, rng.random() * total))
            tries += 1
        r = 0
        while len(got) < n:      # pathological exponent: fill with the most popular unused ranks
            got.add(r)
            r += 1
        return sorted(got)

    def sample_entries(self, rng: random.Random, n: int, predicted_only: bool = False) -> list[int]:
        """Block bootstrap of change-list indices: contiguous runs keep real co-activity
        correlation. predicted_only draws from the changes step 2 predicted (its evaluation slice)."""
        pool = self.pred_idx if predicted_only and self.pred_idx else range(len(self.changes))
        L = len(pool)
        out: list[int] = []
        while len(out) < n:
            start = rng.randrange(L)
            for j in range(self.block_len):
                out.append(pool[(start + j) % L])
                if len(out) >= n:
                    break
        return out

    def draw_fp(self, rng: random.Random, entry) -> tuple[frozenset, frozenset]:
        nd = []
        dd = []
        for m, n in entry:
            for r in self.draw_files(rng, m, n):
                fid = m * FILE_BASE + r
                (dd if self.is_diss(m, r) else nd).append(fid)
        return frozenset(nd), frozenset(dd)


# --------------------------------------------------------------------------------------
# Entities
# --------------------------------------------------------------------------------------
class Task:
    __slots__ = ("idx", "mods", "mods_nc", "mods_x", "files_n", "files_d", "pred", "work", "dep",
                 "dependents", "ready", "fixno", "base", "prio", "done_t", "green_t", "start_t",
                 "agent", "hold", "latest_pos", "landed", "attempt", "blocker",
                 "ev_base", "ev_upto", "ev_conf", "ev_sem")

    def __init__(self, idx: int):
        self.idx = idx
        self.dependents: list[int] = []
        self.ready = False
        self.fixno = 0
        self.base = 0
        self.prio = None
        self.done_t = None
        self.green_t = None
        self.start_t = None
        self.agent = None
        self.hold = None
        self.latest_pos = None
        self.landed = 0
        self.attempt = 0
        self.blocker = 0            # in-flight queue unit this PR textually conflicts with
        self.ev_base = -1
        self.ev_upto = 0
        self.ev_conf = False
        self.ev_sem = False


class Agent:
    __slots__ = ("id", "state", "since", "acc", "fixer", "idle_reason")

    def __init__(self, i: int, fixer: bool = False):
        self.id = i
        self.state = IDLE
        self.since = 0.0
        self.acc = [0.0, 0.0, 0.0, 0.0]
        self.fixer = fixer
        self.idle_reason = "start"


class Run:
    __slots__ = ("alive", "start", "dur")


class CI:
    """R runner slots. Aborted runs free their slot and count the minutes used so far."""

    def __init__(self, sim: "Sim", slots: int):
        self.sim = sim
        self.R = slots
        self.busy = 0
        self.max_busy = 0
        self.minutes = 0.0
        self.runs = 0
        self.aborted = 0

    def free(self) -> int:
        return self.R - self.busy

    def start(self, dur: float, cb, *args) -> Run:
        if self.busy >= self.R:
            raise RuntimeError("CI over capacity")
        run = Run()
        run.alive = True
        run.start = self.sim.now
        run.dur = dur
        self.busy += 1
        if self.busy > self.max_busy:
            self.max_busy = self.busy
        self.runs += 1
        self.sim.at(dur, cb, run, *args)
        return run

    def finish(self, run: Run) -> None:
        run.alive = False
        self.busy -= 1
        self.minutes += run.dur

    def abort(self, run: Run) -> None:
        if run.alive:
            run.alive = False
            self.busy -= 1
            self.minutes += self.sim.now - run.start
            self.aborted += 1


class Trunk:
    """A linear branch (main for queues, the fast trunk for Beanstalk). Position 0 is the base."""

    def __init__(self, n_mod: int):
        self.ctask: list = [None]
        self.cbase: list[int] = [0]
        self.ctime: list[float] = [0.0]
        self.by_mod: list[list[int]] = [[] for _ in range(n_mod)]

    def __len__(self) -> int:
        return len(self.ctask) - 1

    def append(self, t: Task, now: float) -> int:
        pos = len(self.ctask)
        self.ctask.append(t)
        self.cbase.append(t.base)
        self.ctime.append(now)
        for m in t.mods_x:
            self.by_mod[m].append(pos)
        return pos


class Unit:
    """A merge-queue test unit: a batch (or bisection half) tested on main plus every in-flight
    unit it depends on. A linear train makes each unit depend on all units ahead of it; the
    partitioned queue only on earlier units that share a module (transitively)."""
    __slots__ = ("uid", "members", "flags", "kind", "run", "result", "deps", "mods")

    def __init__(self, uid: int, members: list, flags: list, kind: str, deps: set):
        self.uid = uid
        self.members = members
        self.flags = flags          # per member: bad in this context (self-failure or semantic)
        self.kind = kind
        self.run = None
        self.result = None
        self.deps = deps
        mods: set = set()
        for t in members:
            mods |= t.mods_x
        self.mods = mods


class BadRec:
    """A bad change version on the fast trunk (red until its fix lands)."""
    __slots__ = ("task", "pos", "landed_t", "fix_pos", "fixed_t", "detect_t", "known", "searching", "n_detect")

    def __init__(self, task: Task, pos: int, now: float):
        self.task = task
        self.pos = pos
        self.landed_t = now
        self.fix_pos = None
        self.fixed_t = None
        self.detect_t = None
        self.known = False
        self.searching = False
        self.n_detect = 0


class Search:
    __slots__ = ("target", "h", "steps", "flaky")

    def __init__(self, target, h: int, steps: int):
        self.target = target
        self.h = h
        self.steps = steps
        self.flaky = False


# --------------------------------------------------------------------------------------
# Placement scheduler
# --------------------------------------------------------------------------------------
class Scheduler:
    """Backlog in priority (index) order. With placement, a task starts only if its predicted
    footprint does not overlap any held footprint (running tasks: predicted; finished but not
    yet in new tasks' base: actual). Fallback when nothing is placeable: wait | least-overlap."""

    def __init__(self, sim: "Sim", place: bool, fallback: str, window: int, n_mod: int, n_tasks: int,
                 cap: int = 1, pair: bool = False):
        if fallback not in ("wait", "least-overlap"):
            raise ValueError(f"placement_fallback must be wait or least-overlap, not {fallback!r}")
        self.sim = sim
        self.place = place
        self.pair = pair
        self.held: dict[int, Task] = {}      # pair model: tasks that can still collide with a new one
        self.fcount: dict[int, int] = {}     # pair model: flags on evaluated pending tasks
        self.fallback = fallback
        self.window = max(1, int(window))
        self.cap = max(1, int(cap))
        self.cnt = [0] * n_mod
        self.pend: list[int] = []
        self.alive = bytearray(n_tasks)
        self.head = 0
        self.dead = 0
        self.dirty = True
        self.n_pending = 0
        self.n_fallback = 0

    def add_ready(self, i: int) -> None:
        self.alive[i] = 1
        j = bisect.bisect_left(self.pend, i)
        self.pend.insert(j, i)
        if j < self.head:           # released dependents can sort before the scan head
            self.head = j
        self.n_pending += 1
        self.dirty = True

    def _remove(self, i: int) -> None:
        self.alive[i] = 0
        self.fcount.pop(i, None)
        self.n_pending -= 1
        self.dead += 1
        if self.dead > 512 and self.dead * 2 > len(self.pend):
            self.pend = [x for x in self.pend if self.alive[x]]
            self.head = 0
            self.dead = 0

    def hold(self, t: Task, mods) -> None:
        if not self.place:
            return
        if self.pair:
            # any non-None footprint keeps t held; None releases it
            if mods is not None and t.idx not in self.held:
                self._register(t)
            elif mods is None and t.idx in self.held:
                self._unregister(t)
            t.hold = None if mods is None else True
            return
        cnt = self.cnt
        old = t.hold
        if old:
            for m in old:
                cnt[m] -= 1
                if cnt[m] < self.cap:
                    self.dirty = True
        if mods:
            for m in mods:
                cnt[m] += 1
        t.hold = mods if mods else None

    def _register(self, r: Task) -> None:
        self.held[r.idx] = r
        fc = self.fcount
        if fc:
            for ti in self.sim.flagged_by(r, fc):
                fc[ti] += 1

    def _unregister(self, r: Task) -> None:
        del self.held[r.idx]
        fc = self.fcount
        if fc:
            for ti in self.sim.flagged_by(r, fc):
                fc[ti] -= 1
                if fc[ti] == 0:
                    self.dirty = True

    def _evaluate(self, t: Task) -> int:
        n = self.sim.count_flags(t, self.held.values())
        self.fcount[t.idx] = n
        return n

    def _pick_pair(self):
        """Pair model: hard (wait) starts only an unflagged task; soft (least-overlap) takes the
        task with the fewest flags, so an agent never idles while work is pending."""
        pend = self.pend
        alive = self.alive
        fc = self.fcount
        tasks = self.sim.tasks
        best = -1
        best_score = 1 << 30
        seen = 0
        j = self.head
        n = len(pend)
        W = self.window
        while j < n and seen < W:
            i = pend[j]
            j += 1
            if not alive[i]:
                continue
            seen += 1
            sc = fc.get(i)
            if sc is None:
                sc = self._evaluate(tasks[i])
            if sc == 0:
                self._remove(i)
                return i, False
            if sc < best_score:
                best, best_score = i, sc
        if self.fallback == "wait":
            self.dirty = False
            return None
        self.n_fallback += 1
        self._remove(best)
        return best, True

    def pick(self):
        """Returns (task index, overlapped) or None."""
        pend = self.pend
        alive = self.alive
        while self.head < len(pend) and not alive[pend[self.head]]:
            self.head += 1
        if self.head >= len(pend):
            return None
        if not self.place:
            i = pend[self.head]
            self._remove(i)
            return i, False
        if not self.dirty and self.fallback == "wait":
            return None
        if self.pair:
            return self._pick_pair()
        tasks = self.sim.tasks
        cnt = self.cnt
        cap = self.cap
        best = -1
        best_score = 1 << 30
        seen = 0
        j = self.head
        n = len(pend)
        W = self.window
        while j < n and seen < W:
            i = pend[j]
            j += 1
            if not alive[i]:
                continue
            seen += 1
            sc = 0
            full = False
            for m in tasks[i].pred:
                c = cnt[m]
                if c:
                    sc += 1
                    if c >= cap:
                        full = True
            if not full:                 # placeable: no predicted module is at its cap
                self._remove(i)
                return i, sc > 0
            if sc < best_score:
                best, best_score = i, sc
        if self.fallback == "wait":
            self.dirty = False
            return None
        self.n_fallback += 1
        self._remove(best)
        return best, True


# --------------------------------------------------------------------------------------
# Simulator
# --------------------------------------------------------------------------------------
class Sim:
    def __init__(self, params: dict, policy: str, seed: int, audit: bool = False):
        if policy not in POLICIES:
            raise ValueError(f"unknown policy {policy!r}; choose from {', '.join(POLICIES)}")
        pol = POLICIES[policy]
        P = deep_merge(DEFAULTS, params)
        P.update(pol["fixed"])
        self.P = P
        self.policy = policy
        self.kind = pol["kind"]
        self.use_place = pol["place"]
        self.aimd = pol["aimd"]
        self.seed = int(seed)
        self.audit = audit
        self.now = 0.0
        self.seq = 0
        self.evq: list = []

        self.N = int(P["agents"])
        self.M = int(P["tasks"]) if P.get("tasks") else int(P["tasks_per_agent"]) * self.N
        self.R = ci_slots_for(P, self.N)
        self.T = float(P["test_minutes"])
        self.T_sig = float(P["test_jitter_sigma"])
        self.flake_rate = float(P["flake_rate"])
        self.p_self = float(P["p_self"])
        self.r_conf = float(P["r_conf"])
        self.r_fix = float(P["r_fix"])
        self.drivers = bool(P["merge_drivers"])
        self.per_file = P["conflict_model"] == "per_file"
        self.p_module = float(P["p_module"])
        self.p_disjoint = float(P["p_disjoint"])
        self.p_file = float(P["p_file"])
        self.diss_share = float(P["dissolvable_share"])
        self.q_sem = float(P["q_sem"])
        self.c_round = float(P["commit_round_s"]) / 60.0
        self.c_per = float(P["commit_per_change_s"]) / 60.0
        self.a_suspect = float(P["a_suspect"])
        pn = float(P["p_per_file"])
        pd = float(P["p_per_file_diss"])
        self.PN = [1.0 - (1.0 - pn) ** k for k in range(65)]
        self.PD = [1.0 - (1.0 - pd) ** k for k in range(65)]

        self.K_TX = make_key(seed, "tx")
        self.K_TXD = make_key(seed, "txd")
        self.K_TXM = make_key(seed, "txm")
        self.K_DJ = make_key(seed, "disjoint")
        self.K_SEM = make_key(seed, "sem")
        self.K_SELF = make_key(seed, "self")
        self.K_SUS = make_key(seed, "suspect")
        self.K_REC = make_key(seed, "recall")
        self.K_FLAG = make_key(seed, "flag")
        self.pair_place = P.get("placement_model", "pair") == "pair"
        fr = float(P["flag_recall"])
        fcl = float(P["flag_clean"])
        self.flag_recall = fr
        self.flag_clean = fcl
        self.flag_lo = min(fr, fcl)
        self.flag_hi = max(fr, fcl)
        self.flag_conflict_wins = fr >= fcl
        self.rng_ci = random.Random(f"{seed}-ci-{policy}")
        self.rng_misc = random.Random(f"{seed}-misc-{policy}")
        self.pcache: dict[int, int] = {}

        self.fpm = FootprintModel(P["footprint"])
        self.n_mod = self.fpm.n_mod
        self.tasks = self._build_tasks()
        # per-task scrambled keys: the pair flag draw is the C-level tuple hash of the two keys
        # (ordered by task index), deterministic across processes and uncorrelated across pairs
        self.fkey = [mix64(self.K_FLAG ^ ((i * 0x9E3779B97F4A7C15) & M64)) for i in range(self.M)]
        self.ccache: dict[int, bool] = {}

        self.ci = CI(self, self.R)
        self.agents = [Agent(i) for i in range(self.N)]
        nf = int(P.get("fixer_pool") or 0)
        self.fixers = [Agent(self.N + i, fixer=True) for i in range(nf)]
        self.idle: deque = deque(self.agents)
        self.idle_fixers: deque = deque(self.fixers)
        self.tickets: deque = deque()
        self.sched = Scheduler(self, self.use_place, P["placement_fallback"], P["place_window"],
                               self.n_mod, self.M, int(P.get("place_cap") or 1), pair=self.pair_place)
        self.n_unready = 0
        for t in self.tasks:
            if t.dep < 0:
                t.ready = True
                self.sched.add_ready(t.idx)
            else:
                self.n_unready += 1
        self.dispatch_pending = True
        self.idle_by_reason: dict[str, float] = {}

        # metrics
        self.n_green = 0
        self.green_adv: list[float] = []
        self.n_conflicts = 0
        self.n_dissolved = 0
        self.n_reds = 0
        self.n_culprits = 0
        self.n_false_blames = 0
        self.n_fixes = 0
        self.n_starts_overlap = 0
        self.n_bisect = 0
        self.n_cancelled = 0
        self.n_val_runs = 0
        self.n_search_runs = 0
        self.n_searches = 0
        self.n_suspect_hits = 0
        self.max_open_reds = 0
        self.paused_since = None
        self.paused_total = 0.0
        self.landings: list[tuple[int, int]] = []
        self.audit_starts: list = []
        self.running: set[int] = set()
        self.open_reds: set = set()

        if self.kind == "queue":
            self.main = Trunk(self.n_mod)
            self.queue: list = []
            self.train: list[Unit] = []
            self.partition = P["queue_partition"] == "modules"
            self.uid = 0
            # units in flight: a linear train is capped at spec_depth; a partitioned queue at R
            # in total and at spec_depth per dependency chain
            self.depth = self.R if self.partition else max(1, min(int(P["spec_depth"]), self.R))
            self.chain_depth = max(1, int(P["spec_depth"]))
            self.k_fixed = max(1, int(P["batch_k"]))
            self.k_cur = int(P["aimd_k_start"]) if self.aimd else self.k_fixed
            self.k_min = int(P["aimd_k_min"])
            self.k_max = int(P["aimd_k_max"])
            self.released = P["queue_agents"] == "released"
            self.requeue_front = P["requeue"] == "front"
            self.q_suspects = bool(P["queue_suspects"])
            self.build_scan = int(P["build_scan"])
            self.k_trace: list[int] = []
        else:
            self.fast = Trunk(self.n_mod)
            self.green_pos = 0
            self.green_excl: set[int] = set()
            self.commit_q: list = []
            self.committer_busy = False
            self.last_run_head = 0
            self.val_heads: list[int] = [0]     # heads of every validation run started (sorted)
            self.val_inflight = 0
            self.confirm_h = 0
            self.confirm_inflight = False
            self.bad: list[BadRec] = []
            self.all_bad: list[BadRec] = []
            self.search_wait: deque = deque()
            self.snapshot_green = P["snapshot"] == "green"
            self.quarantine = P["green_mode"] == "quarantine"
            self.budget = bool(P["budget"])
            self.B = int(P["budget_open_reds"])
            self.A = float(P["budget_max_age_min"])

    # ---------------------------------------------------------------- task generation
    def _build_tasks(self) -> list[Task]:
        P = self.P
        fpm = self.fpm
        rng = random.Random(f"{self.seed}-tasks")
        empirical_pred = P.get("prediction_model") == "empirical"
        if empirical_pred and not fpm.pred_idx:
            raise ValueError("prediction_model 'empirical' needs footprint.predicted (calibrate.py with step 2)")
        idxs = fpm.sample_entries(rng, self.M, predicted_only=empirical_pred)
        entries = [fpm.changes[j] for j in idxs]
        D = float(P["work_median_min"])
        s = float(P["work_sigma"])
        dep_rate = float(P["dependency_rate"])
        dep_w = max(1, int(P["dep_window"]))
        tasks: list[Task] = []
        for i, entry in enumerate(entries):
            t = Task(i)
            t.mods = frozenset(m for m, _ in entry)
            t.mods_nc = frozenset(m for m in t.mods if not fpm.comm[m])
            t.mods_x = t.mods_nc if self.drivers else t.mods
            t.files_n, t.files_d = fpm.draw_fp(rng, entry)
            t.work = D * math.exp(s * rng.gauss(0.0, 1.0))
            t.dep = -1
            if i > 0 and rng.random() < dep_rate:
                lo = max(0, i - dep_w)
                cands = [j for j in range(lo, i) if not tasks[j].mods_nc.isdisjoint(t.mods_nc)]
                if not cands:
                    cands = list(range(lo, i))
                t.dep = cands[rng.randrange(len(cands))]
                tasks[t.dep].dependents.append(i)
            tasks.append(t)
        # Predicted footprints: each true non-commutative module kept with probability rho (a
        # per-(task, module) hash, so predictions are nested across rho); false positives drawn
        # from module popularity with E[FP] = rho*|A|*(1-pi)/pi, so expected precision is pi.
        rho = float(P["recall"])
        pi = max(1e-6, float(P["precision"]))
        prng = random.Random(f"{self.seed}-pred")
        for t, j in zip(tasks, idxs):
            if empirical_pred:
                t.pred = tuple(sorted(m for m in fpm.predicted[j] if 0 <= m < fpm.n_mod and not fpm.comm[m]))
                continue
            tp = [m for m in sorted(t.mods_nc) if uni(self.K_REC, t.idx, m) < rho]
            efp = rho * len(t.mods_nc) * (1.0 - pi) / pi
            nfp = int(efp)
            if prng.random() < efp - nfp:
                nfp += 1
            pred = set(tp)
            nfp = min(nfp, max(0, len(fpm.nc_mods) - len(t.mods_nc)))
            tries = 0
            while nfp > 0 and tries < 50 * (nfp + 1):
                tries += 1
                m = fpm.nc_mods[bisect.bisect_left(fpm.nc_cum, prng.random() * fpm.nc_cum[-1])]
                if m in t.mods_nc or m in pred:
                    continue
                pred.add(m)
                nfp -= 1
            t.pred = tuple(sorted(pred))
        return tasks

    # ---------------------------------------------------------------- event machinery
    def at(self, dt: float, fn, *args) -> None:
        self.seq += 1
        heapq.heappush(self.evq, (self.now + dt, self.seq, fn, args))

    def ci_duration(self) -> float:
        if self.T_sig > 0:
            return self.T * math.exp(self.T_sig * self.rng_ci.gauss(0.0, 1.0))
        return self.T

    def flake(self) -> bool:
        return self.flake_rate > 0 and self.rng_ci.random() < self.flake_rate

    def set_state(self, a: Agent, s: int, reason: str | None = None) -> None:
        dt = self.now - a.since
        a.acc[a.state] += dt
        if a.state == IDLE:
            self.idle_by_reason[a.idle_reason] = self.idle_by_reason.get(a.idle_reason, 0.0) + dt
        a.state = s
        a.since = self.now
        if s == IDLE:
            a.idle_reason = reason or "idle"

    def free_agent(self, a: Agent) -> None:
        self.set_state(a, IDLE, self._idle_reason())
        (self.idle_fixers if a.fixer else self.idle).append(a)
        self.dispatch_pending = True

    def _idle_reason(self) -> str:
        if self.paused():
            return "paused"
        if self.sched.n_pending > 0:
            return "placement"
        if self.n_unready > 0:
            return "deps"
        return "no-work"

    # ---------------------------------------------------------------- interaction model
    def pair_conflict(self, t: Task, x: Task) -> int:
        """0: merges cleanly; 1: textual conflict; 2: a conflict merge drivers dissolve."""
        if t.idx < x.idx:
            lo, hi = t.idx, x.idx
        else:
            lo, hi = x.idx, t.idx
        fn_dis = t.files_n.isdisjoint(x.files_n)
        fd_dis = t.files_d.isdisjoint(x.files_d)
        if fn_dis and fd_dis:
            if self.p_module > 0 and uni(self.K_TXM, lo, hi) < self.p_module:
                return 1
            return 0
        if self.per_file:
            if not fn_dis:
                n = len(t.files_n & x.files_n)
                if uni(self.K_TX, lo, hi) < self.PN[n if n < 64 else 64]:
                    return 1
            if not fd_dis:
                n = len(t.files_d & x.files_d)
                if uni(self.K_TXD, lo, hi) < self.PD[n if n < 64 else 64]:
                    return 2 if self.drivers else 1
            return 0
        if uni(self.K_TX, lo, hi) < self.p_file:
            if self.drivers and uni(self.K_TXD, lo, hi) < self.diss_share:
                return 2
            return 1
        return 0

    def pair_sem(self, t: Task, x: Task) -> bool:
        if self.q_sem <= 0 or t.mods_nc.isdisjoint(x.mods_nc):
            return False
        if t.idx < x.idx:
            return uni(self.K_SEM, t.idx, x.idx) < self.q_sem
        return uni(self.K_SEM, x.idx, t.idx) < self.q_sem

    def pair_code(self, t: Task, x: Task) -> int:
        """Cached pair outcome: 1 textual conflict, 2 clean but semantic break, 0 fine."""
        key = (t.idx << 21) | x.idx if t.idx < x.idx else (x.idx << 21) | t.idx
        c = self.pcache.get(key)
        if c is None:
            r = self.pair_conflict(t, x)
            c = 1 if r == 1 else (2 if self.pair_sem(t, x) else 0)
            if len(self.pcache) > 3_000_000:
                self.pcache.clear()
            self.pcache[key] = c
        return c

    def conflicts(self, t: Task, x: Task) -> bool:
        """Cached: would t and x textually conflict (after merge drivers)?"""
        key = (t.idx << 21) | x.idx if t.idx < x.idx else (x.idx << 21) | t.idx
        c = self.ccache.get(key)
        if c is None:
            c = (not t.mods_x.isdisjoint(x.mods_x)) and self.pair_conflict(t, x) == 1
            if len(self.ccache) > 2_000_000:
                self.ccache.clear()
            self.ccache[key] = c
        return c

    def flag_u(self, a: int, b: int) -> float:
        fk = self.fkey
        return (hash((fk[a], fk[b]) if a < b else (fk[b], fk[a])) & M64) * INV64

    def flag(self, t: Task, r: Task) -> bool:
        """Pair-level placement signal between candidate t and held task r: flagged with
        probability flag_recall if the pair would textually conflict (after merge drivers), else
        flag_clean. One latent draw per pair, so a pair's flag never changes."""
        u = self.flag_u(t.idx, r.idx)
        if u < self.flag_lo:
            return True
        if u >= self.flag_hi:
            return False
        return self.conflicts(t, r) == self.flag_conflict_wins

    def flagged_by(self, r: Task, cand_idx) -> list[int]:
        """Indices among cand_idx that held task r flags (inlined twin of count_flags)."""
        lo_p = self.flag_lo
        hi_p = self.flag_hi
        win = self.flag_conflict_wins
        tasks = self.tasks
        fk = self.fkey
        ri = r.idx
        kr = fk[ri]
        conflicts = self.conflicts
        out = []
        for ti in cand_idx:
            u = (hash((fk[ti], kr) if ti < ri else (kr, fk[ti])) & M64) * INV64
            if u < lo_p:
                out.append(ti)
            elif u < hi_p and conflicts(tasks[ti], r) == win:
                out.append(ti)
        return out

    def count_flags(self, t: Task, held) -> int:
        """Number of held tasks that flag t (the hot loop of pair-level placement, inlined)."""
        lo_p = self.flag_lo
        hi_p = self.flag_hi
        win = self.flag_conflict_wins
        fk = self.fkey
        ti = t.idx
        kt = fk[ti]
        conflicts = self.conflicts
        n = 0
        for r in held:
            ri = r.idx
            u = (hash((kt, fk[ri]) if ti < ri else (fk[ri], kt)) & M64) * INV64
            if u < lo_p:
                n += 1
            elif u < hi_p and conflicts(t, r) == win:
                n += 1
        return n

    def self_bad(self, t: Task) -> bool:
        return uni(self.K_SELF, t.idx, t.fixno) < self.p_self

    def scan(self, trunk: Trunk, t: Task, lo: int):
        """Interactions of t with trunk commits at positions > lo (not in t's base).
        Returns (conflict, semantic_break, n_dissolved)."""
        by_mod = trunk.by_mod
        ctask = trunk.ctask
        seen: set[int] = set()
        sem = False
        diss = 0
        for m in t.mods_x:
            lst = by_mod[m]
            if not lst or lst[-1] <= lo:
                continue
            for j in range(bisect.bisect_right(lst, lo), len(lst)):
                p = lst[j]
                if p in seen:
                    continue
                seen.add(p)
                x = ctask[p]
                if x is t:
                    continue
                r = self.pair_conflict(t, x)
                if r == 1:
                    return True, sem, diss
                if r == 2:
                    diss += 1
                if not sem and self.pair_sem(t, x):
                    sem = True
        if self.p_disjoint > 0:
            n_dis = (len(trunk) - lo) - len(seen)
            if n_dis > 0:
                t.attempt += 1
                if uni(self.K_DJ, t.idx, t.attempt) < 1.0 - (1.0 - self.p_disjoint) ** n_dis:
                    return True, sem, diss
        return False, sem, diss

    # ---------------------------------------------------------------- agents & dispatch
    def paused(self) -> bool:
        if self.kind != "bean" or not self.budget or not self.open_reds:
            return False
        if len(self.open_reds) > self.B:
            return True
        oldest = min(b.detect_t for b in self.open_reds)
        return self.now - oldest > self.A

    def _track_pause(self) -> None:
        if self.kind != "bean":
            return
        p = self.paused()
        if p and self.paused_since is None:
            self.paused_since = self.now
        elif not p and self.paused_since is not None:
            self.paused_total += self.now - self.paused_since
            self.paused_since = None

    def dispatch(self) -> None:
        self.dispatch_pending = False
        self._track_pause()
        pool = self.idle_fixers if self.fixers else self.idle
        while self.tickets and pool:
            a = pool.popleft()
            self.take_ticket(a, self.tickets.popleft())
        if self.paused():
            return
        idle = self.idle
        while idle:
            got = self.sched.pick()
            if got is None:
                break
            i, overlapped = got
            self.start_task(idle.popleft(), self.tasks[i], overlapped)

    def start_task(self, a: Agent, t: Task, overlapped: bool) -> None:
        if self.audit and self.use_place:
            if self.pair_place:
                clash = [j for j in self.sched.held if self.flag(t, self.tasks[j])]
                unflagged_left = any(self.sched.fcount.get(i) == 0 for i in self.sched.fcount)
                self.audit_starts.append((t.idx, overlapped, clash, unflagged_left))
            else:
                clash = [j for j in self.running if not set(self.tasks[j].pred).isdisjoint(t.pred)]
                self.audit_starts.append((t.idx, overlapped, clash, False))
        if overlapped:
            self.n_starts_overlap += 1
        t.agent = a
        t.start_t = self.now
        if self.kind == "queue":
            t.base = len(self.main)
        else:
            t.base = self.green_pos if self.snapshot_green else len(self.fast)
        self.sched.hold(t, t.pred)
        self.running.add(t.idx)
        self.set_state(a, BUSY)
        self.at(t.work, self.task_done, a, t)

    def task_done(self, a: Agent, t: Task) -> None:
        self.running.discard(t.idx)
        t.done_t = self.now
        self.sched.hold(t, t.mods_nc)             # the write set is now known exactly
        if self.kind == "queue":
            t.prio = (self.now, t.idx)
            if self.released:
                t.agent = None
                self.free_agent(a)
            else:
                self.set_state(a, BLOCKED)
            heapq.heappush(self.queue, (t.prio, t.idx))
            self.q_pump()
        else:
            self.b_submit(t, a, "task", None)

    def take_ticket(self, a: Agent, tk) -> None:
        if self.kind == "queue":
            kind, t = tk
            t.agent = a
            self.q_start_rework(a, t, kind)
        else:
            self.b_take_ticket(a, tk)

    def release_dependents(self, t: Task) -> None:
        for d in t.dependents:
            dt = self.tasks[d]
            if not dt.ready:
                dt.ready = True
                self.n_unready -= 1
                self.sched.add_ready(d)
                self.dispatch_pending = True

    def mark_green(self, t: Task) -> None:
        if t.green_t is None:
            t.green_t = self.now
            self.n_green += 1

    # ================================================================ merge queue
    def q_eval_main(self, t: Task):
        """Conflict / semantic status of t against main commits since its base (incremental)."""
        if t.ev_base != t.base:
            t.ev_base = t.base
            t.ev_upto = t.base
            t.ev_conf = False
            t.ev_sem = False
        L = len(self.main)
        if t.ev_upto < L and not t.ev_conf:
            conf, sem, diss = self.scan(self.main, t, t.ev_upto)
            self.n_dissolved += diss
            t.ev_conf = conf
            t.ev_sem = t.ev_sem or sem
            t.ev_upto = L
        return t.ev_conf, t.ev_sem

    def q_build_unit(self, index: dict, uindex: dict, live: set):
        """Build the next batch from the queue front. `index` maps module -> PRs already in
        flight (speculatively ahead of this batch); `uindex` maps module -> in-flight units."""
        k = self.k_cur
        members: list[Task] = []
        flags: list[bool] = []
        deferred = []
        scanned = 0
        cap = max(self.build_scan, 4 * k)
        unit_deps: set = set()
        while self.queue and len(members) < k and scanned < cap:
            prio, ti = heapq.heappop(self.queue)
            scanned += 1
            t = self.tasks[ti]
            conf, sem = self.q_eval_main(t)
            if conf:
                self.q_eject(t, "conf")      # rebase check against main failed
                continue
            if t.blocker and t.blocker in live:
                deferred.append((prio, ti))  # still waiting on the in-flight unit it conflicts with
                continue
            d = None
            if self.partition:
                # bounded speculation per dependency chain (Uber-style): skip a PR whose chain of
                # in-flight units is already spec_depth long; runners go to independent work
                d = set(unit_deps)
                for m in t.mods_x:
                    for v in uindex.get(m, ()):
                        if v.uid not in d:
                            d.add(v.uid)
                            d |= v.deps
                if len(d) >= self.chain_depth:
                    deferred.append((prio, ti))
                    continue
            clash = 0
            seen: set[int] = set()
            for m in t.mods_x:
                for x, uid in index.get(m, ()):
                    if x.idx in seen:
                        continue
                    seen.add(x.idx)
                    c = self.pair_code(t, x)
                    if c == 1:
                        clash = uid or -1
                        break
                    if c == 2:
                        sem = True
                if clash:
                    break
            if clash:
                t.blocker = clash if clash > 0 else 0
                # conflicts with a PR still in flight: leave it queued until that one resolves
                deferred.append((prio, ti))
                continue
            if d is not None:
                unit_deps = d
            members.append(t)
            flags.append(sem or self.self_bad(t))
            for m in t.mods_x:
                index.setdefault(m, []).append((t, 0))
        for entry in deferred:
            heapq.heappush(self.queue, entry)
        if not members:
            return None
        return self.q_new_unit(members, flags, "batch", None)

    def q_new_unit(self, members: list, flags: list, kind: str, deps) -> Unit:
        self.uid += 1
        u = Unit(self.uid, members, flags, kind, set())
        if deps is not None:
            u.deps = set(deps)
        elif self.partition:
            d: set = set()
            for v in self.train:
                if v.uid not in d and not u.mods.isdisjoint(v.mods):
                    d.add(v.uid)
                    d |= v.deps
            u.deps = d
        else:
            u.deps = {v.uid for v in self.train}
        return u

    def q_start_unit(self, u: Unit) -> None:
        dur = self.ci_duration() + self.c_round + self.c_per * len(u.members)
        u.run = self.ci.start(dur, self.q_unit_done, u)

    def q_pump(self) -> None:
        ci = self.ci
        for u in self.train:
            if ci.free() <= 0:
                return
            if u.run is None and u.result is None:
                self.q_start_unit(u)
        if ci.free() <= 0 or not self.queue or len(self.train) >= self.depth:
            return
        index: dict = {}
        uindex: dict = {}
        live = set()
        for u in self.train:
            live.add(u.uid)
            for x in u.members:
                for m in x.mods_x:
                    index.setdefault(m, []).append((x, u.uid))
            for m in u.mods:
                uindex.setdefault(m, []).append(u)
        while ci.free() > 0 and self.queue and len(self.train) < self.depth:
            u = self.q_build_unit(index, uindex, live)
            if u is None:
                break
            self.train.append(u)
            live.add(u.uid)
            for lst in index.values():          # members just added carry uid 0: stamp them
                for j, (x, uid) in enumerate(lst):
                    if uid == 0:
                        lst[j] = (x, u.uid)
            for m in u.mods:
                uindex.setdefault(m, []).append(u)
            self.q_start_unit(u)

    def q_unit_done(self, run: Run, u: Unit) -> None:
        if not run.alive:
            return
        self.ci.finish(run)
        u.run = None
        u.result = (not any(u.flags)) and not self.flake()
        if not u.result:
            self.n_reds += 1
        self.q_resolve()
        self.q_pump()

    def q_cancel(self, u: Unit) -> None:
        if u.run is not None:
            self.ci.abort(u.run)
            u.run = None
        self.n_cancelled += 1
        for t in u.members:
            heapq.heappush(self.queue, (t.prio, t.idx))

    def q_resolve(self) -> None:
        """Resolve every unit whose result is in and whose dependencies have all landed
        (in a linear train only the head qualifies)."""
        progress = True
        while progress:
            progress = False
            live = {v.uid for v in self.train}
            for idx, u in enumerate(self.train):
                if u.result is None or not u.deps.isdisjoint(live):
                    continue
                self.train.pop(idx)
                if u.result:
                    self.q_land(u)
                    if self.aimd and u.kind == "batch":
                        self.k_cur = min(self.k_max, self.k_cur + 1)
                        self.k_trace.append(self.k_cur)
                else:
                    if self.aimd and u.kind == "batch":
                        self.k_cur = max(self.k_min, self.k_cur // 2)
                        self.k_trace.append(self.k_cur)
                    self.q_fail(u, idx)
                progress = True
                break

    def q_fail(self, u: Unit, idx: int) -> None:
        keep = []
        for v in self.train:                 # units that assumed u would land
            if u.uid in v.deps:
                self.q_cancel(v)
            else:
                keep.append(v)
        self.train = keep
        idx = min(idx, len(keep))
        if len(u.members) == 1:
            t = u.members[0]
            self.q_eject(t, "fix" if u.flags[0] else "flake")
            return
        culprits = [i for i, f in enumerate(u.flags) if f]
        if self.q_suspects and culprits:
            hit = True
            for i in culprits:
                c = u.members[i]
                c.attempt += 1
                if uni(self.K_SUS, c.idx, c.fixno * 1024 + c.attempt) >= self.a_suspect:
                    hit = False
            if hit:
                # failing tests name every culprit: eject them, retest the rest without bisecting
                self.n_suspect_hits += len(culprits)
                rest = [(m, f) for m, f in zip(u.members, u.flags) if not f]
                for i in culprits:
                    self.q_eject(u.members[i], "fix")
                if rest:
                    r = self.q_new_unit([m for m, _ in rest], [f for _, f in rest], "retest", u.deps)
                    self.train.insert(idx, r)
                return
        h = len(u.members) // 2
        self.n_bisect += 1
        left = self.q_new_unit(u.members[:h], u.flags[:h], "bisect", u.deps)
        right = self.q_new_unit(u.members[h:], u.flags[h:], "bisect", u.deps | {left.uid})
        self.train[idx:idx] = [left, right]

    def q_land(self, u: Unit) -> None:
        for t in u.members:
            pos = self.main.append(t, self.now)
            t.landed += 1
            t.latest_pos = pos
            self.landings.append((t.idx, t.fixno))
            self.mark_green(t)
            self.green_adv.append(self.now)
            self.sched.hold(t, None)
            self.release_dependents(t)
            if not self.released and t.agent is not None:
                a = t.agent
                t.agent = None
                self.free_agent(a)
        self.dispatch_pending = True

    def q_eject(self, t: Task, kind: str) -> None:
        if kind == "conf":
            self.n_conflicts += 1
        elif kind == "fix":
            self.n_culprits += 1
        else:
            self.n_false_blames += 1
        if self.released:
            self.tickets.append((kind, t))
            self.dispatch_pending = True
        else:
            self.q_start_rework(t.agent, t, kind)

    def q_start_rework(self, a: Agent, t: Task, kind: str) -> None:
        t.base = len(self.main)                 # rebase onto current main
        dur = (self.r_conf if kind == "conf" else self.r_fix) * t.work
        self.set_state(a, REWORK)
        self.at(dur, self.q_rework_done, a, t, kind)

    def q_rework_done(self, a: Agent, t: Task, kind: str) -> None:
        if kind == "fix":
            t.fixno += 1
            self.n_fixes += 1
        if not self.requeue_front:
            t.prio = (self.now, t.idx)
        if self.released:
            t.agent = None
            self.free_agent(a)
        else:
            self.set_state(a, BLOCKED)
        heapq.heappush(self.queue, (t.prio, t.idx))
        self.q_pump()

    # ================================================================ beanstalk
    def b_submit(self, t: Task, a: Agent, kind: str, br) -> None:
        self.set_state(a, BLOCKED)
        self.commit_q.append((t, a, kind, br))
        if not self.committer_busy:
            self.b_round_start()

    def b_round_start(self) -> None:
        batch = self.commit_q
        self.commit_q = []
        self.committer_busy = True
        self.at(self.c_round + self.c_per * len(batch), self.b_round_end, batch)

    def b_round_end(self, batch: list) -> None:
        for t, a, kind, br in batch:
            conf, sem, diss = self.scan(self.fast, t, t.base)
            if conf:
                # snapshot isolation: re-execute on the new head
                self.n_conflicts += 1
                t.base = len(self.fast)
                self.set_state(a, REWORK)
                self.at(self.r_conf * t.work, self.b_rework_done, t, a, kind, br)
                continue
            self.n_dissolved += diss
            self.b_land(t, a, kind, br, sem)
        self.committer_busy = False
        if self.commit_q:
            self.b_round_start()
        self.b_pump_ci()

    def b_rework_done(self, t: Task, a: Agent, kind: str, br) -> None:
        self.b_submit(t, a, kind, br)

    def b_land(self, t: Task, a: Agent, kind: str, br, sem: bool) -> None:
        pos = self.fast.append(t, self.now)
        first = t.landed == 0
        t.landed += 1
        t.latest_pos = pos
        self.landings.append((t.idx, t.fixno))
        if br is not None:
            br.fix_pos = pos
            br.fixed_t = self.now
            self.open_reds.discard(br)
            self.n_fixes += 1
        if sem or self.self_bad(t):
            rec = BadRec(t, pos, self.now)
            self.bad.append(rec)
            self.all_bad.append(rec)
        if not self.snapshot_green:
            self.sched.hold(t, None)
            if first:
                self.release_dependents(t)
        self.free_agent(a)

    def b_closure(self, qpos, h: int) -> set:
        """Quarantine set for a test of head h: known culprits plus every later commit that was
        built on one of them (culprit in its base) and shares a non-commutative module."""
        if not qpos:
            return set()
        X = set(qpos)
        ctask = self.fast.ctask
        cbase = self.fast.cbase
        xs = sorted(X)
        for z in range(xs[0] + 1, h + 1):
            if z in X:
                continue
            bz = cbase[z]
            mz = ctask[z].mods_nc
            for c in xs:
                if c > bz:
                    break
                if not mz.isdisjoint(ctask[c].mods_nc):
                    X.add(z)
                    bisect.insort(xs, z)
                    break
        return X

    def b_red_at(self, h: int, X) -> bool:
        for b in self.bad:
            if b.pos > h:
                return False
            if (b.fix_pos is None or b.fix_pos > h) and (X is None or b.pos not in X):
                return True
        return False

    def b_pump_ci(self) -> None:
        ci = self.ci
        while ci.free() > 0:
            if self.search_wait:
                s = self.search_wait.popleft()
                ci.start(self.ci_duration(), self.b_search_done, s)
                continue
            if self.quarantine and self.confirm_h > self.green_pos and not self.confirm_inflight:
                # confirm everything below the earliest culprit that is still being bisected
                ch = self.confirm_h
                for b in self.open_reds:
                    if b.searching and b.pos <= ch:
                        ch = b.pos - 1
                if ch > self.green_pos:
                    self.b_start_val(ch, confirm=True)
                    continue
            L = len(self.fast)
            if L > self.last_run_head:
                self.b_start_val(L)
                continue
            if (L > self.green_pos and self.val_inflight == 0
                    and not any(b.pos <= L and (b.known or b.searching) for b in self.open_reds)):
                self.b_start_val(L)          # re-validate a head whose last red was unexplained
                continue
            break

    def b_start_val(self, h: int, confirm: bool = False) -> None:
        q = None
        if self.quarantine:
            # culprits known now that are still bad in the tree at h (fix absent or after h)
            q = frozenset(b.pos for b in self.bad
                          if b.known and b.pos <= h and (b.fix_pos is None or b.fix_pos > h))
        if confirm:
            self.confirm_inflight = True
        else:
            self.last_run_head = max(self.last_run_head, h)
        if h > self.val_heads[-1]:
            self.val_heads.append(h)
        self.val_inflight += 1
        self.ci.start(self.ci_duration(), self.b_val_done, h, q, confirm)

    def b_val_done(self, run: Run, h: int, q, confirm: bool) -> None:
        if not run.alive:
            return
        self.ci.finish(run)
        self.val_inflight -= 1
        if confirm:
            self.confirm_inflight = False
        self.n_val_runs += 1
        X = self.b_closure(q, h) if self.quarantine else None
        red_real = self.b_red_at(h, X)
        flaked = self.flake()
        if not red_real and not flaked:
            self.b_promote(h, X)
        else:
            self.n_reds += 1
            if red_real:
                pending_search = False
                for b in self.bad:
                    if b.pos > h:
                        break
                    if b.fix_pos is not None and b.fix_pos <= h:
                        continue
                    if X is not None and b.pos in X:
                        continue
                    if b.known:
                        continue
                    if b.searching:
                        pending_search = True
                        continue
                    if b.detect_t is None:
                        b.detect_t = self.now
                        self.n_culprits += 1
                    self.open_reds.add(b)
                    b.n_detect += 1
                    if uni(self.K_SUS, b.task.idx, b.task.fixno * 1024 + b.n_detect) < self.a_suspect:
                        b.known = True
                        self.n_suspect_hits += 1
                        self.tickets.append(("fix", b))
                    else:
                        b.searching = True
                        pending_search = True
                        self.b_new_search(b, h, b.pos)
                if len(self.open_reds) > self.max_open_reds:
                    self.max_open_reds = len(self.open_reds)
                if self.quarantine and not pending_search:
                    self.confirm_h = max(self.confirm_h, h)
            else:
                self.b_new_search(None, h, h)   # no suspect explains a pure flake: bisect, find nothing
        self.dispatch_pending = True
        self.b_pump_ci()

    def b_new_search(self, target, h: int, pos: int) -> None:
        """Bisection between the newest validation head below `pos` (a tree without the culprit)
        and h; validation runs start every few commits, so the span is usually small."""
        i = bisect.bisect_left(self.val_heads, pos) - 1
        lo = max(self.green_pos, self.val_heads[i] if i >= 0 else 0)
        span = max(2, h - lo)
        self.search_wait.append(Search(target, h, max(1, math.ceil(math.log2(span)))))
        self.n_searches += 1

    def b_search_done(self, run: Run, s: Search) -> None:
        if not run.alive:
            return
        self.ci.finish(run)
        self.n_search_runs += 1
        if self.flake():
            s.flaky = True
        s.steps -= 1
        if s.steps > 0:
            self.search_wait.appendleft(s)
        else:
            b = s.target
            if s.flaky:
                # a flaky step mis-directs the bisection: an innocent change gets blamed
                lo = self.green_pos + 1
                hi = min(s.h, len(self.fast))
                if lo <= hi:
                    self.n_false_blames += 1
                    self.tickets.append(("blame", self.fast.ctask[self.rng_misc.randint(lo, hi)]))
                if b is not None:
                    b.searching = False          # still unknown; a later red finds it again
            elif b is not None:
                b.searching = False
                b.known = True
                self.tickets.append(("fix", b))
            if self.quarantine:
                self.confirm_h = max(self.confirm_h, s.h)
            self.dispatch_pending = True
        self.b_pump_ci()

    def b_take_ticket(self, a: Agent, tk) -> None:
        kind, obj = tk
        self.set_state(a, REWORK)
        if kind == "fix":
            t = obj.task
            t.base = len(self.fast)
            self.sched.hold(t, t.mods_nc)
            self.at(self.r_fix * t.work, self.b_fix_done, a, obj)
        else:
            self.at(self.r_fix * obj.work, self.free_agent, a)

    def b_fix_done(self, a: Agent, b: BadRec) -> None:
        b.task.fixno += 1
        self.b_submit(b.task, a, "fix", b)

    def b_promote(self, h: int, X) -> None:
        """Green moves to head h (minus the quarantine set X in quarantine mode)."""
        if h < self.green_pos or (h == self.green_pos and not self.green_excl):
            return
        ctask = self.fast.ctask
        cands = list(range(self.green_pos + 1, h + 1))
        if self.green_excl:
            cands.extend(sorted(self.green_excl))
        for pos in cands:
            if X is not None and pos in X:
                continue
            t = ctask[pos]
            if t.latest_pos == pos and t.green_t is None:
                self.mark_green(t)
                if self.snapshot_green:
                    self.sched.hold(t, None)
                    self.release_dependents(t)
        self.green_pos = max(self.green_pos, h)
        self.green_excl = set(p for p in X if p <= h) if X else set()
        self.bad = [b for b in self.bad if b.pos > h or b.fix_pos is None or b.fix_pos > h]
        self.green_adv.append(self.now)
        self.dispatch_pending = True

    # ================================================================ run
    def run(self) -> dict:
        max_t = float(self.P["max_hours"]) * 60.0
        max_ev = int(self.P.get("max_events") or 0)
        stall = float(self.P.get("stall_hours") or 0) * 60.0
        evq = self.evq
        self.dispatch()
        n_ev = 0
        self.stop_reason = ""
        last_green, last_n = 0.0, 0
        while self.n_green < self.M:
            if self.dispatch_pending:
                self.dispatch()
            if not evq:
                self.stop_reason = "deadlock"
                break
            t, _, fn, args = heapq.heappop(evq)
            if t > max_t:
                self.stop_reason = "max_hours"
                break
            n_ev += 1
            if max_ev and n_ev > max_ev:
                self.stop_reason = "max_events"
                break
            if self.n_green != last_n:
                last_n, last_green = self.n_green, self.now
            elif stall and t - last_green > stall:
                self.stop_reason = "stalled"       # green has not moved for stall_hours: livelock
                break
            self.now = t
            fn(*args)
            if self.dispatch_pending:
                self.dispatch()
        self.n_events = n_ev
        return self.metrics()

    # ================================================================ metrics
    def metrics(self) -> dict:
        end = self.now
        for a in self.agents + self.fixers:
            self.set_state(a, a.state, a.idle_reason if a.state == IDLE else None)
        if self.paused_since is not None:
            self.paused_total += end - self.paused_since
            self.paused_since = None
        complete = self.n_green >= self.M
        greens = sorted(t.green_t for t in self.tasks if t.green_t is not None)
        lat = sorted(t.green_t - t.done_t for t in self.tasks
                     if t.green_t is not None and t.done_t is not None)
        makespan = greens[-1] if complete and greens else end
        hours = makespan / 60.0

        def pct(xs, q):
            if not xs:
                return None
            k = (len(xs) - 1) * q
            f = math.floor(k)
            c = min(len(xs) - 1, f + 1)
            return xs[f] + (xs[c] - xs[f]) * (k - f)

        steady = None
        if len(greens) >= 10:
            i10 = int(0.1 * len(greens))
            i90 = int(0.9 * len(greens)) - 1
            if greens[i90] > greens[i10]:
                steady = (i90 - i10) / ((greens[i90] - greens[i10]) / 60.0)
        acc = [0.0, 0.0, 0.0, 0.0]
        for a in self.agents:
            for i in range(4):
                acc[i] += a.acc[i]
        fix_rework = sum(a.acc[REWORK] for a in self.fixers)
        tot = sum(acc) or 1.0
        # green staleness: time-average of (now - last green advance), and the longest gap
        prev = 0.0
        area = 0.0
        gap_max = 0.0
        for g in sorted(self.green_adv):
            d = g - prev
            area += d * d / 2.0
            gap_max = max(gap_max, d)
            prev = g
        if makespan > prev:
            d = makespan - prev
            area += d * d / 2.0
            gap_max = max(gap_max, d)
        red_ages = []
        if self.kind == "bean":
            for b in self.all_bad:
                red_ages.append((b.fixed_t if b.fixed_t is not None else end) - b.landed_t)
        def rnd(x, n):
            return None if x is None else round(x, n)

        return {
            "policy": self.policy,
            "seed": self.seed,
            "N": self.N,
            "M": self.M,
            "R": self.R,
            "complete": complete,
            "green": self.n_green,
            "makespan_h": round(hours, 4),
            "green_per_h": round(self.n_green / hours, 4) if hours > 0 else None,
            "steady_green_per_h": rnd(steady, 4),
            "lat_p50_min": rnd(pct(lat, 0.5), 3),
            "lat_p95_min": rnd(pct(lat, 0.95), 3),
            "lat_mean_min": round(sum(lat) / len(lat), 3) if lat else None,
            "busy_pct": round(100 * acc[BUSY] / tot, 2),
            "rework_pct": round(100 * acc[REWORK] / tot, 2),
            "blocked_pct": round(100 * acc[BLOCKED] / tot, 2),
            "idle_pct": round(100 * acc[IDLE] / tot, 2),
            "busy_agent_h": round(acc[BUSY] / 60, 2),
            "rework_agent_h": round((acc[REWORK] + fix_rework) / 60, 2),
            "blocked_agent_h": round(acc[BLOCKED] / 60, 2),
            "idle_agent_h": round(acc[IDLE] / 60, 2),
            "idle_placement_agent_h": round(self.idle_by_reason.get("placement", 0.0) / 60, 2),
            "idle_paused_agent_h": round(self.idle_by_reason.get("paused", 0.0) / 60, 2),
            "ci_min": round(self.ci.minutes, 1),
            "ci_util_pct": round(100 * self.ci.minutes / (self.R * makespan), 2) if makespan > 0 else None,
            "ci_runs": self.ci.runs,
            "ci_aborted": self.ci.aborted,
            "ci_max_busy": self.ci.max_busy,
            "conflicts": self.n_conflicts,
            "dissolved": self.n_dissolved,
            "reds": self.n_reds,
            "culprits": self.n_culprits,
            "false_blames": self.n_false_blames,
            "fixes": self.n_fixes,
            "overlap_starts": self.n_starts_overlap,
            "max_red_age_min": round(max(red_ages), 2) if red_ages else 0.0,
            "mean_red_age_min": round(sum(red_ages) / len(red_ages), 2) if red_ages else 0.0,
            "green_staleness_min": round(area / makespan, 2) if makespan > 0 else None,
            "green_gap_max_min": round(gap_max, 2),
            "paused_min": round(self.paused_total, 1),
            "max_open_reds": self.max_open_reds,
            "bisect_rounds": self.n_bisect,
            "cancelled_units": self.n_cancelled,
            "searches": self.n_searches,
            "search_runs": self.n_search_runs,
            "suspect_hits": self.n_suspect_hits,
            "val_runs": self.n_val_runs,
            "events": getattr(self, "n_events", 0),
            "stop_reason": getattr(self, "stop_reason", ""),
        }


def run_one(params: dict, policy: str, seed: int, audit: bool = False) -> dict:
    return Sim(params, policy, seed, audit=audit).run()


def footprint_stats(params: dict, seed: int = 0, n_tasks: int = 4000, window: int = 20) -> dict:
    """Pair statistics implied by the footprint and conflict model, measured the way step 1
    measures a corpus: pairs (i < j) within `window` consecutive tasks of the backlog.

    Returns overlap-class shares, P(conflict | class), the pairwise conflict rate (raw and with
    merge drivers), the share of pairs exposed to semantic breaks, and the per-change collision
    rate with at least one of its (window - 1) predecessors."""
    P = deep_merge(DEFAULTS, params)
    P["tasks"] = n_tasks
    P["agents"] = 1
    P["dependency_rate"] = 0.0
    out = {}
    for drivers in (False, True):
        P["merge_drivers"] = drivers
        s = Sim(P, "serial", seed)
        tasks = s.tasks
        cls = {"file": [0, 0], "module": [0, 0], "disjoint": [0, 0]}
        flag = {True: [0, 0], False: [0, 0]}     # conflicting?, [pairs, predicted footprints overlap]
        sem_exposed = 0
        pairs = 0
        collide = 0
        shared_files = []
        for j in range(window, len(tasks)):
            y = tasks[j]
            hit = False
            for i in range(j - window + 1, j):
                x = tasks[i]
                pairs += 1
                fx = x.files_n | x.files_d
                fy = y.files_n | y.files_d
                if not fx.isdisjoint(fy):
                    c = "file"
                    shared_files.append(len(fx & fy))
                elif not x.mods.isdisjoint(y.mods):
                    c = "module"
                else:
                    c = "disjoint"
                r = s.pair_conflict(y, x) if (c != "disjoint" or s.p_disjoint > 0) else 0
                if c == "disjoint" and s.p_disjoint > 0:
                    r = 1 if uni(s.K_DJ, x.idx, y.idx) < s.p_disjoint else 0
                cls[c][0] += 1
                if r == 1:
                    cls[c][1] += 1
                    hit = True
                f = flag[r == 1]
                f[0] += 1
                if not set(x.pred).isdisjoint(y.pred):
                    f[1] += 1
                if not x.mods_nc.isdisjoint(y.mods_nc):
                    sem_exposed += 1
            collide += hit
        key = "drivers" if drivers else "raw"
        n_changes = len(tasks) - window
        out[key] = {
            "pairs": pairs,
            "class_share": {c: round(v[0] / pairs, 4) for c, v in cls.items()},
            "rate_by_class": {c: round(v[1] / v[0], 4) if v[0] else 0.0 for c, v in cls.items()},
            "pair_conflict_rate": round(sum(v[1] for v in cls.values()) / pairs, 4),
            "per_change_collision_rate": round(collide / n_changes, 4),
            "sem_exposed_share": round(sem_exposed / pairs, 4),
            "mean_shared_files": round(sum(shared_files) / len(shared_files), 3) if shared_files else 0.0,
            # comparable to step 2's pair_flagging: conflicting pairs whose predicted footprints
            # overlap, and clean pairs flagged anyway
            "pred_conflict_recall": round(flag[True][1] / flag[True][0], 4) if flag[True][0] else None,
            "pred_clean_flag_rate": round(flag[False][1] / flag[False][0], 4) if flag[False][0] else None,
        }
    return out


# --------------------------------------------------------------------------------------
# CLI
# --------------------------------------------------------------------------------------
SHOW = ["policy", "N", "R", "green_per_h", "makespan_h", "lat_p50_min", "lat_p95_min",
        "busy_pct", "rework_pct", "blocked_pct", "idle_pct", "ci_util_pct", "conflicts",
        "reds", "max_red_age_min", "green_gap_max_min"]


def main(argv: list[str] | None = None) -> int:
    ap = argparse.ArgumentParser(
        description="Simulate integration policies for concurrent coding agents (one or a few runs). "
                    "experiments.py runs the full sweep and writes out/<params>/results.csv.")
    ap.add_argument("--params", default=os.path.join(HERE, "params", "default.json"),
                    help="params JSON (default: params/default.json; 'none' = built-in defaults)")
    ap.add_argument("--policy", default="all", help=f"one of {', '.join(POLICIES)}, or 'all'")
    ap.add_argument("--agents", type=int, default=None, help="N (default from params)")
    ap.add_argument("--seed", type=int, default=0)
    ap.add_argument("--seeds", type=int, default=1, help="run seeds seed..seed+seeds-1")
    ap.add_argument("--set", action="append", default=[], metavar="KEY=VALUE",
                    help="override a parameter (JSON value; dotted keys reach into footprint)")
    ap.add_argument("--json", action="store_true", help="print one JSON object per run")
    a = ap.parse_args(argv)

    params = apply_sets(load_params(a.params), a.set)
    if a.agents:
        params["agents"] = a.agents
    pols = list(POLICIES) if a.policy == "all" else [a.policy]
    rows = []
    for pol in pols:
        for s in range(a.seed, a.seed + a.seeds):
            r = run_one(params, pol, s)
            rows.append(r)
            if a.json:
                print(json.dumps(r))
    if not a.json:
        widths = [max(len(k), 9) for k in SHOW]
        print("  ".join(k.rjust(w) for k, w in zip(SHOW, widths)))
        for r in rows:
            print("  ".join(str(r[k]).rjust(w) for k, w in zip(SHOW, widths)))
        print("(simulated)")
    return 0


if __name__ == "__main__":
    sys.exit(main())
