import json
import os
import tempfile
import unittest

import helpers  # noqa: F401
import evaluate_pairs as EP


def pred(seq, actual, combined):
    return seq, {"seq": seq, "actual_modules": actual, "pred": {"combined": combined, "prior": {"A": 0.9}}}


PREDS = dict([
    pred(10, ["A"], {"A": 0.9, "B": 0.2}),
    pred(11, ["A", "B"], {"A": 0.8, "B": 0.6}),
    pred(12, ["C"], {"C": 0.7, "A": 0.15}),
    pred(13, ["B", "D"], {"B": 0.9, "D": 0.1}),
    pred(14, [".changeset", "E"], {".changeset": 0.95, "E": 0.5}),
    pred(15, [".changeset", "F"], {".changeset": 0.95, "F": 0.5}),
])


def pair(a, b, result, shared_files=(), dissolvable_only=False):
    return {"corpus": "toy", "window": 0, "a": f"toy#{a}", "b": f"toy#{b}", "a_seq": a, "b_seq": b, "result": result,
            "overlap_class": "file" if shared_files else "disjoint", "shared_files": list(shared_files), "shared_modules": [],
            "conflict_files": [], "dissolvable_only": dissolvable_only}


PAIRS = [
    pair(10, 11, "conflict", ["x"]),                       # out of scope: seq 10 is not in the evaluation slice
    pair(11, 12, "clean"),
    pair(11, 13, "conflict", ["pkg/b.ts"]),
    pair(12, 13, "clean"),
    pair(12, 14, "clean"),
    pair(13, 15, "clean"),
    pair(14, 15, "conflict", [".changeset/shared.md"], dissolvable_only=True),
    pair(11, 14, "entangled", ["z"]),                      # excluded from every rate, counted
    pair(12, 15, "error"),                                 # excluded, counted
]


