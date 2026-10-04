import math
import os
import random
import tempfile
import unittest

import helpers  # noqa: F401  (sets sys.path)
import predictor as P


class TextTests(unittest.TestCase):
    def test_tokenize_splits_identifiers_and_drops_noise(self):
        toks = P.tokenize("Fix startDevWorker config_loader in packages/wrangler/src/api.ts (#123)")
        self.assertIn("start", toks)
        self.assertIn("dev", toks)
        self.assertIn("worker", toks)
        self.assertIn("config", toks)
        self.assertIn("loader", toks)
        self.assertIn("wrangler", toks)
        for dropped in ("fix", "src", "ts", "123", "in"):
            self.assertNotIn(dropped, toks)

    def test_stemmer_is_consistent_for_plurals(self):
        self.assertEqual(P.stem("tools"), P.stem("tool"))
        self.assertEqual(P.stem("queries"), "query")
        self.assertEqual(P.stem("status"), "status")
        self.assertEqual(P.stem("process"), "process")
        self.assertEqual(P.stem("caches"), "cache")

    def test_clean_body_strips_trailers_urls_comments_images(self):
        body = ("Summary of the change.\n<!-- hidden -->\nSee https://example.com/x for details ![img](http://a/b.png)\n"
                "Co-authored-by: Someone <s@example.com>\nGitOrigin-RevId: abcdef\n\U0001F916 Generated with Claude Code\nmail me at x@y.org")
        out = P.clean_body(body)
        self.assertIn("Summary of the change", out)
        for gone in ("hidden", "https://", "Co-authored", "GitOrigin", "Generated with", "x@y.org", "img"):
            self.assertNotIn(gone, out)

    def test_task_text_variants(self):
        self.assertEqual(P.task_text("Add thing (#42)", "body text", use_body=False), "Add thing")
        self.assertEqual(P.task_text("Add thing (#42)", "body text", use_body=True), "Add thing\nbody text")
        self.assertEqual(P.task_text("Add thing", "", use_body=True), "Add thing")

    def test_leading_tags(self):
        cases = {
            "fix(core): handle x": ["core"],
            "feat(tui, core)!: y": ["tui, core"],
            "[wrangler] Add z": ["wrangler"],
            "[workers-utils,miniflare,wrangler] Accept": ["workers-utils,miniflare,wrangler"],
            "[1/3] core: make world state": ["1/3", "core"],
            "tools: use esbuild": ["tools"],
            "fix: plain type": [],
            "Add REVIEW.md and update": [],
        }
        for title, tags in cases.items():
            self.assertEqual(P.leading_tags(title)[0], tags, title)

    def test_tag_keys_skip_numeric_and_split(self):
        self.assertEqual(P.tag_keys("[1/3] core: make"), ["core"])
        self.assertEqual(P.tag_keys("[workers-utils,miniflare] x"), ["worker util", "miniflare"])
        self.assertEqual(P.tag_keys("fix(core): a"), ["core"])
        self.assertEqual(P.tag_keys("no tag here"), [])


def toy_index(**kw):
    ix = P.LexicalIndex(**kw)
    tree = {
        "src/auth": ["src/auth/login.ts", "src/auth/session.ts", "src/auth/password.ts"],
        "src/billing": ["src/billing/invoice.ts", "src/billing/stripe.ts"],
        "src/api": ["src/api/routes.ts", "src/api/middleware.ts"],
    }
    for m, files in tree.items():
        for f in files:
            ix.add_file(f, m)
    ix.refresh()
    return ix


class LexicalTests(unittest.TestCase):
    def test_zero_history_ranks_the_matching_module_first(self):
        ix = toy_index()
        scores = ix.score(P.tokenize("rate limit the login endpoint"))
        self.assertEqual(max(scores, key=scores.get), "src/auth")
        scores = ix.score(P.tokenize("fix(billing): invoice rounding"))
        self.assertEqual(max(scores, key=scores.get), "src/billing")
        self.assertNotIn("src/api", ix.score(P.tokenize("invoice stripe")))

    def test_multi_alpha_returns_one_dict_per_alpha(self):
        ix = toy_index()
        out = ix.score(P.tokenize("login session"), alphas=[0.0, 1.0])
        self.assertEqual(set(out), {0.0, 1.0})
        self.assertGreater(out[0.0]["src/auth"], 0.0)
        self.assertLessEqual(out[1.0]["src/auth"], 1.0 + 1e-9)  # alpha=1 is a cosine

    def test_remove_file_forgets_tokens_and_empty_modules(self):
        ix = toy_index()
        for f in ("src/api/routes.ts", "src/api/middleware.ts"):
            ix.remove_file(f, "src/api")
        ix.refresh()
        self.assertNotIn("src/api", ix.modules)
        self.assertEqual(ix.score(P.tokenize("middleware routes")), {})

    def test_works_on_an_empty_index(self):
        self.assertEqual(P.LexicalIndex().score(["anything"]), {})


