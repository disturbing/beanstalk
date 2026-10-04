"""Unit tests for replay.py on tiny synthetic repositories.

Run from research/contention-replay:  python3 -m unittest discover -s tests
"""
from __future__ import annotations

import hashlib
import json
import os
import subprocess
import sys
import tempfile
import unittest
from pathlib import Path

from fixture import CLAUDE_TRAILER, ROOT, FixtureRepo, numbered, replay, run_replay

PAIR_FIELDS = {"corpus", "window", "a", "b", "a_seq", "b_seq", "result", "overlap_class", "shared_files",
               "shared_modules", "conflict_files", "dissolvable_only"}
CHANGE_FIELDS = {"id", "seq", "window", "eligible", "reason"}
SUMMARY_FIELDS = {"corpus", "window_size", "windows", "changes", "eligible", "dependency_rate", "pairs",
                  "conflict_rate", "by_overlap_class", "dissolvable_share", "conflict_rate_after_drivers",
                  "category_share", "module_concentration", "max_compatible_batch"}


class TempDirTest(unittest.TestCase):
    def setUp(self):
        self._tmp = tempfile.TemporaryDirectory(prefix="replay-test-")
        self.tmp = Path(self._tmp.name)

    def tearDown(self):
        self._tmp.cleanup()


class HistoryPairTest(TempDirTest):
    """c0 edits a.ts:2; c1 (agent) edits b.ts:5; c2 rewrites c0's line; c3 edits a.ts:11."""

    def setUp(self):
        super().setUp()
        r = self.repo = FixtureRepo(self.tmp)
        r.commit("c0: tweak a", {"pkg-a/src/a.ts": r.edit("pkg-a/src/a.ts", {2: "a2-c0"})})
        r.commit("c1: tweak b" + CLAUDE_TRAILER, {"pkg-b/src/b.ts": r.edit("pkg-b/src/b.ts", {5: "b5-c1"})})
        r.commit("c2: rewrite c0", {"pkg-a/src/a.ts": r.edit("pkg-a/src/a.ts", {2: "a2-c2"})})
        r.commit("c3: far edit", {"pkg-a/src/a.ts": r.edit("pkg-a/src/a.ts", {11: "a11-c3"})})
        self.out = run_replay(r.corpus(self.tmp / "data"), r.path, self.tmp / "out", "--window", "10")

    def test_clean_pair(self):
        p = self.out["pairs"][(0, 1)]
        self.assertEqual(p["result"], "clean")
        self.assertEqual(p["overlap_class"], "disjoint")
        self.assertEqual(p["conflict_files"], [])
        self.assertFalse(p["dissolvable_only"])
        same_file = self.out["pairs"][(2, 3)]  # same file, lines 2 and 11
        self.assertEqual((same_file["result"], same_file["overlap_class"]), ("clean", "file"))
        self.assertEqual(same_file["shared_files"], ["pkg-a/src/a.ts"])

    def test_conflicting_pair(self):
        p = self.out["pairs"][(0, 2)]
        self.assertEqual(p["result"], "conflict")
        self.assertEqual(p["overlap_class"], "file")
        self.assertEqual(p["conflict_files"], [{"path": "pkg-a/src/a.ts", "module": "pkg-a", "category": "source"}])
        self.assertFalse(p["dissolvable_only"])
        self.assertEqual(self.out["summary"]["conflict_types"], {"CONFLICT (contents)": 1})

    def test_entangled_pair(self):
        # reverting c0 under c3's parent conflicts: c2 rewrote c0's line in between
        self.assertEqual(self.out["pairs"][(0, 3)]["result"], "entangled")
        s = self.out["summary"]
        self.assertEqual(s["results"], {"clean": 4, "conflict": 1, "entangled": 1, "error": 0})
        self.assertAlmostEqual(s["conflict_rate"], 1 / 5)
        self.assertAlmostEqual(s["conflict_rate_bound"], 2 / 6)  # the entangled pair shares a.ts

    def test_contract_fields(self):
        for p in self.out["pair_list"]:
            self.assertEqual(set(p), PAIR_FIELDS)
        for c in self.out["changes"]:
            self.assertEqual(set(c), CHANGE_FIELDS)
        self.assertTrue(SUMMARY_FIELDS <= set(self.out["summary"]))
        self.assertNotIn("semantic", self.out["summary"])
        self.assertEqual(len(self.out["pair_list"]), 6)

    def test_authorship(self):
        s = self.out["summary"]["by_authorship"]
        self.assertEqual(s["agent-human"]["all_pairs"], 3)  # every pair with c1
        self.assertEqual(s["human-human"]["all_pairs"], 3)
        self.assertEqual(s["human-human"]["conflicts"], 1)

    def test_window_base_dependency(self):
        reasons = [c["reason"] for c in self.out["changes"]]
        self.assertEqual(reasons, ["applies", "applies", "depends_on_window", "applies"])
        s = self.out["summary"]
        self.assertAlmostEqual(s["per_change_collision_rate"], 1 / 3)
        self.assertAlmostEqual(s["dependency_rate"], 1 / 4)
        self.assertEqual(s["eligible"], 3)

    def test_greedy_batch_and_concentration(self):
        s = self.out["summary"]
        self.assertEqual(s["max_compatible_batch"]["mean"], None)  # 4 changes < W=10: no full window
        self.assertEqual(s["module_concentration"]["top_modules"][0]["module"], "pkg-a")
        self.assertEqual(s["module_concentration"]["top1_share"], 1.0)


