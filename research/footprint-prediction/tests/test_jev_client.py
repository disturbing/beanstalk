import http.server
import json
import os
import tempfile
import threading
import time
import unittest

import helpers  # noqa: F401
import jev_client as J

KEY = "testkey-SECRET-0123456789"


class MockJev:
    """Local stand-in for POST /v1/systemone. mode: ok | 402 | flaky (first call per task fails with 500)."""

    def __init__(self, mode="ok", delay=0.05):
        self.mode, self.delay = mode, delay
        self.calls = []
        self.lock = threading.Lock()
        self.inflight = 0
        self.max_inflight = 0
        self.seen_tasks = set()
        mock = self

        class Handler(http.server.BaseHTTPRequestHandler):
            def log_message(self, *a):
                pass

            def do_POST(self):
                body = json.loads(self.rfile.read(int(self.headers["content-length"])))
                with mock.lock:
                    mock.inflight += 1
                    mock.max_inflight = max(mock.max_inflight, mock.inflight)
                    mock.calls.append({"body": body, "auth": self.headers.get("authorization"), "path": self.path})
                time.sleep(mock.delay)
                status, payload = 200, {}
                if self.headers.get("authorization") != f"Bearer {KEY}":
                    status, payload = 401, {"detail": "bad key"}
                elif mock.mode == "402":
                    status, payload = 402, {"detail": {"error_type": "billing_error", "message": "no credits"}}
                elif mock.mode == "422":
                    status, payload = 422, {"detail": "too many questions"}
                elif mock.mode == "flaky":
                    task = body["state"]["task"]
                    with mock.lock:
                        first = task not in mock.seen_tasks
                        mock.seen_tasks.add(task)
                    if first:
                        status, payload = 500, {"detail": "boom"}
                if status == 200:
                    answers = {}
                    for name, q in body["questions"].items():
                        module = q["instructions"].split("module ", 1)[1].rstrip("?")
                        answers[name] = {"type": "noul", "noul": 0.9 if module.endswith("hit") else 0.1}
                    payload = {"model": "jev-mock", "answers": answers, "usage": {"input_tokens": 100, "output_tokens": 7}}
                raw = json.dumps(payload).encode()
                with mock.lock:
                    mock.inflight -= 1
                self.send_response(status)
                self.send_header("content-type", "application/json")
                self.send_header("content-length", str(len(raw)))
                self.end_headers()
                self.wfile.write(raw)

        self.server = http.server.ThreadingHTTPServer(("127.0.0.1", 0), Handler)
        self.server.daemon_threads = True
        self.url = f"http://127.0.0.1:{self.server.server_address[1]}/v1/systemone"
        self.thread = threading.Thread(target=self.server.serve_forever, daemon=True)
        self.thread.start()

    def close(self):
        self.server.shutdown()
        self.server.server_close()


def make_item(i, split="eval", n=6):
    cands = [{"module": f"pkg/m{j}" + ("_hit" if j < 2 else ""), "p_combined": round(0.9 - 0.1 * j, 2),
              "files": [f"pkg/m{j}/src/a{j}.ts", f"pkg/m{j}/src/b{j}.ts"]} for j in range(n)]
    return {"id": f"toy#{i}", "seq": i, "split": split, "title": f"change number {i} with token sk-abcdefgh12345678 and a@b.com",
            "actual_modules": ["pkg/m0_hit", "pkg/m1_hit"], "candidates": cands}


def write_inputs(base, items, corpus="toy"):
    d = os.path.join(base, corpus)
    os.makedirs(d, exist_ok=True)
    with open(os.path.join(d, "jev_inputs.jsonl"), "w") as fh:
        for it in items:
            fh.write(json.dumps(it) + "\n")
    return d