class PriorTests(unittest.TestCase):
    def brute(self, history, window, halflife):
        g = 0.5 ** (1.0 / halflife) if halflife else 1.0
        recent = history[-window:]
        w = [g ** (len(recent) - 1 - i) for i in range(len(recent))]
        z = sum(w)
        out = {}
        for wi, mods in zip(w, recent):
            for m in mods:
                out[m] = out.get(m, 0.0) + wi / z
        return out

    def test_matches_brute_force_including_window_expiry(self):
        rng = random.Random(1)
        names = ["a", "b", "c", "d"]
        for window, halflife in ((5, 3.0), (7, None), (50, 10.0)):
            prior = P.RecencyPrior(window, halflife)
            history = []
            for _ in range(40):
                mods = rng.sample(names, rng.randint(1, 3))
                prior.add(mods)
                history.append(mods)
                got, want = prior.scores(), self.brute(history, window, halflife)
                self.assertEqual(set(got), set(want))
                for m in want:
                    self.assertAlmostEqual(got[m], want[m], places=7)

    def test_empty_prior_is_empty(self):
        self.assertEqual(P.RecencyPrior().scores(), {})

    def test_recent_changes_weigh_more(self):
        prior = P.RecencyPrior(100, 2.0)
        for _ in range(10):
            prior.add(["old"])
        for _ in range(3):
            prior.add(["new"])
        s = prior.scores()
        self.assertGreater(s["new"], s["old"])


class KnnTests(unittest.TestCase):
    def test_neighbors_vote_for_their_modules(self):
        knn = P.KnnIndex(refresh_every=2)
        knn.add(P.tokenize("fix login session bug"), ["auth"])
        knn.add(P.tokenize("round invoice totals"), ["billing"])
        knn.add(P.tokenize("login rate limit"), ["auth", "api"])
        nb = knn.neighbors(P.tokenize("login endpoint rate limiting"))
        self.assertTrue(nb)
        votes = P.knn_vote(nb, knn.doc_modules, k=5, power=1.0, lam=0.1)
        self.assertGreater(votes["auth"], votes.get("billing", 0.0))
        self.assertTrue(all(0.0 <= v <= 1.0 for v in votes.values()))

    def test_no_documents_means_no_neighbors_and_no_votes(self):
        knn = P.KnnIndex()
        self.assertEqual(knn.neighbors(["x"]), [])
        self.assertEqual(P.knn_vote([], knn.doc_modules), {})

    def test_query_is_never_its_own_neighbor(self):
        # time-respecting by construction: documents enter the index only through add(), after prediction
        knn = P.KnnIndex()
        knn.add(P.tokenize("alpha beta gamma"), ["m1"])
        before = knn.neighbors(P.tokenize("delta epsilon alpha"))
        self.assertEqual(len(before), 1)
        self.assertEqual(len(knn), 1)

    def test_recency_decay_prefers_newer_neighbors(self):
        nb = [(0.9, 0), (0.9, 9)]
        mods = {0: ("old",), 9: ("new",)}
        votes = P.knn_vote(nb, mods.__getitem__, k=2, power=1.0, lam=0.0, seq_of=P._identity, query_seq=10, decay=3.0)
        self.assertGreater(votes["new"], votes["old"])


