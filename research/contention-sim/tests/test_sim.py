"""Invariant tests for sim.py. Run from contention-sim/: python3 -m unittest discover -s tests"""
from __future__ import annotations

import collections
import math
import os
import sys
import unittest

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, os.path.dirname(HERE))

import sim  # noqa: E402

DEFAULT = os.path.join(os.path.dirname(HERE), "params", "default.json")

# every policy plus the variants experiments.py reports
VARIANTS = [(p, {}) for p in sim.POLICIES] + [
    ("beanstalk", {"placement_model": "module"}),
    ("beanstalk", {"placement_model": "module", "placement_fallback": "wait"}),
    ("batched+place", {"placement_model": "module"}),
    ("beanstalk", {"flag_recall": 0.3, "flag_clean": 0.02, "placement_fallback": "wait"}),
    ("beanstalk", {"green_mode": "quarantine"}),
    ("beanstalk", {"snapshot": "green"}),
    ("beanstalk", {"budget": False}),
    ("beanstalk", {"placement_fallback": "wait"}),
    ("beanstalk", {"fixer_pool": 2}),
    ("batched", {"queue_agents": "released"}),
    ("batched", {"queue_suspects": True, "batch_k": 8}),
    ("batched", {"requeue": "back"}),
    ("batched-par", {"batch_k": 4}),
    ("batched+place", {"placement_fallback": "wait"}),
]


def base(**over) -> dict:
    p = sim.load_params(DEFAULT)
    p.update({"agents": 8, "tasks_per_agent": 6})
    p.update(over)
    return p


HARSH = dict(p_self=0.3, q_sem=0.1, flake_rate=0.05, p_per_file=0.3, dependency_rate=0.2)