class DissolvableTest(TempDirTest):
    def test_dissolvable_classification(self):
        r = FixtureRepo(self.tmp)
        r.commit("c0", {"CHANGELOG.md": r.edit("CHANGELOG.md", {3: "- c0"}),
                        "pkg-a/src/a.ts": r.edit("pkg-a/src/a.ts", {2: "a2-c0"})})
        r.commit("c1", {"CHANGELOG.md": r.edit("CHANGELOG.md", {3: "- c1"}),
                        "pkg-a/src/a.ts": r.edit("pkg-a/src/a.ts", {2: "a2-c1"})})
        r.commit("c2", {"pnpm-lock.yaml": r.edit("pnpm-lock.yaml", {2: "l2-c2"})})
        r.commit("c3", {"pnpm-lock.yaml": r.edit("pnpm-lock.yaml", {2: "l2-c3"})})
        r.commit("c4", {".changeset/x.md": "first\n"})
        r.commit("c5", {".changeset/x.md": "second\n"})
        out = run_replay(r.corpus(self.tmp / "data"), r.path, self.tmp / "out", "--window", "10")
        mixed, lock, cset = out["pairs"][(0, 1)], out["pairs"][(2, 3)], out["pairs"][(4, 5)]
        self.assertEqual(mixed["result"], "conflict")
        self.assertEqual({c["category"] for c in mixed["conflict_files"]}, {"changelog", "source"})
        self.assertFalse(mixed["dissolvable_only"])
        self.assertEqual(lock["result"], "conflict")
        self.assertEqual(lock["conflict_files"], [{"path": "pnpm-lock.yaml", "module": "(root)", "category": "lockfile"}])
        self.assertTrue(lock["dissolvable_only"])
        self.assertEqual(cset["result"], "conflict")  # c5 edits a file only c4 created: modify/delete
        self.assertTrue(cset["dissolvable_only"])
        s = out["summary"]
        self.assertEqual(s["conflicts"], 3)
        self.assertAlmostEqual(s["dissolvable_share"], 2 / 3)
        self.assertAlmostEqual(s["dissolvable_share_strict"], 1 / 3)  # modify/delete never reaches a driver
        self.assertAlmostEqual(s["conflict_rate_after_drivers"], 1 / s["pairs_tested"])
        self.assertEqual(s["dissolvable_conflict_types"], {"CONFLICT (contents)": 1, "CONFLICT (modify/delete)": 1})
        self.assertEqual(s["category_share"]["lockfile"], 0.25)


    def test_binary_generated_conflict_is_driver_resolvable(self):
        blob = "schema/precomputed/exports.json.zst"  # binary, category "generated"
        r = FixtureRepo(self.tmp, {"README.md": "x\n", blob: b"\x28\xb5\x2f\xfd\x00v1"})
        r.commit("c0", {blob: b"\x28\xb5\x2f\xfd\x00v2"})
        r.commit("c1", {blob: b"\x28\xb5\x2f\xfd\x00v3"})
        out = run_replay(r.corpus(self.tmp / "data"), r.path, self.tmp / "out")
        p = out["pairs"][(0, 1)]
        self.assertEqual((p["result"], p["dissolvable_only"]), ("conflict", True))
        self.assertEqual(p["conflict_files"][0]["category"], "generated")
        s = out["summary"]
        self.assertIn("CONFLICT (binary)", s["dissolvable_conflict_types"])
        self.assertEqual(s["dissolvable_share_strict"], 1.0)