class PairFlaggingTests(unittest.TestCase):
    def run_eval(self, **kw):
        return EP.evaluate(PAIRS, PREDS, eval_start=11, restrict_eval=True, methods=["combined", "prior"], tuned={"combined": 0.5},
                           dissolvable_modules=[".changeset"], thresholds=[0.5], topk=[1], **kw)

    def test_counts_exclude_entangled_and_errors(self):
        c = self.run_eval()["counts"]
        self.assertEqual(c["pairs_in_scope"], 6)
        self.assertEqual((c["conflict"], c["clean"]), (2, 4))
        self.assertEqual(c["conflict_after_drivers"], 1)
        self.assertEqual((c["entangled"], c["error"], c["out_of_scope"]), (1, 1, 1))

    def test_threshold_rates_all_modules(self):
        res = self.run_eval()
        raw = res["views"]["all"]["methods"]["combined"]["thresholds"][0]["raw"]
        self.assertAlmostEqual(raw["conflict_recall"], 1.0)
        self.assertAlmostEqual(raw["clean_flag_rate"], 0.0)
        self.assertAlmostEqual(raw["flag_precision"], 1.0)
        self.assertAlmostEqual(raw["lift"], 3.0)           # base rate 2/6
        after = res["views"]["all"]["methods"]["combined"]["thresholds"][0]["after_drivers"]
        self.assertAlmostEqual(after["conflict_recall"], 1.0)
        self.assertAlmostEqual(after["clean_flag_rate"], 1 / 5)   # the dissolvable-only conflict counts as clean
        self.assertAlmostEqual(after["flag_precision"], 0.5)
        self.assertAlmostEqual(after["lift"], 3.0)         # base rate 1/6

    def test_substantive_view_ignores_dissolvable_only_modules(self):
        res = self.run_eval()
        raw = res["views"]["substantive"]["methods"]["combined"]["thresholds"][0]["raw"]
        self.assertAlmostEqual(raw["conflict_recall"], 0.5)   # the changeset-only overlap is no longer a flag
        self.assertAlmostEqual(raw["flag_precision"], 1.0)
        after = res["views"]["substantive"]["methods"]["combined"]["thresholds"][0]["after_drivers"]
        self.assertAlmostEqual(after["conflict_recall"], 1.0)
        self.assertAlmostEqual(after["clean_flag_rate"], 0.0)
        self.assertAlmostEqual(after["lift"], 6.0)

    def test_topk_and_tuned_threshold(self):
        res = self.run_eval()
        top1 = res["views"]["all"]["methods"]["combined"]["topk"][0]["raw"]
        self.assertAlmostEqual(top1["conflict_recall"], 0.5)   # top-1 of 11 is A, of 13 is B: (11,13) is missed
        self.assertAlmostEqual(top1["clean_flag_rate"], 0.0)
        tuned = res["views"]["all"]["methods"]["combined"]["tuned"]
        self.assertEqual(tuned["threshold"], 0.5)
        self.assertIsNone(res["views"]["all"]["methods"]["prior"]["tuned"])

    def test_flat_summary_has_the_contract_shape(self):
        s = self.run_eval()["summary"]
        row = s["all"]["combined"][0]
        self.assertEqual(row["threshold"], 0.5)
        self.assertAlmostEqual(row["conflict_recall"], 1.0)
        self.assertAlmostEqual(row["clean_flag_rate"], 0.0)
        self.assertAlmostEqual(row["conflict_recall_after_drivers"], 1.0)
        self.assertAlmostEqual(row["clean_flag_rate_after_drivers"], 0.2)
        self.assertEqual(s["all"]["combined:topk"][0]["k"], 1)
        self.assertIn("oracle_module", s["substantive"])

    def test_oracles(self):
        res = self.run_eval()
        om = res["views"]["all"]["oracle_module"]["raw"]
        self.assertAlmostEqual(om["conflict_recall"], 1.0)
        self.assertAlmostEqual(om["clean_flag_rate"], 0.0)
        of = res["views"]["all"]["oracle_file"]["raw"]
        self.assertAlmostEqual(of["conflict_recall"], 1.0)
        self.assertAlmostEqual(of["flag_precision"], 1.0)
        som = res["views"]["substantive"]["oracle_module"]["raw"]
        self.assertAlmostEqual(som["conflict_recall"], 0.5)

    def test_a_predictor_that_flags_every_pair_has_lift_one(self):
        res = self.run_eval()
        raw = res["views"]["all"]["methods"]["prior"]["thresholds"][0]["raw"]   # the stub prior predicts {A} for every change
        self.assertAlmostEqual(raw["flagged_share"], 1.0)
        self.assertAlmostEqual(raw["conflict_recall"], 1.0)
        self.assertAlmostEqual(raw["clean_flag_rate"], 1.0)
        self.assertAlmostEqual(raw["lift"], 1.0)

    def test_all_pairs_flag_includes_out_of_scope(self):
        res = EP.evaluate(PAIRS, PREDS, 11, False, ["combined"], {}, [".changeset"], [0.5], [1])
        self.assertEqual(res["counts"]["out_of_scope"], 0)
        self.assertEqual(res["counts"]["conflict"], 3)

    def test_run_reads_files_and_updates_metrics(self):
        with tempfile.TemporaryDirectory() as tmp:
            d = os.path.join(tmp, "toy")
            os.makedirs(d)
            with open(os.path.join(d, "predictions.jsonl"), "w") as fh:
                for s, r in PREDS.items():
                    fh.write(json.dumps({"id": f"toy#{s}", **r}) + "\n")
            metrics = {"corpus": "toy", "eval_range": [11, 16], "dissolvable_only_modules": [".changeset"],
                       "methods": {"combined": {"threshold": 0.5}}, "n_changes": 6, "burn_in": 1, "tune_range": [1, 11]}
            with open(os.path.join(d, "metrics.json"), "w") as fh:
                json.dump(metrics, fh)
            pairs_path = os.path.join(tmp, "pairs.jsonl")
            with open(pairs_path, "w") as fh:
                fh.write("\n".join(json.dumps(p) for p in PAIRS) + "\n")
            res = EP.run("toy", pairs_path=pairs_path, out_base=tmp, update_metrics=False)
            self.assertTrue(os.path.exists(os.path.join(d, "pair_flagging.json")))
            self.assertTrue(os.path.exists(os.path.join(d, "pair_flagging.md")))
            self.assertEqual(res["counts"]["entangled"], 1)
            md = EP.render_markdown(res)
            self.assertIn("entangled", md)
            self.assertIn("oracle: actual modules intersect", md)

    def test_missing_pairs_file_is_a_clear_error(self):
        with tempfile.TemporaryDirectory() as tmp:
            with self.assertRaises(SystemExit) as cm:
                EP.run("toy", pairs_path=os.path.join(tmp, "nope.jsonl"), out_base=tmp)
            self.assertIn("step 1", str(cm.exception))

    def test_private_corpus_default_paths(self):
        self.assertIn(os.path.join("out", "private", "platform", "pairs.jsonl"), EP.default_pairs_path("platform"))
        self.assertTrue(EP.default_out_dir("platform").endswith(os.path.join("out", "private", "platform")))
        self.assertNotIn("private", EP.default_pairs_path("codex"))


if __name__ == "__main__":
    unittest.main()