class BuildRequestTests(unittest.TestCase):
    def test_request_shape_and_no_leak_of_combined_scores(self):
        item = make_item(3)
        state, questions, order = J.build_request(item, seed=7)
        self.assertEqual(set(state), {"task", "modules"})
        self.assertNotIn("sk-abcdefgh", state["task"])
        self.assertNotIn("a@b.com", state["task"])
        self.assertEqual(len(state["modules"]), len(order))
        self.assertEqual({m["name"] for m in state["modules"]}, {c["module"] for c in item["candidates"]})
        self.assertNotIn("p_combined", json.dumps(state) + json.dumps(questions))
        self.assertEqual(len(questions), 6)
        for i, module in enumerate(order):
            q = questions[f"m{i:02d}"]
            self.assertEqual(q["type"], "noul")
            self.assertEqual(q["instructions"], f"Will this change need to modify files in module {module}?")
        first = state["modules"][0]
        self.assertTrue(all(not f.startswith(first["name"]) for f in first["files"]), "paths are relative to the module root")

    def test_order_is_seeded_and_not_the_combined_rank(self):
        a = J.build_request(make_item(3), seed=7)[2]
        self.assertEqual(a, J.build_request(make_item(3), seed=7)[2])
        orders = {tuple(J.build_request(make_item(i), seed=7)[2]) for i in range(10)}
        self.assertGreater(len(orders), 3)
        ranked = tuple(c["module"] for c in make_item(0)["candidates"])
        self.assertTrue(any(o != ranked for o in orders))

    def test_redact_and_key_loading(self):
        self.assertNotIn("ghp_" + "a" * 20, J.redact("token ghp_" + "a" * 20))
        self.assertEqual(J.redact("mail bob@example.com now"), "mail [email] now")
        self.assertIn("[REDACTED]", J.redact("Authorization: Bearer abc.def.ghi"))
        with tempfile.TemporaryDirectory() as tmp:
            path = os.path.join(tmp, ".dev.vars")
            with open(path, "w") as fh:
                fh.write("OTHER_SECRET=nope\nTYPESAFE_API_KEY=" + KEY + "\nMORE=also-nope\n")
            self.assertEqual(J.load_key(path), KEY)
            with open(path, "w") as fh:
                fh.write("OTHER=1\n")
            with self.assertRaises(RuntimeError) as cm:
                J.load_key(path)
            self.assertNotIn("OTHER", str(cm.exception))

    def test_client_repr_never_shows_the_key(self):
        c = J.JevClient(key=KEY, ledger=J.Ledger(os.devnull + ".none"))
        self.assertNotIn(KEY, repr(c))