class WindowBaseTest(TempDirTest):
    def test_reasons_and_empty(self):
        r = FixtureRepo(self.tmp)
        r.commit("c0", {"pkg-a/src/a.ts": r.edit("pkg-a/src/a.ts", {2: "a2-c0"})})
        r.commit("c1", {"pkg-b/src/b.ts": r.edit("pkg-b/src/b.ts", {5: "b5-c1"})})
        r.commit("c2", {"pkg-a/src/a.ts": r.edit("pkg-a/src/a.ts", {2: "a2-c2"})})
        r.commit("c3", {"pkg-b/src/tmp.ts": "tmp\n"})
        r.commit("c4", {"pkg-b/src/tmp.ts": None})
        r.commit("c5", {"pkg-b/src/b.ts": r.edit("pkg-b/src/b.ts", {9: "b9-c5"})})
        out = run_replay(r.corpus(self.tmp / "data"), r.path, self.tmp / "out", "--window", "3",
                         "--collision-windows", "2,6")
        self.assertEqual([c["reason"] for c in out["changes"]],
                         ["applies", "applies", "depends_on_window", "applies", "empty", "applies"])
        self.assertEqual([c["window"] for c in out["changes"]], [0, 0, 0, 1, 1, 1])
        self.assertEqual([c["eligible"] for c in out["changes"]], [True, True, False, True, False, True])
        s = out["summary"]
        self.assertAlmostEqual(s["per_change_collision_rate"], 1 / 4)
        self.assertEqual(sorted(s["window_base"]), ["2", "3", "6"])
        self.assertEqual(s["window_base"]["2"]["tested"], 3)  # windows {0,1} {2,3} {4,5}
        self.assertEqual(s["window_base"]["6"]["collisions"], 1)
        self.assertEqual(s["window_base"]["6"]["by_position"][1]["rate"], 1.0)  # c2 at position 2
        # (3, 4): c4 deletes the file c3 created; without c3 the deletion is a no-op, not a conflict
        self.assertEqual(out["pairs"][(3, 4)]["result"], "clean")
        self.assertEqual(s["clean_with_j_empty"], 1)


SEMANTIC_BASE = {
    "lib.py": "def total(xs):\n    return sum(xs)\n",
    "test_lib.py": ("import unittest\nfrom lib import total\n\n\nclass T(unittest.TestCase):\n"
                    "    def test_total(self):\n        self.assertEqual(total([1, 2]), 3)\n"),
}
RETURNS_STR = {
    "lib.py": "def total(xs):\n    return str(sum(xs))\n",
    "test_lib.py": SEMANTIC_BASE["test_lib.py"].replace("total([1, 2]), 3)", 'total([1, 2]), "3")'),
}
NEW_CALLER = {
    "report.py": "from lib import total\n\n\ndef double(xs):\n    return total(xs) * 2\n",
    "test_report.py": ("import unittest\nfrom report import double\n\n\nclass R(unittest.TestCase):\n"
                       "    def test_double(self):\n        self.assertEqual(double([1, 2]), 6)\n"),
}
UNRELATED = {
    "util.py": "def inc(x):\n    return x + 1\n",
    "test_util.py": ("import unittest\nfrom util import inc\n\n\nclass U(unittest.TestCase):\n"
                     "    def test_inc(self):\n        self.assertEqual(inc(1), 2)\n"),
}
CHECK = f"test -f .setup-done && {sys.executable} -B -m unittest discover -q -s . -p 'test_*.py'"