def toy_catalog():
    cat = P.Catalog()
    for m, files in {
        "packages/wrangler": ["packages/wrangler/src/deploy.ts", "packages/wrangler/src/config.ts"],
        "packages/miniflare": ["packages/miniflare/src/index.ts"],
        "codex-rs/app-server": ["codex-rs/app-server/src/lib.rs"],
        "codex-rs/app-server-protocol": ["codex-rs/app-server-protocol/src/lib.rs"],
        "codex-rs/tui": ["codex-rs/tui/src/app.rs"],
        ".github": [".github/workflows/ci.yml"],
    }.items():
        for f in files:
            cat.add(f, m)
    return cat


class RefTests(unittest.TestCase):
    def resolve(self, title, text=None):
        return P.RefResolver(toy_catalog()).resolve(title, text)

    def test_scope_tags_resolve_to_modules(self):
        self.assertIn(("packages/wrangler", "scope"), self.resolve("[wrangler] Add x"))
        self.assertIn(("codex-rs/tui", "scope"), self.resolve("feat(tui): y"))
        refs = self.resolve("[wrangler,miniflare] z")
        self.assertIn(("packages/wrangler", "scope"), refs)
        self.assertIn(("packages/miniflare", "scope"), refs)

    def test_longest_alias_wins_for_mentions(self):
        refs = self.resolve("Save opt-ins through the app server protocol")
        self.assertIn(("codex-rs/app-server-protocol", "name"), refs)
        self.assertNotIn(("codex-rs/app-server", "name"), refs)
        self.assertIn(("codex-rs/app-server", "name"), self.resolve("Save opt-ins through the app server"))

    def test_paths_and_files(self):
        refs = self.resolve("Tweak packages/wrangler/src/deploy.ts", None)
        self.assertIn(("packages/wrangler", "path_file"), refs)
        refs = self.resolve("Look at codex-rs/tui")
        self.assertIn(("codex-rs/tui", "path_dir"), refs)
        refs = self.resolve("Change config.ts handling")
        self.assertIn(("packages/wrangler", "path_base"), refs)

    def test_prefix_tier_for_partial_scope(self):
        cat = P.Catalog()
        cat.add("packages/vite-plugin-cloudflare/src/a.ts", "packages/vite-plugin-cloudflare")
        refs = P.RefResolver(cat).resolve("[vite-plugin] y")
        self.assertEqual(refs, [("packages/vite-plugin-cloudflare", "scope_prefix")])

    def test_no_reference_in_plain_text(self):
        self.assertEqual(self.resolve("Make things faster"), [])


class CoChangeTests(unittest.TestCase):
    def test_cochange_propagates_from_referenced_module(self):
        co = P.CoChange(kappa=0.5)
        refs = [("a", "scope")]
        for _ in range(6):
            co.observe(["a", "b"], refs)
        co.observe(["a", "c"], refs)
        score = co.score(refs)
        self.assertGreater(score["a"], 0.9)               # the reference itself is right every time
        self.assertGreater(score["b"], score["c"])        # b changes with a more often than c
        self.assertAlmostEqual(score["b"], score["a"] * 6 / 8, delta=0.12)

    def test_online_confidence_drops_for_bad_references(self):
        co = P.CoChange(kappa=2.0)
        bad = [("noise", "name")]
        for _ in range(30):
            co.observe(["x"], bad)
        self.assertLess(co.confidence("name", "noise"), 0.1)
        self.assertLess(co.score(bad).get("noise", 0.0), 0.1)

    def test_learned_tags_map_a_tag_to_the_modules_it_touched(self):
        co = P.CoChange()
        for _ in range(5):
            co.observe(["packages/create-cloudflare"], [], ["c3"])
        co.observe(["packages/wrangler"], [], ["c3"])
        s = co.score([], ["c3"])
        self.assertGreater(s["packages/create-cloudflare"], 0.6)
        self.assertGreater(s["packages/create-cloudflare"], s["packages/wrangler"])
        self.assertEqual(co.score([], ["unseen"]), {})

    def test_window_expiry_matches_a_fresh_instance(self):
        history = [(["a", "b"], ["t"]), (["a", "c"], ["t"]), (["b", "c"], []), (["a"], ["u"]), (["c", "d"], ["t"])]
        windowed = P.CoChange(window=3)
        for mods, tags in history:
            windowed.observe(mods, [], tags)
        fresh = P.CoChange()
        for mods, tags in history[-3:]:
            fresh.observe(mods, [], tags)
        refs = [("a", "scope"), ("c", "scope")]
        self.assertEqual(windowed.cnt, fresh.cnt)
        self.assertEqual(windowed.tag_n, fresh.tag_n)
        got, want = windowed.score(refs, ["t", "u"]), fresh.score(refs, ["t", "u"])
        self.assertEqual(set(got), set(want))
        for m in want:
            self.assertAlmostEqual(got[m], want[m], places=9)

    def test_mega_changes_do_not_enter_cooccurrence_counts(self):
        co = P.CoChange(max_modules=3)
        co.observe(["a", "b", "c", "d", "e"], [])
        self.assertEqual(sum(co.cnt.values()), 0)


