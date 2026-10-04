"""calibrate.py against hand-made step 1 / step 2 outputs that follow the README contract."""
from __future__ import annotations

import json
import os
import random
import shutil
import sys
import tempfile
import unittest

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, os.path.dirname(HERE))

import calibrate  # noqa: E402
import sim  # noqa: E402

SUMMARY = {
    "corpus": "fake", "window_size": 10, "windows": 6, "changes": 60, "eligible": 55,
    "dependency_rate": 0.08, "pairs": 400, "conflict_rate": 0.025,
    "by_overlap_class": {
        "file": {"pairs": 40, "conflicts": 8, "rate": 0.2},
        "module": {"pairs": 120, "conflicts": 2, "rate": 0.016667},
        "disjoint": {"pairs": 240, "conflicts": 0, "rate": 0.0},
    },
    "dissolvable_share": 0.3, "conflict_rate_after_drivers": 0.0175,
    "category_share": {"source": 0.7, "lockfile": 0.2, "changelog": 0.1},
    "module_concentration": {"top1_share": 0.5, "top3_share": 0.9, "hhi": 0.35},
    "max_compatible_batch": {"mean": 7.2, "p50": 7},
    "entangled_rate": 0.0125,
    "per_change_collision_rate": {"10": 0.15, "20": 0.25, "50": 0.4},
    "p_collision_among_n": {"5": {"raw": 0.1, "after_drivers": 0.08}, "20": {"raw": 0.35, "after_drivers": 0.3}},
    "top_modules": {"packages/secret-billing": 0.4},      # a name-bearing field private output must drop
}

METRICS = {
    "methods": {
        "cochange": {"threshold": 0.3, "recall": 0.72, "precision": 0.5, "f1": 0.59,
                     "topk": {"k": 3, "recall": 0.8, "precision": 0.4, "f1": 0.533}},
        "lexical": {"threshold": 0.2, "recall": 0.65, "precision": 0.62, "f1": 0.635},
    },
    "pair_flagging": {"lexical": {"0.2": {"conflict_recall": 0.8, "clean_flag_rate": 0.3}},
                      "cochange": {"0.3": {"conflict_recall": 0.85, "clean_flag_rate": 0.45}}},
}

MODULES = ["packages/a", "packages/b", "packages/c", ".changeset", "(root)"]


def make_corpus(rng: random.Random, n: int = 60) -> list[dict]:
    out = []
    for i in range(n):
        files = []
        mods = rng.sample(MODULES[:3], rng.randint(1, 2))
        for m in mods:
            for _ in range(rng.randint(1, 3)):
                files.append({"path": f"{m}/src/f{rng.randint(0, 12)}.ts", "module": m, "category": "source"})
        if rng.random() < 0.6:
            files.append({"path": f".changeset/c{i}.md", "module": ".changeset", "category": "changelog"})
        if rng.random() < 0.3:
            files.append({"path": "pnpm-lock.yaml", "module": "(root)", "category": "lockfile"})
        seen = set()
        files = [f for f in files if not (f["path"] in seen or seen.add(f["path"]))]
        out.append({"id": f"fake#{i}", "seq": i, "files": files,
                    "modules": sorted({f["module"] for f in files})})
    return out


def make_pairs(rng: random.Random) -> list[dict]:
    pairs = []
    for i in range(40):                       # file class: 8 conflicts, 2 of them only in the lockfile
        shared = [f"packages/a/src/f{i % 5}.ts"] + (["pnpm-lock.yaml"] if i % 4 == 0 else [])
        res = "conflict" if i < 8 else "clean"
        conf = []
        if res == "conflict":
            conf = ([{"path": "pnpm-lock.yaml", "module": "(root)", "category": "lockfile"}] if i < 2 else
                    [{"path": shared[0], "module": "packages/a", "category": "source"}])
        pairs.append({"result": res, "overlap_class": "file", "shared_files": shared,
                      "shared_modules": ["packages/a"], "conflict_files": conf,
                      "dissolvable_only": i < 2})
    for i in range(120):
        pairs.append({"result": "conflict" if i < 2 else "clean", "overlap_class": "module",
                      "shared_files": [], "shared_modules": ["packages/b"], "conflict_files": [],
                      "dissolvable_only": False})
    for i in range(240):
        pairs.append({"result": "clean", "overlap_class": "disjoint", "shared_files": [],
                      "shared_modules": [], "conflict_files": [], "dissolvable_only": False})
    for i in range(5):
        pairs.append({"result": "entangled", "overlap_class": "file", "shared_files": ["x"],
                      "shared_modules": [], "conflict_files": [], "dissolvable_only": False})
    rng.shuffle(pairs)
    return pairs