class SemanticCheckTest(TempDirTest):
    def test_branch_mode_return_type_plus_new_caller(self):
        r = FixtureRepo(self.tmp, SEMANTIC_BASE)
        r.branch("ref/t001", "Return the total as a string", RETURNS_STR)
        r.branch("ref/t002", "Add a doubling report", NEW_CALLER)
        r.branch("ref/t003", "Add an increment helper", UNRELATED)
        out = run_replay(r.branch_corpus(self.tmp / "data"), r.path, self.tmp / "out",
                         "--check-cmd", CHECK, "--check-setup", "touch .setup-done", "--check-sample", "10")
        s = out["summary"]
        self.assertEqual(s["mode"], "branch")
        self.assertEqual(s["window_size"], 3)  # branch mode: every pair
        self.assertEqual(s["results"], {"clean": 3, "conflict": 0, "entangled": 0, "error": 0})
        sem = {(x["a_seq"], x["b_seq"]): x for x in out["semantic"]}
        self.assertEqual(len(sem), 3)
        broken = sem[(0, 1)]
        self.assertEqual((broken["a_pass"], broken["b_pass"], broken["merged_pass"]), (True, True, False))
        self.assertTrue(broken["clean_but_broken"])
        self.assertFalse(sem[(0, 2)]["clean_but_broken"])
        self.assertFalse(sem[(1, 2)]["clean_but_broken"])
        self.assertEqual(s["semantic"]["pairs_checked"], 3)
        self.assertEqual(s["semantic"]["clean_but_broken"], 1)
        self.assertAlmostEqual(s["semantic"]["rate"], 1 / 3)
        self.assertEqual(s["semantic"]["setup_failures"], 0)

    def test_history_mode(self):
        r = FixtureRepo(self.tmp, SEMANTIC_BASE)
        r.commit("Return the total as a string", RETURNS_STR)
        r.commit("Add a doubling report", NEW_CALLER)  # trunk goes red here
        out = run_replay(r.corpus(self.tmp / "data"), r.path, self.tmp / "out",
                         "--check-cmd", CHECK, "--check-setup", "touch .setup-done")
        row = out["semantic"][0]
        self.assertEqual((row["a_pass"], row["b_pass"], row["merged_pass"]), (True, True, False))
        self.assertEqual(out["summary"]["semantic"]["clean_but_broken"], 1)

    def test_failing_setup_counts_as_failure(self):
        r = FixtureRepo(self.tmp, SEMANTIC_BASE)
        r.branch("ref/t001", "a", UNRELATED)
        r.branch("ref/t002", "b", NEW_CALLER)
        out = run_replay(r.branch_corpus(self.tmp / "data"), r.path, self.tmp / "out",
                         "--check-cmd", "true", "--check-setup", "false")
        self.assertEqual(out["semantic"][0]["merged_pass"], False)
        self.assertFalse(out["semantic"][0]["clean_but_broken"])  # i' and j' fail too
        self.assertEqual(out["summary"]["semantic"]["setup_failures"], 3)