class TestInvariants(unittest.TestCase):
    def test_every_task_reaches_green(self):
        for pol, ov in VARIANTS:
            for seed in (0, 1):
                with self.subTest(policy=pol, over=ov, seed=seed):
                    r = sim.run_one(base(**HARSH) | ov, pol, seed)
                    self.assertTrue(r["complete"], r)
                    self.assertEqual(r["green"], r["M"])

    def test_ci_concurrency_never_exceeds_R(self):
        for pol, ov in VARIANTS:
            for R in (1, 2, 5):
                with self.subTest(policy=pol, over=ov, R=R):
                    s = sim.Sim(base(ci_slots=R, **HARSH) | ov, pol, 3)
                    s.run()
                    self.assertLessEqual(s.ci.max_busy, R)
                    self.assertTrue(0 <= s.ci.busy <= R)

    def test_no_change_lands_twice(self):
        for pol, ov in VARIANTS:
            with self.subTest(policy=pol, over=ov):
                s = sim.Sim(base(**HARSH) | ov, pol, 5)
                s.run()
                versions = collections.Counter(s.landings)
                self.assertTrue(all(c == 1 for c in versions.values()),
                                [v for v, c in versions.items() if c > 1])
                if s.kind == "queue":
                    per_task = collections.Counter(i for i, _ in s.landings)
                    self.assertEqual(set(per_task.values()), {1})
                    self.assertEqual(len(per_task), s.M)
                trunk = s.main if s.kind == "queue" else s.fast
                self.assertEqual(len(trunk), len(s.landings))

    def test_zero_conflicts_and_failures_reach_the_same_bound(self):
        clean = dict(p_per_file=0.0, p_per_file_diss=0.0, p_module=0.0, p_disjoint=0.0, q_sem=0.0,
                     p_self=0.0, flake_rate=0.0, test_minutes=1.0, test_jitter_sigma=0.0,
                     work_sigma=0.15, dependency_rate=0.0, agents=6, tasks_per_agent=12, ci_slots=6)
        rates = {}
        for pol in sim.POLICIES:
            s = sim.Sim(base(**clean), pol, 11)
            r = s.run()
            total_work_h = sum(t.work for t in s.tasks) / 60.0
            bound = s.M / (total_work_h / s.N)          # perfect load balance, zero overhead
            rates[pol] = r["green_per_h"]
            with self.subTest(policy=pol):
                self.assertTrue(r["complete"])
                self.assertEqual(r["conflicts"], 0)
                self.assertEqual(r["reds"], 0)
                self.assertGreater(r["green_per_h"], 0.85 * bound)
                self.assertLessEqual(r["green_per_h"], bound * 1.0001)
        lo, hi = min(rates.values()), max(rates.values())
        self.assertLess(hi / lo, 1.1, rates)

    def test_serial_at_most_batched_under_low_failure(self):
        low = dict(p_self=0.02, flake_rate=0.0, q_sem=0.0, agents=20, tasks_per_agent=6, ci_slots=4)
        for k in (2, 4):
            ser = [sim.run_one(base(**low), "serial", s)["green_per_h"] for s in range(3)]
            bat = [sim.run_one(base(batch_k=k, **low), "batched", s)["green_per_h"] for s in range(3)]
            with self.subTest(k=k):
                self.assertLessEqual(sum(ser) / 3, sum(bat) / 3)

    def test_determinism_by_seed(self):
        for pol, ov in VARIANTS:
            with self.subTest(policy=pol, over=ov):
                a = sim.run_one(base(**HARSH) | ov, pol, 42)
                b = sim.run_one(base(**HARSH) | ov, pol, 42)
                self.assertEqual(a, b)
        a = sim.run_one(base(**HARSH), "beanstalk", 1)
        b = sim.run_one(base(**HARSH), "beanstalk", 2)
        self.assertNotEqual(a, b)

    def test_common_random_numbers_across_policies(self):
        """The same seed gives every policy the same tasks, footprints and work times."""
        s1 = sim.Sim(base(), "serial", 9)
        s2 = sim.Sim(base(), "beanstalk", 9)
        for a, b in zip(s1.tasks, s2.tasks):
            self.assertEqual((a.mods, a.files_n, a.files_d, a.work, a.dep, a.pred),
                             (b.mods, b.files_n, b.files_d, b.work, b.dep, b.pred))

    def test_placement_never_overlaps_unless_fallback(self):
        """Hard placement never starts a task that a held task flags (pair model) or whose
        predicted modules intersect a running task's (module model); soft placement starts a
        flagged task only when no evaluated candidate is unflagged."""
        for model in ("pair", "module"):
            for pol in ("beanstalk", "batched+place"):
                for N in (6, 30):
                    over = {"agents": N, "placement_model": model}
                    with self.subTest(model=model, policy=pol, N=N, fallback="wait"):
                        s = sim.Sim(base(placement_fallback="wait", **over), pol, 4, audit=True)
                        r = s.run()
                        self.assertTrue(r["complete"])
                        self.assertTrue(s.audit_starts)
                        for idx, overlapped, clash, _ in s.audit_starts:
                            self.assertFalse(overlapped)
                            self.assertEqual(clash, [], f"task {idx} started over {clash}")
                    with self.subTest(model=model, policy=pol, N=N, fallback="least-overlap"):
                        s = sim.Sim(base(**over), pol, 4, audit=True)
                        s.run()
                        n_over = 0
                        for idx, overlapped, clash, unflagged_left in s.audit_starts:
                            if clash:
                                n_over += 1
                                self.assertTrue(overlapped, f"task {idx} overlapped without fallback")
                                self.assertFalse(unflagged_left, f"task {idx} flagged while a clean one waited")
                        if N == 30:
                            self.assertGreater(n_over, 0)

    def test_pair_flag_rates_match_operating_point(self):
        for fr, fc in ((0.6, 0.25), (1.0, 0.05), (0.3, 0.02), (0.9, 0.6)):
            s = sim.Sim(base(agents=50, flag_recall=fr, flag_clean=fc, p_per_file=0.4), "beanstalk", 1)
            ts = s.tasks
            hit = {True: [0, 0], False: [0, 0]}
            for i in range(0, len(ts)):
                for j in range(i + 1, min(len(ts), i + 60)):
                    c = s.conflicts(ts[i], ts[j])
                    h = hit[c]
                    h[0] += 1
                    h[1] += s.flag(ts[i], ts[j])
                    self.assertEqual(s.flag(ts[i], ts[j]), s.flag(ts[j], ts[i]))
            with self.subTest(op=(fr, fc)):
                self.assertGreater(hit[True][0], 100)
                self.assertAlmostEqual(hit[True][1] / hit[True][0], fr, delta=0.06)
                self.assertAlmostEqual(hit[False][1] / hit[False][0], fc, delta=0.02)
            # the incremental counts the scheduler keeps equal a full recount
            sch = s.sched
            held = list(ts[:25])
            for r in held:
                sch.hold(r, ())
            cand = ts[100:140]
            for t in cand:
                sch.add_ready(t.idx) if not sch.alive[t.idx] else None
                sch._evaluate(t)
            for r in held[:10]:
                sch.hold(r, None)
            for t in cand:
                self.assertEqual(sch.fcount[t.idx], s.count_flags(t, sch.held.values()))

    def test_queue_main_stays_green(self):
        """A merge queue never lands a change that is bad in the tree it lands into."""
        for pol in ("serial", "batched", "batched-par", "batched-aimd"):
            s = sim.Sim(base(**HARSH), pol, 7)
            s.run()
            with self.subTest(policy=pol):
                self.assertEqual(s.n_green, s.M)
                self.assertEqual(s.metrics()["max_red_age_min"], 0.0)

    def test_beanstalk_green_contains_no_open_red(self):
        """Prefix mode: whenever green advances, no unfixed bad commit sits at or below it."""
        s = sim.Sim(base(**HARSH), "beanstalk", 8)
        original = s.b_promote

        def checked(h, X):
            for b in s.all_bad:
                if b.pos <= h:
                    assert b.fix_pos is not None and b.fix_pos <= h, (b.pos, b.fix_pos, h)
            return original(h, X)

        s.b_promote = checked
        self.assertTrue(s.run()["complete"])

    def test_recall_controls_prediction(self):
        exact = sim.Sim(base(recall=1.0, precision=1.0), "beanstalk", 2)
        for t in exact.tasks:
            self.assertEqual(set(t.pred), set(t.mods_nc))
        half = sim.Sim(base(recall=0.5, precision=1.0, agents=40), "beanstalk", 2)
        kept = sum(len(set(t.pred) & t.mods_nc) for t in half.tasks)
        total = sum(len(t.mods_nc) for t in half.tasks)
        self.assertAlmostEqual(kept / total, 0.5, delta=0.05)
        noisy = sim.Sim(base(recall=0.8, precision=0.5, agents=40), "beanstalk", 2)
        tp = sum(len(set(t.pred) & t.mods_nc) for t in noisy.tasks)
        npred = sum(len(t.pred) for t in noisy.tasks)
        self.assertAlmostEqual(tp / npred, 0.5, delta=0.06)

    def test_footprint_stats_are_consistent(self):
        st = sim.footprint_stats(base(), n_tasks=600)
        for key in ("raw", "drivers"):
            shares = st[key]["class_share"]
            self.assertAlmostEqual(sum(shares.values()), 1.0, places=3)
            for v in st[key]["rate_by_class"].values():
                self.assertTrue(0.0 <= v <= 1.0)
        self.assertLessEqual(st["drivers"]["pair_conflict_rate"], st["raw"]["pair_conflict_rate"])

    def test_empirical_footprint_model(self):
        fp = {"model": "empirical", "zipf_s": 1.1, "block_len": 5,
              "modules": [{"name": "M1", "size": 50}, {"name": "M2", "size": 10, "diss_ranks": [0]},
                          {"name": "M3", "size": 200, "commutative": True}],
              "changes": [[[0, 3], [1, 1]], [[0, 2]], [[2, 1], [0, 1]], [[1, 2]]]}
        s = sim.Sim(base(footprint=fp), "beanstalk", 1)
        for t in s.tasks:
            self.assertTrue(t.mods)
            self.assertNotIn(2, t.mods_nc)          # commutative module never counts for placement
        r = s.run()
        self.assertTrue(r["complete"])

    def test_set_overrides(self):
        p = sim.apply_sets(base(), ["q_sem=0.2", "footprint.zipf_s=1.3", "snapshot=green"])
        self.assertEqual(p["q_sem"], 0.2)
        self.assertEqual(p["footprint"]["zipf_s"], 1.3)
        self.assertEqual(p["snapshot"], "green")
        self.assertTrue(math.isfinite(sim.run_one(p, "beanstalk", 0)["green_per_h"]))


if __name__ == "__main__":
    unittest.main()