class CalibrationTests(unittest.TestCase):
    def test_isotonic_is_monotone_and_recovers_rates(self):
        rng = random.Random(0)
        samples = []
        for _ in range(4000):
            x = rng.random()
            y = 1.0 if rng.random() < x else 0.0   # true probability = x
            samples.append((x, y, 1.0))
        iso = P.Isotonic.fit(samples)
        xs = [i / 50 for i in range(51)]
        ys = [iso(x) for x in xs]
        self.assertTrue(all(b >= a - 1e-12 for a, b in zip(ys, ys[1:])))
        for x in (0.1, 0.5, 0.9):
            self.assertAlmostEqual(iso(x), x, delta=0.1)

    def test_isotonic_pools_violators(self):
        iso = P.Isotonic.fit([(0.1, 1.0, 50), (0.2, 0.0, 50)], min_weight=1)
        self.assertAlmostEqual(iso(0.1), iso(0.2), places=6)

    def test_isotonic_json_roundtrip(self):
        iso = P.Isotonic([0.0, 0.5, 1.0], [0.0, 0.2, 0.9])
        back = P.Isotonic.from_json(iso.to_json())
        for x in (0.0, 0.25, 0.7, 1.0):
            self.assertAlmostEqual(iso(x), back(x), places=5)

    def test_logistic_recovers_coefficients(self):
        rng = random.Random(2)
        rows = []
        for _ in range(6000):
            a, b = rng.gauss(0, 1), rng.gauss(0, 1)
            p = P.sigmoid(-0.5 + 1.5 * a - 1.0 * b)
            rows.append(([a, b], 1.0 if rng.random() < p else 0.0, 1.0))
        beta = P.fit_logistic(rows, l2=0.01)
        self.assertAlmostEqual(beta[0], -0.5, delta=0.15)
        self.assertAlmostEqual(beta[1], 1.5, delta=0.2)
        self.assertAlmostEqual(beta[2], -1.0, delta=0.2)

    def test_blend_roundtrip_and_range(self):
        cal = {n: P.Isotonic([0.0, 1.0], [0.01, 0.9]) for n in P.METHODS}
        blend = P.Blend(cal, [-1.0, 0.5, 0.5, 0.5, 0.5])
        back = P.Blend.from_json(blend.to_json())
        raw = {"prior": 0.3, "lexical": 0.2, "knn": 0.8, "cochange": 0.0}
        self.assertAlmostEqual(blend(raw), back(raw), places=5)
        self.assertTrue(0.0 < blend(raw) < 1.0)