class ClientTests(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.ledger_path = os.path.join(self.tmp.name, "ledger.json")

    def tearDown(self):
        self.tmp.cleanup()

    def client(self, mock, cap=1000):
        return J.JevClient(key=KEY, ledger=J.Ledger(self.ledger_path, cap=cap), endpoint=mock.url, timeout=5)

    def test_success(self):
        mock = MockJev()
        self.addCleanup(mock.close)
        state, q, order = J.build_request(make_item(1))
        res = self.client(mock).ask(state, q, "toy")
        self.assertTrue(res["ok"])
        self.assertEqual(len(res["answers"]), 6)
        self.assertEqual(res["usage"]["input_tokens"], 100)
        self.assertGreater(res["latency_ms"], 40)
        call = mock.calls[0]
        self.assertEqual(call["auth"], f"Bearer {KEY}")
        self.assertEqual(call["body"]["model"], "jev-latest")
        self.assertEqual(call["path"], "/v1/systemone")

    def test_fatal_status_is_not_retried(self):
        mock = MockJev("402")
        self.addCleanup(mock.close)
        state, q, _ = J.build_request(make_item(1))
        res = self.client(mock).ask(state, q, "toy", fatal=J.FATAL_STATUSES)
        self.assertFalse(res["ok"])
        self.assertEqual(res["status"], 402)
        self.assertEqual(len(mock.calls), 1)
        self.assertEqual(J.Ledger(self.ledger_path).state["calls"], 1)
        self.assertEqual(J.Ledger(self.ledger_path).state["failures"], 1)
        self.assertIn("no credits", res["error"])

    def test_transient_error_is_retried_and_counted(self):
        mock = MockJev("flaky", delay=0.0)
        self.addCleanup(mock.close)
        state, q, _ = J.build_request(make_item(1))
        res = self.client(mock).ask(state, q, "toy", retries=2)
        self.assertTrue(res["ok"])
        self.assertEqual(res["attempts"], 2)
        self.assertEqual(len(mock.calls), 2)
        self.assertEqual(J.Ledger(self.ledger_path).state["calls"], 2)

    def test_bad_key_is_reported_without_leaking_it(self):
        mock = MockJev()
        self.addCleanup(mock.close)
        c = J.JevClient(key="wrong", ledger=J.Ledger(self.ledger_path), endpoint=mock.url, timeout=5)
        state, q, _ = J.build_request(make_item(1))
        res = c.ask(state, q, "toy", fatal=J.FATAL_STATUSES)
        self.assertEqual(res["status"], 401)
        self.assertNotIn(KEY, json.dumps(res))

    def test_ledger_enforces_the_cap_across_instances(self):
        mock = MockJev(delay=0.0)
        self.addCleanup(mock.close)
        state, q, _ = J.build_request(make_item(1))
        for _ in range(3):
            self.assertTrue(self.client(mock, cap=3).ask(state, q, "toy")["ok"])
        res = self.client(mock, cap=3).ask(state, q, "toy")
        self.assertFalse(res["ok"])
        self.assertEqual(res["error"], "call cap reached")
        self.assertEqual(len(mock.calls), 3)

    def test_unreachable_endpoint_does_not_raise(self):
        c = J.JevClient(key=KEY, ledger=J.Ledger(self.ledger_path), endpoint="http://127.0.0.1:9/v1/systemone", timeout=1)
        state, q, _ = J.build_request(make_item(1))
        res = c.ask(state, q, "toy", retries=0)
        self.assertFalse(res["ok"])
        self.assertIsNotNone(res["error"])


class RunTests(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.base = self.tmp.name
        self.ledger_path = os.path.join(self.base, "ledger.json")

    def tearDown(self):
        self.tmp.cleanup()

    def all_text(self):
        out = ""
        for root, _, files in os.walk(self.base):
            for f in files:
                with open(os.path.join(root, f)) as fh:
                    out += fh.read()
        return out

    def test_run_answers_everything_within_the_concurrency_cap_and_resumes(self):
        mock = MockJev(delay=0.05)
        self.addCleanup(mock.close)
        d = write_inputs(self.base, [make_item(i, "eval" if i % 4 else "tune") for i in range(24)])
        J.run("toy", self.base, workers=20, ledger_path=self.ledger_path, endpoint=mock.url, key=KEY)
        raw = J.read_jsonl(os.path.join(d, "jev_raw.jsonl"))
        self.assertEqual(len(raw), 24)
        self.assertTrue(all(r["ok"] and r["n_answered"] == 6 for r in raw))
        self.assertLessEqual(mock.max_inflight, J.MAX_CONCURRENCY)
        self.assertGreater(mock.max_inflight, 1)
        self.assertEqual(len(mock.calls), 24)
        self.assertEqual(J.Ledger(self.ledger_path).state["calls"], 24)
        self.assertEqual(J.Ledger(self.ledger_path).state["by_corpus"], {"toy": 24})
        # second run: nothing pending, nothing sent
        J.run("toy", self.base, ledger_path=self.ledger_path, endpoint=mock.url, key=KEY)
        self.assertEqual(len(mock.calls), 24)
        self.assertNotIn(KEY, self.all_text())

    def test_billing_error_stops_the_run_quickly(self):
        mock = MockJev("402", delay=0.05)
        self.addCleanup(mock.close)
        d = write_inputs(self.base, [make_item(i) for i in range(40)])
        out = J.run("toy", self.base, workers=8, ledger_path=self.ledger_path, endpoint=mock.url, key=KEY)
        self.assertEqual(out["fatal"]["status"], 402)
        self.assertLessEqual(len(mock.calls), 8 + 8)   # only requests already in flight, never the whole list
        self.assertLess(len(mock.calls), 40)
        raw = J.read_jsonl(os.path.join(d, "jev_raw.jsonl"))
        self.assertTrue(all(not r["ok"] and r["status"] == 402 for r in raw))
        self.assertNotIn(KEY, self.all_text())

    def test_repeated_client_errors_stop_the_run_before_the_cap_is_burnt(self):
        mock = MockJev("422", delay=0.02)
        self.addCleanup(mock.close)
        write_inputs(self.base, [make_item(i) for i in range(60)])
        out = J.run("toy", self.base, workers=2, ledger_path=self.ledger_path, endpoint=mock.url, key=KEY)
        self.assertEqual(out["fatal"]["status"], 422)
        self.assertLess(len(mock.calls), 12)
        self.assertEqual(J.Ledger(self.ledger_path).state["calls"], len(mock.calls))

    def test_max_candidates_limits_the_questions_and_evaluation_still_works(self):
        mock = MockJev(delay=0.0)
        self.addCleanup(mock.close)
        d = write_inputs(self.base, [make_item(i, "eval" if i % 3 else "tune", n=8) for i in range(12)])
        with open(os.path.join(d, "metrics.json"), "w") as fh:
            json.dump({"corpus": "toy", "methods": {"combined": {"threshold": 0.5, "top_k": {"k": 2}}}, "dissolvable_only_modules": []}, fh)
        J.run("toy", self.base, ledger_path=self.ledger_path, endpoint=mock.url, key=KEY, max_candidates=4)
        self.assertTrue(all(len(c["body"]["questions"]) == 4 for c in mock.calls))
        res = J.evaluate("toy", self.base)
        self.assertGreater(res["views"]["all"]["n_eval"], 0)

    def test_dry_run_sends_nothing(self):
        mock = MockJev()
        self.addCleanup(mock.close)
        write_inputs(self.base, [make_item(i) for i in range(5)])
        out = J.run("toy", self.base, ledger_path=self.ledger_path, endpoint=mock.url, key=KEY, dry=True)
        self.assertEqual(out["pending"], 5)
        self.assertEqual(mock.calls, [])

    def test_private_corpus_paths(self):
        self.assertTrue(J.out_dir("platform", "/x").endswith(os.path.join("private", "platform")))
        self.assertFalse("private" in J.out_dir("codex", "/x"))


class EvaluateTests(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.d = os.path.join(self.tmp.name, "toy")
        os.makedirs(self.d)
        items = []
        for i in range(30):
            it = make_item(100 + i, "eval" if i >= 6 else "tune", n=8)
            # combined is uninformative: it ranks the two real modules last
            for j, c in enumerate(it["candidates"]):
                c["p_combined"] = round(0.15 - 0.03 * j, 3) if j < 2 else round(0.9 - 0.1 * (j - 2), 3)
            items.append(it)
        with open(os.path.join(self.d, "jev_inputs.jsonl"), "w") as fh:
            for it in items:
                fh.write(json.dumps(it) + "\n")
        with open(os.path.join(self.d, "jev_raw.jsonl"), "w") as fh:
            for k, it in enumerate(items):
                if k == 29:   # one failed request
                    fh.write(json.dumps({"id": it["id"], "ok": False, "status": 500, "error": "boom", "attempts": 3, "latency_ms": 10.0,
                                         "est_input_tokens": 500, "usage": None, "scores": {}}) + "\n")
                    continue
                scores = {c["module"]: (0.9 if c["module"].endswith("hit") else 0.1) for c in it["candidates"]}
                fh.write(json.dumps({"id": it["id"], "ok": True, "status": 200, "attempts": 1, "latency_ms": 100.0 + k,
                                     "est_input_tokens": 400, "usage": {"input_tokens": 1000, "output_tokens": 50}, "scores": scores}) + "\n")
        with open(os.path.join(self.d, "metrics.json"), "w") as fh:
            json.dump({"corpus": "toy", "methods": {"combined": {"threshold": 0.5, "top_k": {"k": 2}}},
                       "dissolvable_only_modules": []}, fh)

    def tearDown(self):
        self.tmp.cleanup()

    def test_jev_beats_an_uninformative_combined_and_cost_is_reported(self):
        res = J.evaluate("toy", self.tmp.name)
        v = res["views"]["all"]
        self.assertEqual(v["n_eval"], 23)       # 24 eval items minus the failed one
        self.assertEqual(v["n_tune"], 6)
        self.assertGreater(v["jev"]["f1"], 0.9)
        self.assertLess(v["combined"]["f1"], 0.5)
        self.assertAlmostEqual(v["jev"]["recall_at"]["1"]["micro"], 0.5)   # 2 actual modules, top-1 finds one
        self.assertAlmostEqual(v["jev"]["recall_at"]["3"]["micro"], 1.0)
        self.assertGreater(v["jev"]["map"], v["combined"]["map"])
        self.assertIn("oracle_threshold", v["jev"])
        u = res["usage"]
        self.assertEqual(u["sampled_changes"], 30)
        self.assertEqual(u["answered"], 29)
        self.assertEqual(u["failed_final"], 1)
        self.assertEqual(u["http_requests"], 29 + 3)
        self.assertEqual(u["input_tokens_source"], "chars/4 estimate")   # one record has no usage -> fall back to the estimate
        self.assertAlmostEqual(u["estimated_cost_usd"], u["input_tokens"] / 1e6 * 0.042)
        self.assertGreater(u["latency_ms"]["p95"], u["latency_ms"]["p50"])
        self.assertTrue(os.path.exists(os.path.join(self.d, "jev_metrics.json")))
        with open(os.path.join(self.d, "metrics.json")) as fh:
            self.assertIn("jev", json.load(fh))
        self.assertIn("Jev vs combined", J.render_markdown(res, False))


class AllFailedTests(unittest.TestCase):
    def test_evaluate_with_nothing_answered_reports_failures_and_does_not_crash(self):
        with tempfile.TemporaryDirectory() as tmp:
            d = os.path.join(tmp, "toy")
            os.makedirs(d)
            items = [make_item(i, "eval" if i % 2 else "tune") for i in range(6)]
            with open(os.path.join(d, "jev_inputs.jsonl"), "w") as fh:
                fh.write("\n".join(json.dumps(it) for it in items) + "\n")
            with open(os.path.join(d, "jev_raw.jsonl"), "w") as fh:
                for it in items:
                    fh.write(json.dumps({"id": it["id"], "ok": False, "status": 402, "error": "http_402: no credits", "attempts": 1,
                                         "latency_ms": 430.0, "est_input_tokens": 2200, "usage": None, "scores": {}}) + "\n")
            with open(os.path.join(d, "metrics.json"), "w") as fh:
                json.dump({"corpus": "toy", "methods": {"combined": {"threshold": 0.5, "top_k": {"k": 2}}}}, fh)
            res = J.evaluate("toy", tmp)
            self.assertEqual(res["usage"]["answered"], 0)
            self.assertEqual(res["usage"]["failed_final"], 6)
            self.assertEqual(res["usage"]["input_tokens_source"], "chars/4 estimate")
            self.assertNotIn("combined", res["views"]["all"])
            self.assertIn("Jev vs combined", J.render_markdown(res, False))


if __name__ == "__main__":
    unittest.main()