class BranchModeTest(TempDirTest):
    def test_direct_pairs(self):
        r = FixtureRepo(self.tmp)
        r.branch("ref/t001", "one", {"pkg-a/src/a.ts": r.edit("pkg-a/src/a.ts", {3: "a3-one"})})
        r.branch("ref/t002", "two", {"pkg-a/src/a.ts": r.edit("pkg-a/src/a.ts", {3: "a3-two"})})
        r.branch("ref/t003", "three", {"pkg-b/src/b.ts": r.edit("pkg-b/src/b.ts", {3: "b3-three"})})
        out = run_replay(r.branch_corpus(self.tmp / "data"), r.path, self.tmp / "out")
        self.assertEqual(out["summary"]["mode"], "branch")
        self.assertEqual(out["pairs"][(0, 1)]["result"], "conflict")
        self.assertEqual(out["pairs"][(0, 2)]["result"], "clean")
        self.assertEqual(out["pairs"][(1, 2)]["result"], "clean")
        self.assertEqual(out["summary"]["max_compatible_batch"]["mean"], 2)
        self.assertEqual({c["reason"] for c in out["changes"]}, {"applies"})


def merge_bytes(status: str, tree: str, paths=(), records=()) -> bytes:
    out = [status.encode(), tree.encode(), *[p.encode() for p in paths], b""]
    for rec_paths, ctype, msg in records:
        out += [str(len(rec_paths)).encode(), *[p.encode() for p in rec_paths], ctype.encode(), msg.encode()]
    out.append(b"")
    return b"".join(x + b"\0" for x in out)


T1, T2, T3 = "1" * 40, "2" * 40, "3" * 40


class ParseStdinTest(TempDirTest):
    def test_handcrafted_stream(self):
        data = (merge_bytes("0", T1, ["f.txt", "dir/g h.txt"],
                            [(["f.txt"], "Auto-merging", "Auto-merging f.txt\n"),
                             (["f.txt"], "CONFLICT (contents)", "CONFLICT (content): Merge conflict in f.txt\n")])
                + merge_bytes("1", T2)
                + merge_bytes("0", T3, [], [(["a", "b"], "CONFLICT (rename/rename)", "both renamed\n")]))
        got = replay.parse_merge_stream(data)
        self.assertEqual([m.status for m in got], ["conflict", "clean", "conflict"])
        self.assertEqual(got[0].paths, ("f.txt", "dir/g h.txt"))
        self.assertEqual(got[0].types, ("Auto-merging", "CONFLICT (contents)"))
        self.assertEqual(replay.conflict_types(got[0].types), ("CONFLICT (contents)",))
        self.assertEqual((got[1].tree, got[1].paths, got[1].types), (T2, (), ()))
        self.assertEqual((got[2].paths, got[2].types), ((), ("CONFLICT (rename/rename)",)))
        # a truncated tail (git died mid-batch) is dropped, complete records are kept
        for cut in (1, 3, 20, 60):
            self.assertEqual(len(replay.parse_merge_stream(data[:-cut])), 2, cut)
        self.assertEqual(replay.parse_merge_stream(data[:10]), [])
        self.assertEqual(replay.parse_merge_stream(b""), [])

    def test_real_git_output_and_error_resume(self):
        r = FixtureRepo(self.tmp)
        base = r.base
        one = r.branch("s1", "one", {"pkg-a/src/a.ts": r.edit("pkg-a/src/a.ts", {2: "x"}),
                                     "README.md": "one\n"})
        two = r.branch("s2", "two", {"pkg-a/src/a.ts": r.edit("pkg-a/src/a.ts", {2: "y"}),
                                     "README.md": None})
        three = r.branch("s3", "three", {"pkg-b/src/b.ts": r.edit("pkg-b/src/b.ts", {2: "z"})})
        env = replay.git_env(GIT_DIR=str(r.path / ".git"))
        lines = [f"{base} -- {one} {two}", f"{base} -- {one} {three}", f"{base} -- {'f' * 40} {three}",
                 f"{base} -- {two} {three}"]
        got = replay.run_merge_batch(env, lines)
        self.assertEqual([m.status for m in got], ["conflict", "clean", "error", "clean"])
        self.assertEqual(set(got[0].paths), {"pkg-a/src/a.ts", "README.md"})
        self.assertEqual(set(replay.conflict_types(got[0].types)), {"CONFLICT (contents)", "CONFLICT (modify/delete)"})
        # the batch agrees with one-merge-per-process merge-tree
        for line, m in zip(lines, got):
            if m.status == "error":
                continue
            b, _, s1, s2 = line.split()
            p = subprocess.run(["git", "merge-tree", "--write-tree", f"--merge-base={b}", s1, s2],
                               capture_output=True, text=True, env=env)
            self.assertEqual(p.returncode, 1 if m.status == "conflict" else 0)
            self.assertEqual(p.stdout.split("\n", 1)[0], m.tree)


