import copy
import json
import os
import tempfile
import unittest

import helpers
import predict as PR
import predictor as P


class MetricTests(unittest.TestCase):
    def test_prf(self):
        r = PR.prf(3, 1, 2)
        self.assertAlmostEqual(r["precision"], 0.75)
        self.assertAlmostEqual(r["recall"], 0.6)
        self.assertAlmostEqual(r["f1"], 2 * 3 / (2 * 3 + 1 + 2))
        self.assertEqual(PR.prf(0, 0, 0), {"precision": 0.0, "recall": 0.0, "f1": 0.0})

    def test_evaluate_sets_micro_and_per_change(self):
        pred = [{"a", "b"}, {"c"}, set()]
        actual = [{"a"}, {"c", "d"}, {"e"}]
        r = PR.evaluate_sets(pred, actual)
        self.assertEqual((r["micro"]["tp"], r["micro"]["fp"], r["micro"]["fn"]), (2, 1, 2))
        self.assertAlmostEqual(r["micro"]["precision"], 2 / 3)
        self.assertAlmostEqual(r["micro"]["recall"], 0.5)
        # per change: (P,R) = (0.5,1), (1,0.5), (0,0) -> empty predictions count as precision 0
        self.assertAlmostEqual(r["per_change"]["precision"], 0.5)
        self.assertAlmostEqual(r["per_change"]["recall"], 0.5)
        self.assertAlmostEqual(r["per_change"]["coverage"], 2 / 3)

    def test_best_threshold(self):
        pairs = [(0.9, 1), (0.8, 1), (0.7, 0), (0.4, 1), (0.3, 0), (0.1, 0)]
        thr, f1 = PR.best_threshold(pairs, total_pos=3)
        self.assertAlmostEqual(thr, 0.4)       # {0.9,0.8,0.7,0.4}: tp 3, fp 1 -> F1 = 6/7
        self.assertAlmostEqual(f1, 6 / 7)
        # positives never scored count against recall
        thr, f1 = PR.best_threshold(pairs, total_pos=4)
        self.assertAlmostEqual(f1, 6 / (6 + 1 + 1))

    def test_ties_are_taken_together(self):
        thr, f1 = PR.best_threshold([(0.5, 1), (0.5, 0), (0.2, 0)], total_pos=1)
        self.assertAlmostEqual(thr, 0.5)
        self.assertAlmostEqual(f1, 2 / 3)

    def test_recall_at_and_hit(self):
        probs = [{"a": 0.9, "b": 0.8, "c": 0.1}, {"x": 0.5, "y": 0.4}]
        actual = [{"b", "c"}, {"z"}]
        r = PR.recall_at(probs, actual, ks=(1, 2))
        self.assertAlmostEqual(r["1"]["micro"], 0.0)
        self.assertAlmostEqual(r["2"]["micro"], 1 / 3)           # only b found among 3 actual modules
        self.assertAlmostEqual(r["2"]["per_change"], 0.25)
        self.assertAlmostEqual(r["2"]["hit"], 0.5)

    def test_choose_topk_maximises_f1(self):
        probs = [{"a": 0.9, "b": 0.5, "c": 0.4}] * 4
        actual = [{"a", "b"}] * 4
        self.assertEqual(PR.choose_topk(probs, actual), 2)

    def test_operating_points_and_calibration_table(self):
        probs = [{"a": 0.9, "b": 0.12}, {"a": 0.6, "c": 0.3}]
        actual = [{"a"}, {"c"}]
        pts = PR.operating_points(probs, actual)
        self.assertEqual([p["threshold"] for p in pts], list(PR.OPERATING_THRESHOLDS))
        at_half = [p for p in pts if p["threshold"] == 0.5][0]
        self.assertAlmostEqual(at_half["precision"], 0.5)        # predicted {a},{a}: one right
        self.assertAlmostEqual(at_half["recall"], 0.5)
        cal = PR.calibration_table(probs, actual, bins=2)
        self.assertEqual(cal["pairs"], 4)
        self.assertEqual(sum(b["n"] for b in cal["bins"]), 4)

    def test_by_size_buckets(self):
        sets = [{"a"}, {"a"}, {"a", "b"}]
        actual = [{"a"}, {"a", "b"}, {"a", "b", "c", "d", "e"}]
        rows = {r["modules"]: r for r in PR.by_size(sets, actual)}
        self.assertEqual(rows["1"]["n_changes"], 1)
        self.assertEqual(rows["2-3"]["n_changes"], 1)
        self.assertAlmostEqual(rows["2-3"]["recall"], 0.5)
        self.assertEqual(rows["4-8"]["n_changes"], 1)

    def test_paired_bootstrap_detects_a_clear_difference(self):
        n = 120
        actual = [{"m1"} for _ in range(n)]
        good = [{"m1": 0.9, "m2": 0.1} for _ in range(n)]
        bad = [{"m2": 0.9, "m1": 0.1} for _ in range(n)]
        kept = {"good": dict(thr_sets=[{"m1"}] * n, probs=good, actual=actual),
                "prior": dict(thr_sets=[{"m2"}] * n, probs=bad, actual=actual)}
        out = PR.paired_bootstrap(kept, "good", "prior", reps=50)
        self.assertAlmostEqual(out["recall_at_1"]["diff"], 1.0)
        self.assertGreater(out["f1"]["ci95"][0], 0.5)


class TreeAndPipelineTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.tmp = tempfile.TemporaryDirectory()
        cls.repo = helpers.make_repo(os.path.join(cls.tmp.name, "repo"), n_commits=110)
        cls.corpus_path = os.path.join(cls.tmp.name, "corpus.jsonl")
        cls.records = helpers.make_corpus(cls.repo, cls.corpus_path)
        cls.roots = PR.package_roots(cls.repo, "main")

    @classmethod
    def tearDownClass(cls):
        cls.tmp.cleanup()

    def test_corpus_drops_bot_commits_but_the_chain_keeps_them(self):
        n_commits = int(helpers.git(self.repo, "rev-list", "--count", "--first-parent", "main").strip())
        self.assertLess(len(self.records), n_commits - 1)
        shas = {r["sha"] for r in self.records}
        parents = {r["parent"] for r in self.records}
        self.assertTrue(parents - shas, "some parents must be commits that are not corpus changes (bots / root)")

    def test_tree_tracker_equals_ls_tree_at_every_parent(self):
        tracker = PR.TreeTracker(self.repo, self.records, self.roots)
        pred = P.Predictor({})
        PR.apply_events(pred, tracker.initial_events())
        for k, rec in enumerate(self.records):
            PR.apply_events(pred, tracker.advance_to(rec["parent"]))
            truth = {p for p in helpers.git(self.repo, "ls-tree", "-r", "--name-only", rec["parent"]).splitlines() if p}
            self.assertEqual(set(pred.catalog.file_module), truth, f"change {k}")
            # and every tracked file is in exactly one module known to the lexical index
            self.assertEqual(set(pred.catalog.module_files), set(pred.lex.modules))

    def test_final_pass_is_time_respecting(self):
        """Predictions for change k may use only changes before k: rewriting the labels of changes >= K must not move
        the predictions for changes <= K, and rewriting the text of changes > K must not either."""
        params = {"prior_window": 30, "prior_halflife": 10.0, "knn_k": 5, "knn_power": 1.0, "knn_lambda": 0.3}
        K = 60
        base_rows, _ = PR.final_pass(self.records, self.repo, self.roots, params, use_body=True)

        relabelled = copy.deepcopy(self.records)
        for r in relabelled[K:]:
            r["modules"] = ["pkg/ui", "invented/module"]
            for f in r["files"]:
                f["module"] = "invented/module"
        rows, _ = PR.final_pass(relabelled, self.repo, self.roots, params, use_body=True)
        for k in range(K + 1):  # change K is predicted before its own labels are known
            self.assertEqual(base_rows[k]["cands"], rows[k]["cands"], f"prediction for change {k} used future labels")
        self.assertNotEqual(base_rows[K + 5]["cands"], rows[K + 5]["cands"])

        retitled = copy.deepcopy(self.records)
        for r in retitled[K + 1:]:
            r["title"] = "completely different words about zebras " + r["title"]
            r["body"] = "zebra stripes " + r["body"]
        rows, _ = PR.final_pass(retitled, self.repo, self.roots, params, use_body=True)
        for k in range(K + 1):
            self.assertEqual(base_rows[k]["cands"], rows[k]["cands"], f"prediction for change {k} used future text")
        self.assertNotEqual(base_rows[K + 5]["cands"], rows[K + 5]["cands"])

    def test_lag_withholds_the_most_recent_changes(self):
        """With lag L a change's history stops L changes before it: relabelling changes >= K-L must not move predictions <= K."""
        params = {"prior_window": 30, "prior_halflife": 10.0, "knn_k": 5, "knn_power": 1.0, "knn_lambda": 0.3}
        K, L = 60, 7
        base, _ = PR.final_pass(self.records, self.repo, self.roots, params, use_body=False, lag=L)
        relabelled = copy.deepcopy(self.records)
        for r in relabelled[K - L:]:
            r["modules"] = ["pkg/ui", "invented/module"]
            for f in r["files"]:
                f["module"] = "invented/module"
        rows, _ = PR.final_pass(relabelled, self.repo, self.roots, params, use_body=False, lag=L)
        for k in range(K + 1):
            self.assertEqual(base[k]["cands"], rows[k]["cands"], f"prediction for change {k} saw an in-flight change")
        self.assertNotEqual(base[K + 1]["cands"], rows[K + 1]["cands"])
        # and with lag 0 the very next change does see the previous one
        no_lag, _ = PR.final_pass(self.records, self.repo, self.roots, params, use_body=False, lag=0)
        self.assertNotEqual(no_lag[K]["cands"], base[K]["cands"])

    def test_tune_is_time_respecting_and_returns_params(self):
        records = self.records
        n_tune = len(records) // 2
        a, _ = PR.tune(records, self.repo, self.roots, n_tune, False, PR.QUICK_GRID, 1, burn=5)
        mutated = copy.deepcopy(records)
        for r in mutated[n_tune:]:
            r["modules"] = ["invented/module"]
        b, _ = PR.tune(mutated, self.repo, self.roots, n_tune, False, PR.QUICK_GRID, 1, burn=5)
        self.assertEqual(a, b)
        for key in ("prior_window", "lex_name_weight", "knn_k", "co_kappa"):
            self.assertIn(key, a)

    def test_end_to_end_outputs(self):
        out = os.path.join(self.tmp.name, "out")
        metrics = PR.run_corpus("toy", self.corpus_path, self.repo, False, out, seed=1, quick=True, variants=["title", "title_body"],
                                jev_sample=(5, 12), limit=None, verify=8, module_depth=None, tune_stride=None)
        d = os.path.join(out, "toy")
        for f in ("predictions.jsonl", "metrics.json", "metrics.md", "fit.json", "jev_inputs.jsonl"):
            self.assertTrue(os.path.exists(os.path.join(d, f)), f)
        with open(os.path.join(d, "predictions.jsonl")) as fh:
            lines = [json.loads(line) for line in fh]
        self.assertEqual(len(lines), len(self.records))
        first = lines[-1]
        self.assertEqual(set(first), {"id", "seq", "split", "actual_modules", "pred"})
        for m in ("prior", "lexical", "knn", "cochange", "combined", "combined+body"):
            self.assertIn(m, first["pred"])
        self.assertTrue(all(0.0 <= p <= 1.0 for probs in first["pred"].values() for p in probs.values()))
        self.assertEqual(lines[0]["split"], "tune")
        self.assertEqual(lines[-1]["split"], "eval")
        with open(os.path.join(d, "metrics.json")) as fh:
            saved = json.load(fh)
        for m in ("prior", "lexical", "knn", "cochange", "combined"):
            r = saved["methods"][m]
            for key in ("precision", "recall", "f1", "threshold", "top_k", "recall_at", "per_change", "micro"):
                self.assertIn(key, r)
            for k in ("1", "3", "5"):
                self.assertIn(k, r["recall_at"])
        self.assertIn("methods_title_body", saved)
        self.assertEqual(saved["eval_range"][1], len(self.records))
        # Jev inputs: 30 (or fewer) shuffled-later candidates with files, sampled from the right slices
        with open(os.path.join(d, "jev_inputs.jsonl")) as fh:
            items = [json.loads(line) for line in fh]
        self.assertEqual(sum(1 for i in items if i["split"] == "eval"), 12)
        self.assertEqual(sum(1 for i in items if i["split"] == "tune"), 5)
        self.assertTrue(all(len(i["candidates"]) <= 30 and i["candidates"] for i in items))
        self.assertTrue(all(i["seq"] >= saved["eval_range"][0] for i in items if i["split"] == "eval"))
        self.assertTrue(all(saved["tune_range"][0] <= i["seq"] < saved["tune_range"][1] for i in items if i["split"] == "tune"))
        self.assertIs(metrics["private"], False)

    def test_cli_main_with_explicit_data_and_repo(self):
        out = os.path.join(self.tmp.name, "out_cli")
        rc = PR.main(["toy", "--data", self.corpus_path, "--repo", self.repo, "--out", out, "--quick", "--variants", "title",
                      "--jev-sample", "0,0", "--verify-tree", "3"])
        self.assertEqual(rc, 0)
        self.assertTrue(os.path.exists(os.path.join(out, "toy", "metrics.md")))
        self.assertFalse(os.path.exists(os.path.join(out, "toy", "jev_inputs.jsonl")))

    def test_jev_flag_runs_the_client_after_the_other_methods(self):
        import jev_client
        from unittest import mock
        out = os.path.join(self.tmp.name, "out_jev")
        calls = []
        usage = {"answered": 0, "sampled_changes": 17, "failed_final": 3, "http_requests": 3, "estimated_cost_usd": 0.0}
        with mock.patch.object(jev_client, "run", side_effect=lambda *a, **k: calls.append(("run", a, k)) or {"fatal": {"status": 402, "error": "no credits"}}), \
                mock.patch.object(jev_client, "evaluate", side_effect=lambda *a, **k: calls.append(("evaluate", a, k)) or {"usage": usage}):
            rc = PR.main(["toy", "--data", self.corpus_path, "--repo", self.repo, "--out", out, "--quick", "--variants", "title",
                          "--jev-sample", "3,6", "--jev"])
        self.assertEqual(rc, 0)
        self.assertEqual([c[0] for c in calls], ["run", "evaluate"])
        self.assertTrue(os.path.exists(os.path.join(out, "toy", "jev_inputs.jsonl")))
        with self.assertRaises(SystemExit):
            PR.main(["toy", "--data", self.corpus_path, "--repo", self.repo, "--out", out, "--quick", "--jev-sample", "0,0", "--jev"])

    def test_granularity_and_lag_runs_write_into_subfolders(self):
        out = os.path.join(self.tmp.name, "out_sub")
        PR.run_corpus("toy", self.corpus_path, self.repo, True, out, seed=1, quick=True, variants=["title"], jev_sample=(0, 0),
                      limit=None, verify=0, module_depth=None, tune_stride=None, granularity=1, lag=5)
        sub = os.path.join(out, "private", "toy", "granularity-d1-lag5")
        self.assertTrue(os.path.exists(os.path.join(sub, "predictions.jsonl")))
        with open(os.path.join(sub, "predictions.jsonl")) as fh:
            first = json.loads(fh.readline())
        self.assertTrue(all("/" in m for m in first["actual_modules"] if m != "docs"))   # finer labels, e.g. pkg/auth/src
        with open(os.path.join(sub, "metrics.json")) as fh:
            m = json.load(fh)
        self.assertEqual((m["granularity"], m["lag"]), (1, 5))

    def test_private_corpora_write_under_out_private(self):
        out = os.path.join(self.tmp.name, "out_private")
        PR.run_corpus("toy", self.corpus_path, self.repo, True, out, seed=1, quick=True, variants=["title"], jev_sample=(0, 0),
                      limit=None, verify=0, module_depth=None, tune_stride=None)
        self.assertTrue(os.path.exists(os.path.join(out, "private", "toy", "predictions.jsonl")))
        self.assertFalse(os.path.exists(os.path.join(out, "toy")))

    def test_eval_slice_is_the_last_half(self):
        out = os.path.join(self.tmp.name, "out_split")
        m = PR.run_corpus("toy", self.corpus_path, self.repo, False, out, seed=1, quick=True, variants=["title"], jev_sample=(0, 0),
                          limit=None, verify=0, module_depth=None, tune_stride=None)
        n = len(self.records)
        self.assertEqual(m["eval_range"], [n // 2, n])
        self.assertLess(m["tune_range"][1], m["eval_range"][1])
        self.assertEqual(m["tune_range"][1], n // 2)




class GranularityTests(unittest.TestCase):
    def test_pseudo_module(self):
        f = PR.pseudo_module
        self.assertEqual(f("pkg/a/src/api/x.ts", "pkg/a", 0), "pkg/a")
        self.assertEqual(f("pkg/a/src/api/x.ts", "pkg/a", 1), "pkg/a/src")
        self.assertEqual(f("pkg/a/src/api/x.ts", "pkg/a", 2), "pkg/a/src/api")
        self.assertEqual(f("pkg/a/src/api/x.ts", "pkg/a", 9), "pkg/a/src/api")
        self.assertEqual(f("pkg/a/x.ts", "pkg/a", 2), "pkg/a")                 # file at the module root
        self.assertEqual(f("README.md", "(root)", 2), "(root)")
        self.assertEqual(f("scripts/build/x.sh", "(root)", 1), "scripts")
        self.assertEqual(f("scripts/build/x.sh", "(root)", 2), "scripts/build")
        self.assertEqual(f(".changeset/x.md", ".changeset", 2), ".changeset")

    def test_relabel_rewrites_modules_from_files(self):
        recs = [{"modules": ["pkg/a"], "files": [{"path": "pkg/a/src/x.ts", "module": "pkg/a"}, {"path": "pkg/a/test/y.ts", "module": "pkg/a"}]}]
        out = PR.relabel(recs, 1)
        self.assertEqual(out[0]["modules"], ["pkg/a/src", "pkg/a/test"])
        self.assertEqual(PR.relabel([{"modules": ["m"], "files": [{"path": "m/a/b.ts", "module": "m"}]}], 0)[0]["modules"], ["m"])


class HelpTests(unittest.TestCase):
    def test_every_script_has_help(self):
        import subprocess
        import sys
        for script in ("predict.py", "evaluate_pairs.py", "jev_client.py"):
            res = subprocess.run([sys.executable, os.path.join(helpers.ROOT, script), "--help"], capture_output=True, text=True)
            self.assertEqual(res.returncode, 0, script)
            self.assertIn("usage", res.stdout.lower(), script)


if __name__ == "__main__":
    unittest.main()