class PredictApiTests(unittest.TestCase):
    CTX = {"modules": {
        "src/auth": ["src/auth/login.ts", "src/auth/session.ts", "src/auth/password.ts"],
        "src/billing": ["src/billing/invoice.ts", "src/billing/stripe.ts"],
        "src/api": ["src/api/routes.ts", "src/api/middleware.ts"],
    }}

    def test_no_history_falls_back_to_lexical(self):
        out = P.predict("Add rate limiting to the login endpoint", self.CTX)
        self.assertEqual(list(out)[0], "src/auth")
        self.assertEqual(set(out), set(self.CTX["modules"]))
        self.assertTrue(all(isinstance(v, float) and 0.0 <= v <= 1.0 for v in out.values()))
        self.assertEqual(list(out.values()), sorted(out.values(), reverse=True))

    def test_scope_tag_wins(self):
        self.assertEqual(list(P.predict("fix(billing): invoice rounding", self.CTX))[0], "src/billing")

    def test_unrelated_text_gives_flat_zero(self):
        out = P.predict("zzz qqq", self.CTX)
        self.assertTrue(all(v == 0.0 for v in out.values()))

    def test_modules_without_files_and_empty_text(self):
        ctx = {"modules": {"src/auth": ["src/auth/login.ts"], "src/search": []}}
        out = P.predict("add search filters", ctx)
        self.assertEqual(set(out), {"src/auth", "src/search"})
        self.assertEqual(list(out)[0], "src/search")          # matched by its name alone
        self.assertTrue(all(v == 0.0 for v in P.predict("", ctx).values()))
        self.assertTrue(all(v == 0.0 for v in P.predict("zzz", {"modules": {}}).values()) or P.predict("zzz", {"modules": {}}) == {})

    def test_deterministic(self):
        self.assertEqual(P.predict("login session", self.CTX), P.predict("login session", self.CTX))

    def test_with_history_and_no_fitted_blend_still_returns_all_modules(self):
        hist = [{"title": "fix login bug", "body": "", "modules": ["src/auth"]},
                {"title": "invoice totals", "body": "", "modules": ["src/billing"]}] * 3
        ctx = dict(self.CTX, history=hist)
        pred = P.build_predictor(ctx, defaults={})
        self.assertEqual(pred.n_observed, 6)
        out = P.predict("login bug again", ctx)
        self.assertEqual(set(out), set(self.CTX["modules"]))

    def test_shipped_defaults_work_end_to_end(self):
        """defaults.json (written by predict.py --export-defaults) must load and drive both modes."""
        defaults = P.load_defaults()
        if not defaults:
            self.skipTest("no defaults.json (run predict.py --export-defaults)")
        self.assertIn("calibration", defaults["lexical"])
        self.assertIn("blend", defaults["history"])
        hist = [{"title": "fix(auth): login bug", "body": "", "modules": ["src/auth"]},
                {"title": "invoice totals", "body": "", "modules": ["src/billing"]},
                {"title": "route versioning", "body": "", "modules": ["src/api"]}] * 8
        ctx = dict(self.CTX, history=hist)
        out = P.predict("fix(auth): another login bug", ctx)
        self.assertEqual(set(out), set(self.CTX["modules"]))
        self.assertTrue(all(0.0 <= v <= 1.0 for v in out.values()))
        self.assertEqual(list(out)[0], "src/auth")
        self.assertGreater(out["src/auth"], 0.5)

    def test_history_mode_with_a_blend_uses_history(self):
        cal = {n: P.Isotonic([0.0, 1.0], [0.02, 0.95]) for n in P.METHODS}
        defaults = {"history": {"params": {}, "blend": P.Blend(cal, [-2.0, 0.5, 1.0, 1.5, 0.5]).to_json()}}
        hist = [{"title": "fix login bug", "body": "", "modules": ["src/auth"]}] * 5
        ctx = dict(self.CTX, history=hist)
        pred = P.build_predictor(ctx, defaults=defaults)
        comps = pred.components("fix login bug", "")
        probs = pred.predict_parts(comps)
        self.assertEqual(max(probs, key=probs.get), "src/auth")


class CtxFromDirTests(unittest.TestCase):
    def test_modules_are_the_first_directories(self):
        with tempfile.TemporaryDirectory() as tmp:
            for rel in ("src/auth/login.ts", "src/auth/deep/x.ts", "src/billing/a.ts", "README.md", "src/top.ts",
                        "node_modules/pkg/i.js", ".git/config"):
                path = os.path.join(tmp, rel)
                os.makedirs(os.path.dirname(path), exist_ok=True)
                open(path, "w").close()
            ctx = P.ctx_from_dir(tmp, depth=2)
            self.assertEqual(sorted(ctx["modules"]), ["(root)", "src", "src/auth", "src/billing"])
            self.assertEqual(ctx["modules"]["src/auth"], ["src/auth/deep/x.ts", "src/auth/login.ts"])
            self.assertEqual(ctx["modules"]["(root)"], ["README.md"])
            self.assertEqual(sorted(P.ctx_from_dir(tmp, depth=1)["modules"]), ["(root)", "src"])
            out = P.predict("fix login", ctx)
            self.assertEqual(list(out)[0], "src/auth")


if __name__ == "__main__":
    unittest.main()