class TestCalibrate(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.mkdtemp(prefix="calib-")
        rng = random.Random(1)
        self.step1 = os.path.join(self.tmp, "step1")
        self.step2 = os.path.join(self.tmp, "step2")
        os.makedirs(self.step1)
        os.makedirs(self.step2)
        with open(os.path.join(self.step1, "summary.json"), "w") as fh:
            json.dump(SUMMARY, fh)
        with open(os.path.join(self.step1, "pairs.jsonl"), "w") as fh:
            for p in make_pairs(rng):
                fh.write(json.dumps(p) + "\n")
        with open(os.path.join(self.step2, "metrics.json"), "w") as fh:
            json.dump(METRICS, fh)
        self.corpus = os.path.join(self.tmp, "corpus.jsonl")
        changes = make_corpus(rng)
        with open(self.corpus, "w") as fh:
            for c in changes:
                fh.write(json.dumps(c) + "\n")
        with open(os.path.join(self.step2, "predictions.jsonl"), "w") as fh:
            for c in changes:
                probs = {m: (0.9 if m in c["modules"] else 0.05) for m in MODULES}
                probs["packages/unknown"] = 0.5
                fh.write(json.dumps({"id": c["id"], "seq": c["seq"],
                                     "split": "eval" if c["seq"] >= 30 else "tune",
                                     "actual_modules": c["modules"], "pred": {"lexical": probs}}) + "\n")

    def tearDown(self):
        shutil.rmtree(self.tmp)

    def run_cal(self, *extra) -> dict:
        out = os.path.join(self.tmp, *(("private",) if "--private" in extra else ()), "fake.json")
        args = ["--corpus", "fake", "--step1", self.step1, "--step2", self.step2,
                "--corpus-file", self.corpus, "--out", out, "--check-tasks", "300", *extra]
        self.assertEqual(calibrate.main(args), 0)
        with open(out) as fh:
            return json.load(fh)

    def test_rates_and_prediction(self):
        p = self.run_cal("--public")
        self.assertAlmostEqual(p["p_file"], 0.2)
        self.assertAlmostEqual(p["p_module"], 0.016667)
        self.assertEqual(p["p_disjoint"], 0.0)
        self.assertAlmostEqual(p["dissolvable_share"], 0.3)
        self.assertAlmostEqual(p["dependency_rate"], 0.08)
        self.assertEqual(p["dep_window"], 10)
        # best F1 at the chosen threshold is 'lexical'
        self.assertAlmostEqual(p["recall"], 0.65)
        self.assertAlmostEqual(p["precision"], 0.62)
        self.assertIn("lexical", p["calibration"]["measured"]["pair_flagging"])
        # per-file model fitted from pairs.jsonl, entangled pairs excluded
        self.assertEqual(p["conflict_model"], "per_file")
        self.assertTrue(0.0 < p["p_per_file"] < 1.0)
        self.assertTrue(0.0 < p["p_per_file_diss"] < 1.0)
        pj = p["calibration"]["measured"]["pairs_jsonl"]
        self.assertEqual(pj["pairs"], 400)
        # the model's semantic sweep default is kept when step 1 ran no semantic check
        self.assertEqual(p["q_sem"], sim.load_params(os.path.join(os.path.dirname(HERE), "params", "default.json"))["q_sem"])

    def test_empirical_predictions(self):
        p = self.run_cal("--public")
        self.assertEqual(p["prediction_model"], "empirical")
        pred = p["footprint"]["predicted"]
        self.assertEqual(len(pred), len(p["footprint"]["changes"]))
        self.assertEqual(sum(1 for x in pred if x is not None), 30)       # eval split only
        names = [m["name"] for m in p["footprint"]["modules"]]
        for x, ch in zip(pred, p["footprint"]["changes"]):
            if x is not None:      # threshold 0.2 keeps the touched modules, drops 0.05 ones
                self.assertEqual(sorted(x), sorted(m for m, _ in ch))
        s = sim.Sim(p | {"agents": 4}, "beanstalk", 0)
        self.assertTrue(all(set(t.pred) <= set(t.mods_nc) for t in s.tasks))
        self.assertNotIn(names.index(".changeset"), {m for t in s.tasks for m in t.pred})
        self.assertTrue(s.run()["complete"])
        q = sim.Sim(p | {"agents": 4, "prediction_model": "perturb", "recall": 1.0, "precision": 1.0},
                    "beanstalk", 0)
        self.assertTrue(all(set(t.pred) == set(t.mods_nc) for t in q.tasks))

    def test_per_file_fit_matches_pair_rate(self):
        p = self.run_cal("--public")
        # every non-dissolvable file pair here shares exactly one source file and 6 of 40 conflict on it
        self.assertAlmostEqual(p["p_per_file"], 6 / 40, places=4)

    def test_footprints_public(self):
        p = self.run_cal("--public")
        fp = p["footprint"]
        self.assertEqual(fp["model"], "empirical")
        names = [m["name"] for m in fp["modules"]]
        self.assertIn("packages/a", names)
        cs = [m for m in fp["modules"] if m["name"] == ".changeset"][0]
        self.assertTrue(cs["commutative"])
        root = [m for m in fp["modules"] if m["name"] == "(root)"][0]
        self.assertEqual(root["diss_ranks"], [0])
        self.assertEqual(len(fp["changes"]), 60)
        self.assertEqual(fp["block_len"], 10)
        self.assertTrue(0.2 <= fp["zipf_s"] <= 3.0)
        self.assertIn("zipf_fit", p["calibration"]["measured"])
        r = sim.run_one(p | {"agents": 5}, "beanstalk", 0)
        self.assertTrue(r["complete"])

    def test_private_anonymises(self):
        p = self.run_cal("--private")
        names = [m["name"] for m in p["footprint"]["modules"]]
        self.assertEqual(names, [f"M{i + 1}" for i in range(len(names))])
        blob = json.dumps(p)
        for m in ("packages/a", "packages/b", ".changeset", "secret-billing"):
            self.assertNotIn(m, blob)
        self.assertTrue(p["calibration"]["private"])
        with self.assertRaises(SystemExit):
            calibrate.main(["--corpus", "fake", "--private", "--step1", self.step1, "--step2", self.step2,
                            "--corpus-file", self.corpus, "--out", os.path.join(self.tmp, "leak.json"),
                            "--check-tasks", "300"])

    def test_class_model_without_pairs(self):
        os.remove(os.path.join(self.step1, "pairs.jsonl"))
        p = self.run_cal("--public")
        self.assertEqual(p["conflict_model"], "class")
        self.assertTrue(sim.run_one(p | {"agents": 5}, "batched", 0)["complete"])

    def test_semantic_check_sets_q_sem(self):
        with open(os.path.join(self.step1, "summary.json"), "w") as fh:
            json.dump(SUMMARY | {"semantic": {"pairs_checked": 200, "clean_but_broken": 6, "rate": 0.03}}, fh)
        self.assertAlmostEqual(self.run_cal("--public")["q_sem"], 0.03)

    def test_recall_precision_shapes(self):
        flat = {"cochange": {"recall": 0.7, "precision": 0.4}, "text": {"recall": 0.6, "precision": 0.7}}
        self.assertEqual(calibrate.find_recall_precision(flat)["path"], "text")
        self.assertEqual(calibrate.find_recall_precision(flat, method="cochange")["recall"], 0.7)
        topk = calibrate.find_recall_precision(METRICS, operating_point="topk")
        self.assertIn("cochange", topk["path"])
        self.assertIsNone(calibrate.find_recall_precision({"x": 1}))

    def test_step2_layout(self):
        """The layout footprint-prediction actually writes: methods.<m> with breakdowns."""
        m = {"headline": {"variant": "title"},
             "methods": {"prior": {"threshold": 0.13, "precision": 0.28, "recall": 0.40, "f1": 0.33,
                                   "by_size": [{"precision": 0.9, "recall": 0.9, "f1": 0.9}]},
                         "combined": {"threshold": 0.24, "precision": 0.53, "recall": 0.47, "f1": 0.50,
                                      "at_recall": {"0.6": {"threshold": 0.15, "precision": 0.43,
                                                            "recall": 0.58, "f1": 0.49}},
                                      "top_k": {"k": 3, "precision": 0.42, "recall": 0.52, "f1": 0.47}}},
             "methods_title_body": {"combined": {"threshold": 0.28, "precision": 0.72, "recall": 0.54,
                                                 "f1": 0.62}},
             "pair_flagging": {"views": {"all": {"methods": {"combined": {"thresholds": [
                 {"threshold": 0.1, "raw": {"conflict_recall": 0.9, "clean_flag_rate": 0.5}},
                 {"threshold": 0.25, "raw": {"conflict_recall": 0.7, "clean_flag_rate": 0.3}}]}}}}}}
        best = calibrate.find_recall_precision(m)
        self.assertEqual(best["path"], "methods/combined")          # not the by_size bucket
        self.assertAlmostEqual(best["recall"], 0.47)
        at = calibrate.find_recall_precision(m, operating_point="recall:0.6")
        self.assertAlmostEqual(at["recall"], 0.58)
        body = calibrate.find_recall_precision(m, variant="methods_title_body")
        self.assertAlmostEqual(body["precision"], 0.72)
        flag = calibrate.find_pair_flagging(m, "combined", 0.24)
        self.assertAlmostEqual(flag["raw"]["conflict_recall"], 0.7)

    def test_solve_per_file(self):
        self.assertAlmostEqual(calibrate.solve_per_file([(1, 1), (1, 0), (1, 0), (1, 0)]), 0.25, places=6)
        self.assertEqual(calibrate.solve_per_file([(2, 0), (1, 0)]), 0.0)
        self.assertIsNone(calibrate.solve_per_file([(0, 1)]))


if __name__ == "__main__":
    unittest.main()