class HelperTest(unittest.TestCase):
    def test_greedy_batch(self):
        self.assertEqual(replay.greedy_batch([1, 2, 3], [(1, 2), (2, 3)]), 2)        # path
        self.assertEqual(replay.greedy_batch([0, 1, 2, 3], [(0, 1), (0, 2), (0, 3)]), 3)  # star
        self.assertEqual(replay.greedy_batch([0, 1, 2], []), 3)

    def test_concentration(self):
        c = replay.concentration([{"m1"}, {"m1"}, {"m1", "m2"}, {"m3"}, set()])
        self.assertEqual(c["pairs"], 4)
        self.assertEqual(c["top_modules"][0]["module"], "m1")
        self.assertAlmostEqual(c["top1_weight"], 2.5 / 4)
        self.assertAlmostEqual(c["top1_share"], 2 / 4)   # {m1, m2} is not inside the top-1 set
        self.assertAlmostEqual(c["top3_share"], 1.0)
        self.assertAlmostEqual(c["hhi"], (2.5 / 4) ** 2 + (0.5 / 4) ** 2 + (1 / 4) ** 2)

    def test_implied_collision(self):
        got = replay.implied_collision(0.1)["n"]
        self.assertAlmostEqual(got["5"], 1 - 0.9 ** 4)
        self.assertAlmostEqual(got["1000"], 1 - 0.9 ** 999)
        self.assertIsNone(replay.implied_collision(None))

    def test_select_windows(self):
        a = replay.select_windows(list(range(100)), 10, "even", 7)
        self.assertEqual(a, replay.select_windows(list(range(100)), 10, "even", 7))
        self.assertEqual(len(a), 10)
        self.assertEqual({y - x for x, y in zip(a, a[1:])}, {10})
        b = replay.select_windows(list(range(100)), 10, "random", 7)
        self.assertEqual(b, sorted(set(b)))
        self.assertEqual(replay.select_windows([1, 2], 5, "even", 0), [1, 2])

    def test_unquote_git_path(self):
        self.assertEqual(replay.unquote_git_path('"caf\\303\\251.md"'), "café.md")
        self.assertEqual(replay.unquote_git_path('"a\\"b\\tc"'), 'a"b\tc')
        self.assertEqual(replay.unquote_git_path("plain/path.ts"), "plain/path.ts")

    def test_normalize_quoted_paths(self):
        # corpus.py stores git's quoted form for non-ASCII paths and derives the module '"pkg' from it
        rec = {"files": [{"path": '"pkg/caf\\303\\251.ts"', "old_path": None, "module": '"pkg'},
                         {"path": "pkg/plain.ts", "old_path": None, "module": "pkg"}], "modules": ['"pkg', "pkg"]}
        modules = replay.ModuleMap("unused", "main", depth=1)
        self.assertEqual(replay.normalize_quoted_paths([rec], modules), 1)
        self.assertEqual([f["path"] for f in rec["files"]], ["pkg/café.ts", "pkg/plain.ts"])
        self.assertEqual(rec["modules"], ["pkg"])

    def test_code_footprint(self):
        rec = {"files": [{"path": "pnpm-lock.yaml", "old_path": None, "module": "(root)"},
                         {"path": ".changeset/x.md", "old_path": None, "module": ".changeset"},
                         {"path": "pkg/src/new.ts", "old_path": "pkg/src/old.ts", "module": "pkg"}]}
        files, mods = replay.code_footprint(rec)
        self.assertEqual(files, {"pkg/src/new.ts", "pkg/src/old.ts"})
        self.assertEqual(mods, {"pkg"})


def snapshot(root: Path) -> dict[str, tuple]:
    out = {}
    for p in sorted(root.rglob("*")):
        if p.is_file():
            st = p.stat()
            out[str(p.relative_to(root))] = (st.st_size, st.st_mtime_ns, hashlib.sha256(p.read_bytes()).hexdigest())
    return out


class CliAndSafetyTest(TempDirTest):
    def test_cli_multiprocess_and_source_untouched(self):
        r = FixtureRepo(self.tmp)
        for k in range(6):
            r.commit(f"c{k}", {"pkg-a/src/a.ts": r.edit("pkg-a/src/a.ts", {1 + k % 3: f"a-c{k}"})})
        corpus = r.corpus(self.tmp / "data")
        bare = self.tmp / "mirror.git"  # packed, like a network clone
        subprocess.run(["git", "clone", "-q", "--bare", "--no-local", str(r.path), str(bare)], check=True)
        for source, expect in ((bare, "clone"), (r.path, "none+pack-objects")):  # packed, loose
            before = snapshot(source)
            out = self.tmp / f"out-{expect}"
            p = subprocess.run([sys.executable, str(ROOT / "replay.py"), "--corpus-file", str(corpus),
                                "--repo", str(source), "--out", str(out), "--jobs", "2", "--chunk", "4",
                                "--window", "4", "--quiet"], capture_output=True, text=True)
            self.assertEqual(p.returncode, 0, p.stderr)
            self.assertEqual(snapshot(source), before)  # nothing written, not even an mtime
            s = json.loads((out / "summary.json").read_text())
            self.assertEqual(s["params"]["scratch_objects"], expect)
        self.assertEqual(s["pairs"], sum(min(j, 3) for j in range(6)))
        self.assertFalse([x for x in out.iterdir() if x.name.startswith(".scratch")])
        h = subprocess.run([sys.executable, str(ROOT / "replay.py"), "--help"], capture_output=True, text=True)
        self.assertEqual(h.returncode, 0)
        self.assertIn("--check-cmd", h.stdout)

    def test_sampling_is_recorded(self):
        r = FixtureRepo(self.tmp)
        for k in range(12):
            r.commit(f"c{k}", {"pkg-b/src/b.ts": r.edit("pkg-b/src/b.ts", {1 + k: f"b-c{k}"})})
        out = run_replay(r.corpus(self.tmp / "data"), r.path, self.tmp / "out", "--window", "3",
                         "--sample-windows", "2", "--seed", "3")
        smp = out["summary"]["sampling"]
        self.assertEqual((smp["method"], smp["pair_windows"], smp["full_windows"]), ("even", 2, 4))
        self.assertEqual({p["b_seq"] // 3 for p in out["pair_list"]}, set(smp["pair_window_indices"]))
        self.assertEqual(len(out["changes"]), 12)  # the window-base pass still covers every change
        first = run_replay(r.corpus(self.tmp / "data"), r.path, self.tmp / "out2", "--window", "3", "--max-windows", "2")
        self.assertEqual(len(first["changes"]), 6)
        self.assertEqual(max(p["b_seq"] for p in first["pair_list"]), 5)
        self.assertEqual(first["summary"]["max_compatible_batch"]["windows"], 2)

    def test_private_corpus_needs_private_out(self):
        r = FixtureRepo(self.tmp)
        r.commit("c0", {"README.md": "x\n"})
        corpus = r.corpus(self.tmp / "data" / "private" / "fixture")
        with self.assertRaises(SystemExit):
            replay.main(["--corpus-file", str(corpus), "--repo", str(r.path), "--out", str(self.tmp / "out"), "--quiet"])
        run_replay(corpus, r.path, self.tmp / "out" / "private" / "fixture")


if __name__ == "__main__":
    unittest.main()
