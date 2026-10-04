#!/usr/bin/env python3
"""Jev (TypeSafe's typed decision model) as a re-ranker of the ``combined`` module candidates.

For a seeded sample of changes, take the top-30 candidate modules of ``combined`` and ask Jev one ``noul`` question per
candidate -- "Will this change need to modify files in module <X>?" -- in a single request whose state is the task text
(the PR title) plus a short description of each candidate module (its name and representative file paths).  The
candidates are shuffled with a seeded RNG so their order does not leak ``combined``'s ranking to Jev.

    python3 jev_client.py run      workers-sdk     # needs out/<corpus>/jev_inputs.jsonl from predict.py
    python3 jev_client.py evaluate workers-sdk     # Jev vs combined on the same sample -> metrics.json / metrics.md
    python3 jev_client.py status                   # calls used so far against the cap

Endpoint and schema (from ../../../jevroute/docs/SPEC.md and its tests): ``POST https://api.typesafe.ai/v1/systemone``,
``Authorization: Bearer <key>``, body ``{model: "jev-latest", state, questions: {name: {type: "noul", instructions}}}``,
response ``{model, answers: {name: {type: "noul", noul: <float 0..1>}}, usage: {input_tokens, output_tokens}}``.

The API key is read in-process from the ``TYPESAFE_API_KEY`` line of ``/Users/coop/Workspace/hyperjev/.dev.vars`` and is
never printed, logged or written anywhere.  A persistent ledger (``out/jev_ledger.json``) enforces a hard cap of 1,000
requests across all corpora; at most 8 requests are in flight.  Standard library only.
"""
from __future__ import annotations

import argparse
import concurrent.futures
import json
import math
import os
import random
import re
import statistics
import sys
import threading
import time
import urllib.error
import urllib.request
from typing import Mapping, Sequence

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)

ENDPOINT = "https://api.typesafe.ai/v1/systemone"
MODEL = "jev-latest"
KEY_FILE = "/Users/coop/Workspace/hyperjev/.dev.vars"
KEY_NAME = "TYPESAFE_API_KEY"
CALL_CAP = 1000
MAX_CONCURRENCY = 8
PRICE_PER_M_INPUT_TOKENS = 0.042  # USD, "about $0.042 per million input tokens"
N_CANDIDATES = 30
QUESTION = "Will this change need to modify files in module {module}?"

# -- redaction (ported from jevroute's lib/jev.mjs; best effort) -----------------------------------------
_REDACTIONS = [
    re.compile(r"-----BEGIN [A-Z ]*PRIVATE KEY-----[\s\S]*?(?:-----END [A-Z ]*PRIVATE KEY-----|$)"),
    re.compile(r"\bapikey_[A-Za-z0-9]+"),
    re.compile(r"\bsk-ant-[A-Za-z0-9_-]+"),
    re.compile(r"\bsk-[A-Za-z0-9_-]{8,}"),
    re.compile(r"\b(?:rk_live|sk_live|sk_test|pk_live)_[A-Za-z0-9]+"),
    re.compile(r"\b(?:gh[opsu]_[A-Za-z0-9]{10,}|github_pat_[A-Za-z0-9_]{10,})"),
    re.compile(r"\bAKIA[0-9A-Z]{12,}"),
    re.compile(r"\bxox[bp]-[A-Za-z0-9-]{8,}"),
    re.compile(r"\bAIza[0-9A-Za-z_-]{20,}"),
    re.compile(r"\bnpm_[A-Za-z0-9]{20,}"),
    re.compile(r"\beyJ[A-Za-z0-9_-]{6,}\.[A-Za-z0-9_-]{6,}\.[A-Za-z0-9_-]*"),
    re.compile(r"\bBearer\s+\S+", re.I),
]
_KV = re.compile(r"\b(api[_-]?key|secret|token|passw(?:or)?d|authorization)(\s*[:=]\s*)\S+", re.I)
_CRED_URL = re.compile(r"(://)[^\s/@:]+:[^\s/@]+@")
_EMAIL = re.compile(r"\b[\w.+-]+@[\w-]+(?:\.[\w-]+)+\b")


def redact(text: str) -> str:
    s = str(text or "")
    for rx in _REDACTIONS:
        s = rx.sub("[REDACTED]", s)
    s = _KV.sub(lambda m: f"{m.group(1)}{m.group(2)}[REDACTED]", s)
    s = _CRED_URL.sub(r"\1[REDACTED]@", s)
    return _EMAIL.sub("[email]", s)


def estimate_tokens(text: str) -> int:
    return math.ceil(len(text) / 4)


# -- key and ledger --------------------------------------------------------------------------------------

def load_key(path: str = KEY_FILE) -> str:
    """The value of the ``TYPESAFE_API_KEY`` line; nothing else in the file is read into memory beyond that line."""
    with open(path) as fh:
        for line in fh:
            if line.startswith(KEY_NAME + "="):
                value = line.split("=", 1)[1].strip().strip('"').strip("'")
                if value:
                    return value
    raise RuntimeError(f"{KEY_NAME} not found in the key file")


class Ledger:
    """Persistent, thread-safe count of requests sent (every attempt counts, including failures)."""

    def __init__(self, path: str | None = None, cap: int = CALL_CAP) -> None:
        self.path = path or os.path.join(HERE, "out", "jev_ledger.json")
        self.cap = cap
        self._lock = threading.Lock()
        self.state = {"cap": cap, "calls": 0, "failures": 0, "by_corpus": {}}
        if os.path.exists(self.path):
            with open(self.path) as fh:
                self.state.update(json.load(fh))
        self.state["cap"] = cap

    def _save(self) -> None:
        os.makedirs(os.path.dirname(self.path), exist_ok=True)
        tmp = self.path + ".tmp"
        with open(tmp, "w") as fh:
            json.dump(self.state, fh, indent=1)
        os.replace(tmp, self.path)

    def reserve(self, corpus: str) -> bool:
        with self._lock:
            if self.state["calls"] >= self.cap:
                return False
            self.state["calls"] += 1
            self.state["by_corpus"][corpus] = self.state["by_corpus"].get(corpus, 0) + 1
            self._save()
            return True

    def record_failure(self) -> None:
        with self._lock:
            self.state["failures"] += 1
            self._save()

    @property
    def calls(self) -> int:
        return self.state["calls"]


class JevClient:
    def __init__(self, key: str | None = None, ledger: Ledger | None = None, endpoint: str = ENDPOINT,
                 timeout: float = 60.0, key_file: str = KEY_FILE) -> None:
        self._key = key if key is not None else load_key(key_file)
        self.ledger = ledger or Ledger()
        self.endpoint = endpoint
        self.timeout = timeout

    def __repr__(self) -> str:  # never expose the key
        return f"JevClient(endpoint={self.endpoint!r})"

    def _scrub(self, text: str) -> str:
        return redact(text.replace(self._key, "[KEY]"))[:300]

    def ask(self, state, questions: Mapping, corpus: str = "", retries: int = 2, fatal: Sequence[int] = ()) -> dict:
        """One request (plus up to ``retries`` retries on timeouts / 429 / 5xx).  Never raises.

        Returns ``{ok, answers, latency_ms, attempts, status, error, usage, est_input_tokens}``; latency is the
        wall-clock time of the final attempt, ``total_latency_ms`` that of all attempts.
        """
        body = json.dumps({"model": MODEL, "state": state, "questions": questions}).encode()
        est = estimate_tokens(body.decode())
        result = {"ok": False, "answers": None, "latency_ms": None, "total_latency_ms": 0.0, "attempts": 0, "status": None,
                  "error": None, "usage": None, "est_input_tokens": est}
        for attempt in range(retries + 1):
            if not self.ledger.reserve(corpus):
                result["error"] = "call cap reached"
                return result
            result["attempts"] += 1
            req = urllib.request.Request(self.endpoint, data=body, method="POST", headers={
                "authorization": f"Bearer {self._key}", "content-type": "application/json",
                "user-agent": "beanstalk-footprint-research/1.0"})
            t0 = time.time()
            retryable = False
            try:
                with urllib.request.urlopen(req, timeout=self.timeout) as resp:
                    raw = resp.read()
                    result["status"] = resp.status
                dt = (time.time() - t0) * 1000.0
                result["latency_ms"] = dt
                result["total_latency_ms"] += dt
                data = json.loads(raw)
                answers = data.get("answers")
                if not isinstance(answers, dict):
                    result["error"] = "bad_response"
                    self.ledger.record_failure()
                    return result
                result.update(ok=True, answers=answers, usage=data.get("usage"), error=None)
                return result
            except urllib.error.HTTPError as e:
                dt = (time.time() - t0) * 1000.0
                result["latency_ms"] = dt
                result["total_latency_ms"] += dt
                result["status"] = e.code
                try:
                    detail = self._scrub(e.read().decode("utf-8", "replace"))
                except Exception:  # noqa: BLE001
                    detail = ""
                finally:
                    e.close()
                result["error"] = f"http_{e.code}: {detail}"
                retryable = e.code not in fatal and (e.code in (408, 429) or e.code >= 500)
            except (urllib.error.URLError, TimeoutError, ConnectionError, OSError) as e:
                dt = (time.time() - t0) * 1000.0
                result["latency_ms"] = dt
                result["total_latency_ms"] += dt
                result["error"] = f"{type(e).__name__}: {self._scrub(str(e))}"
                retryable = True
            except (ValueError, json.JSONDecodeError):
                result["error"] = "bad_json"
            self.ledger.record_failure()
            if not retryable or attempt == retries:
                return result
            time.sleep(1.0 * (2 ** attempt))
        return result


# -- request construction --------------------------------------------------------------------------------

def relative_files(module: str, files: Sequence[str]) -> list[str]:
    out = []
    for f in files:
        out.append(f[len(module) + 1:] if module != "(root)" and f.startswith(module + "/") else f)
    return out


def build_request(item: Mapping, seed: int = 7, max_candidates: int | None = None) -> tuple[dict, dict, list[str]]:
    """(state, questions, module order) for one sampled change.  Candidates (the top ``max_candidates`` by ``combined``
    rank, default all) are shuffled so rank does not leak."""
    cands = list(item["candidates"])[:max_candidates] if max_candidates else list(item["candidates"])
    random.Random(seed * 1_000_003 + int(item["seq"])).shuffle(cands)
    state = {
        "task": redact(item["title"]),
        "modules": [{"name": c["module"], "files": relative_files(c["module"], c.get("files", []))[:5]} for c in cands],
    }
    questions = {f"m{i:02d}": {"type": "noul", "instructions": QUESTION.format(module=c["module"])} for i, c in enumerate(cands)}
    return state, questions, [c["module"] for c in cands]


# -- runner ----------------------------------------------------------------------------------------------

def out_dir(corpus: str, base: str | None = None) -> str:
    root = base or os.path.join(HERE, "out")
    private = corpus == "platform"
    return os.path.join(root, "private", corpus) if private else os.path.join(root, corpus)


def read_jsonl(path: str) -> list[dict]:
    if not os.path.exists(path):
        return []
    with open(path) as fh:
        return [json.loads(line) for line in fh if line.strip()]


FATAL_STATUSES = (401, 402, 403)  # auth / billing problems: retrying or continuing only burns the call cap
CLIENT_ERROR_STREAK = 3           # this many 4xx answers in a row (e.g. 422 for a rejected schema) also stop a run


def run(corpus: str, base: str | None = None, workers: int = MAX_CONCURRENCY, limit: int | None = None, seed: int = 7,
        key_file: str = KEY_FILE, ledger_path: str | None = None, dry: bool = False, endpoint: str | None = None,
        key: str | None = None, max_candidates: int | None = None) -> dict:
    workers = min(workers, MAX_CONCURRENCY)
    d = out_dir(corpus, base)
    items = read_jsonl(os.path.join(d, "jev_inputs.jsonl"))
    raw_path = os.path.join(d, "jev_raw.jsonl")
    done = {r["id"] for r in read_jsonl(raw_path) if r.get("ok")}
    pending = [it for it in items if it["id"] not in done]
    if limit:
        pending = pending[:limit]
    ledger = Ledger(ledger_path)  # always the canonical ledger: the cap is global, whatever --out says
    print(f"{corpus}: {len(items)} sampled changes, {len(done)} already answered, {len(pending)} to run; "
          f"ledger {ledger.calls}/{ledger.cap} calls used", file=sys.stderr)
    if dry or not pending:
        return {"pending": len(pending)}
    client = JevClient(key=key, ledger=ledger, key_file=key_file, endpoint=endpoint or ENDPOINT)
    lock = threading.Lock()
    stop = threading.Event()
    fatal: dict = {}
    streak = {"n": 0}

    def work(item: Mapping) -> None:
        if stop.is_set():
            return
        state, questions, order = build_request(item, seed, max_candidates)
        res = client.ask(state, questions, corpus, fatal=FATAL_STATUSES)
        client_error = res["status"] is not None and 400 <= res["status"] < 500 and res["status"] not in (408, 429)
        with lock:
            streak["n"] = streak["n"] + 1 if client_error else 0
            if res["status"] in FATAL_STATUSES or streak["n"] >= CLIENT_ERROR_STREAK:
                # auth / billing problem, or the same kind of request rejected again and again (a schema problem would
                # otherwise burn the whole call cap): stop sending
                fatal.setdefault("status", res["status"])
                fatal.setdefault("error", res["error"])
                stop.set()
        scores = {}
        if res["ok"]:
            for i, module in enumerate(order):
                a = res["answers"].get(f"m{i:02d}")
                if isinstance(a, dict) and isinstance(a.get("noul"), (int, float)):
                    scores[module] = float(a["noul"])
        rec = {"id": item["id"], "seq": item["seq"], "split": item["split"], "ok": res["ok"] and len(scores) == len(order),
               "status": res["status"], "error": res["error"], "attempts": res["attempts"], "latency_ms": res["latency_ms"],
               "total_latency_ms": res["total_latency_ms"], "est_input_tokens": res["est_input_tokens"], "usage": res["usage"],
               "n_questions": len(order), "n_answered": len(scores), "scores": scores}
        with lock:
            with open(raw_path, "a") as fh:
                fh.write(json.dumps(rec) + "\n")

    t0 = time.time()
    with concurrent.futures.ThreadPoolExecutor(max_workers=workers) as ex:
        list(ex.map(work, pending))
    if fatal:
        print(f"{corpus}: STOPPED after a fatal API status {fatal['status']}: {fatal['error']}", file=sys.stderr)
    print(f"{corpus}: finished in {time.time() - t0:.0f}s; ledger {ledger.calls}/{ledger.cap}", file=sys.stderr)
    return {"pending": len(pending), "fatal": fatal}


# -- evaluation: Jev vs combined on the same sample ------------------------------------------------------

def _prf(tp: int, fp: int, fn: int) -> dict:
    p = tp / (tp + fp) if tp + fp else 0.0
    r = tp / (tp + fn) if tp + fn else 0.0
    f = 2 * tp / (2 * tp + fp + fn) if 2 * tp + fp + fn else 0.0
    return {"precision": p, "recall": r, "f1": f}


def _score_sets(rows: Sequence[dict], key: str, thr: float, pool_size: int | None = None) -> dict:
    """Micro P/R/F1 of {candidate: score >= thr}; actual modules outside the candidate pool count as misses."""
    tp = fp = fn = 0
    for r in rows:
        actual = r["actual"]
        pred = {m for m, s in r[key].items() if s >= thr}
        hit = len(pred & actual)
        tp += hit
        fp += len(pred) - hit
        fn += len(actual) - hit
    out = _prf(tp, fp, fn)
    out.update(tp=tp, fp=fp, fn=fn, avg_predicted=(tp + fp) / max(1, len(rows)))
    return out


def _best_threshold(rows: Sequence[dict], key: str) -> tuple[float, float]:
    total_pos = sum(len(r["actual"]) for r in rows)
    pairs = [(s, 1 if m in r["actual"] else 0) for r in rows for m, s in r[key].items()]
    if not pairs or not total_pos:
        return 1.0, 0.0
    pairs.sort(key=lambda x: -x[0])
    tp = fp = 0
    best = (0.0, 1.0)
    i = 0
    while i < len(pairs):
        s = pairs[i][0]
        j = i
        while j < len(pairs) and pairs[j][0] == s:
            tp += pairs[j][1]
            fp += 1 - pairs[j][1]
            j += 1
        f = 2 * tp / (2 * tp + fp + (total_pos - tp))
        if f > best[0]:
            best = (f, s)
        i = j
    return best[1], best[0]


def _recall_at(rows: Sequence[dict], key: str, ks=(1, 3, 5)) -> dict:
    out = {}
    total = sum(len(r["actual"]) for r in rows)
    for k in ks:
        hits = 0
        per = 0.0
        for r in rows:
            top = [m for m, _ in sorted(r[key].items(), key=lambda kv: (-kv[1], kv[0]))[:k]]
            h = len(set(top) & r["actual"])
            hits += h
            per += h / len(r["actual"])
        out[str(k)] = {"micro": hits / total if total else 0.0, "per_change": per / max(1, len(rows))}
    return out


def _average_precision(rows: Sequence[dict], key: str) -> float:
    """Mean over changes of the average precision of the ranked candidate pool (actual modules outside the pool count as misses)."""
    aps = []
    for r in rows:
        ranked = [m for m, _ in sorted(r[key].items(), key=lambda kv: (-kv[1], kv[0]))]
        hits = 0
        s = 0.0
        for i, m in enumerate(ranked, 1):
            if m in r["actual"]:
                hits += 1
                s += hits / i
        aps.append(s / len(r["actual"]))
    return sum(aps) / len(aps) if aps else 0.0


def _per_change(rows: Sequence[dict], key: str, thr: float) -> dict:
    ps, rs, fs = [], [], []
    for r in rows:
        pred = {m for m, s in r[key].items() if s >= thr}
        hit = len(pred & r["actual"])
        p = hit / len(pred) if pred else 0.0
        rr = hit / len(r["actual"])
        ps.append(p)
        rs.append(rr)
        fs.append(2 * p * rr / (p + rr) if p + rr else 0.0)
    n = max(1, len(rows))
    return {"precision": sum(ps) / n, "recall": sum(rs) / n, "f1": sum(fs) / n}


def _logit(p: float, eps: float = 1e-3) -> float:
    p = min(1 - eps, max(eps, p))
    return math.log(p / (1 - p))


def _fit_blend(rows: Sequence[dict]) -> list[float]:
    import predictor as P  # local import: only needed for the optional blend
    data = []
    for r in rows:
        for m in r["combined"]:
            y = 1.0 if m in r["actual"] else 0.0
            data.append(([_logit(r["combined"][m]), _logit(r["jev"][m])], y, 1.0))
    return P.fit_logistic(data, l2=1.0) if data else []


def _view(items: Sequence[dict], raw: Mapping[str, dict], drop: set) -> list[dict]:
    rows = []
    for it in items:
        r = raw.get(it["id"])
        if not r or not r.get("ok"):
            continue
        actual = set(it["actual_modules"]) - drop
        if not actual:
            continue
        cands = [c for c in it["candidates"] if c["module"] not in drop and c["module"] in r["scores"]]  # asked modules only
        rows.append({"id": it["id"], "split": it["split"], "actual": actual,
                     "combined": {c["module"]: c["p_combined"] for c in cands},
                     "jev": {c["module"]: r["scores"][c["module"]] for c in cands if c["module"] in r["scores"]}})
    return rows


def evaluate(corpus: str, base: str | None = None) -> dict:
    d = out_dir(corpus, base)
    items = read_jsonl(os.path.join(d, "jev_inputs.jsonl"))
    raw_all = read_jsonl(os.path.join(d, "jev_raw.jsonl"))
    raw = {}
    for r in raw_all:  # last record per id wins
        raw[r["id"]] = r
    with open(os.path.join(d, "metrics.json")) as fh:
        metrics = json.load(fh)
    thr_combined = metrics["methods"]["combined"]["threshold"]
    k_combined = metrics["methods"]["combined"]["top_k"]["k"]
    drop = set(metrics.get("dissolvable_only_modules", []))

    def one_view(drop_set: set) -> dict:
        rows = _view(items, raw, drop_set)
        tune = [r for r in rows if r["split"] == "tune"]
        ev = [r for r in rows if r["split"] == "eval"]
        out = {"n_eval": len(ev), "n_tune": len(tune)}
        if not ev:
            return out
        # pool ceiling: actual modules outside the 30-candidate pool cannot be found by either method
        out["pool_recall"] = sum(len(r["actual"] & set(r["combined"])) for r in ev) / sum(len(r["actual"]) for r in ev)
        out["combined"] = {"threshold": thr_combined, **_score_sets(ev, "combined", thr_combined),
                           "per_change": _per_change(ev, "combined", thr_combined),
                           "recall_at": _recall_at(ev, "combined"), "map": _average_precision(ev, "combined")}
        jthr_tune, jf1_tune = _best_threshold(tune, "jev") if tune else (0.5, 0.0)
        jthr_oracle, jf1_oracle = _best_threshold(ev, "jev")
        out["jev"] = {"threshold": jthr_tune, "threshold_source": f"tuning sample ({len(tune)} changes)", "tuning_f1": jf1_tune,
                      **_score_sets(ev, "jev", jthr_tune), "per_change": _per_change(ev, "jev", jthr_tune),
                      "recall_at": _recall_at(ev, "jev"), "map": _average_precision(ev, "jev"),
                      "oracle_threshold": {"threshold": jthr_oracle, **_score_sets(ev, "jev", jthr_oracle)}}
        if tune:
            beta = _fit_blend(tune)
            if beta:
                for rows_ in (tune, ev):
                    for r in rows_:
                        r["blend"] = {m: 1 / (1 + math.exp(-(beta[0] + beta[1] * _logit(r["combined"][m]) + beta[2] * _logit(r["jev"][m]))))
                                      for m in r["combined"] if m in r["jev"]}
                bthr, btf1 = _best_threshold(tune, "blend")
                out["blend"] = {"weights": [round(b, 3) for b in beta], "threshold": bthr, "tuning_f1": btf1,
                                **_score_sets(ev, "blend", bthr), "per_change": _per_change(ev, "blend", bthr),
                                "recall_at": _recall_at(ev, "blend"), "map": _average_precision(ev, "blend")}
        return out

    result = {"views": {"all": one_view(set())}, "n_candidates": N_CANDIDATES}
    if drop:
        result["views"]["substantive"] = one_view(drop)
    # cost / latency / failures over every request recorded for this corpus
    lat = [r["latency_ms"] for r in raw.values() if r.get("ok") and r.get("latency_ms") is not None]
    in_tok = [r["usage"]["input_tokens"] for r in raw.values() if r.get("usage") and "input_tokens" in r["usage"]]
    out_tok = [r["usage"]["output_tokens"] for r in raw.values() if r.get("usage") and "output_tokens" in r["usage"]]
    est = [r["est_input_tokens"] for r in raw.values()]
    attempts = sum(r.get("attempts", 1) for r in raw_all)
    failed_final = [r for r in raw.values() if not r.get("ok")]
    tokens_in = sum(in_tok) if len(in_tok) == len(raw) and in_tok else sum(est)
    lat_sorted = sorted(lat)
    result["usage"] = {
        "sampled_changes": len(items), "answered": sum(1 for r in raw.values() if r.get("ok")), "failed_final": len(failed_final),
        "http_requests": attempts, "retries": attempts - len(raw_all),
        "latency_ms": ({"mean": statistics.fmean(lat), "p50": lat_sorted[len(lat_sorted) // 2],
                        "p95": lat_sorted[min(len(lat_sorted) - 1, int(0.95 * len(lat_sorted)))], "max": lat_sorted[-1]} if lat else None),
        "input_tokens": tokens_in, "input_tokens_source": "api usage" if len(in_tok) == len(raw) and in_tok else "chars/4 estimate",
        "estimated_input_tokens_chars_div_4": sum(est), "output_tokens": sum(out_tok) if out_tok else None,
        "estimated_cost_usd": tokens_in / 1e6 * PRICE_PER_M_INPUT_TOKENS,
        "errors": sorted({(r.get("error") or "")[:60] for r in failed_final}),
    }
    metrics["jev"] = result
    import predict as PR
    PR.write_atomic(os.path.join(d, "jev_metrics.json"), json.dumps(result, indent=1))
    PR.write_atomic(os.path.join(d, "metrics.json"), json.dumps(metrics, indent=1))
    try:  # metrics.md gets the Jev section; skipped if metrics.json is not a full predict.py output
        PR.write_atomic(os.path.join(d, "metrics.md"), PR.render_markdown(metrics, corpus == "platform"))
    except KeyError:
        pass
    return result


def render_markdown(res: Mapping, private: bool) -> str:
    lines = ["### Jev vs combined, same sample (title-only)", ""]
    u = res["usage"]
    lines.append(f"Sample: {u['sampled_changes']} changes ({u['answered']} answered, {u['failed_final']} failed). "
                 f"One request per change with {res['n_candidates']} `noul` questions over the top-{res['n_candidates']} `combined` candidates "
                 f"(shuffled). Jev's threshold comes from the tuning-slice sample; `oracle thr` is optimistic (chosen on the evaluation sample).")
    lines.append("")
    for view, v in res["views"].items():
        if not v.get("combined"):
            continue
        lines.append(f"**{view} modules** (eval sample {v['n_eval']} changes; pool recall ceiling {v['pool_recall']:.3f})")
        lines.append("")
        lines.append("| scorer | thr | P | R | F1 | per-change F1 | R@1 | R@3 | R@5 | MAP |")
        lines.append("|---|---|---|---|---|---|---|---|---|---|")

        def row(name, d):
            ra = d["recall_at"]
            return (f"| {name} | {d['threshold']:.3f} | {d['precision']:.3f} | {d['recall']:.3f} | {d['f1']:.3f} | {d['per_change']['f1']:.3f} | "
                    f"{ra['1']['micro']:.3f} | {ra['3']['micro']:.3f} | {ra['5']['micro']:.3f} | {d['map']:.3f} |")
        lines.append(row("combined", v["combined"]))
        lines.append(row("jev", v["jev"]))
        if v["jev"].get("oracle_threshold"):
            o = v["jev"]["oracle_threshold"]
            lines.append(f"| jev (oracle thr) | {o['threshold']:.3f} | {o['precision']:.3f} | {o['recall']:.3f} | {o['f1']:.3f} | | | | | |")
        if v.get("blend"):
            lines.append(row("combined+jev", v["blend"]))
        lines.append("")
    lat = u.get("latency_ms")
    if lat:
        lines.append(f"Latency per request (ms): mean {lat['mean']:.0f}, p50 {lat['p50']:.0f}, p95 {lat['p95']:.0f}, max {lat['max']:.0f}. "
                     f"HTTP requests {u['http_requests']} (retries {u['retries']}), failures after retries {u['failed_final']}. "
                     f"Input tokens {u['input_tokens']:,} ({u['input_tokens_source']}), estimated cost ${u['estimated_cost_usd']:.4f} "
                     f"at ${PRICE_PER_M_INPUT_TOKENS}/M input tokens.")
    return "\n".join(lines)


def status() -> int:
    ledger = Ledger()
    print(json.dumps(ledger.state, indent=1))
    return 0


def main(argv: list[str] | None = None) -> int:
    ap = argparse.ArgumentParser(description=__doc__.split("\n\n")[0],
                                 epilog="The API key is read from the TYPESAFE_API_KEY line of the key file; it is never printed.")
    sub = ap.add_subparsers(dest="cmd", required=True)
    r = sub.add_parser("run", help="send the sampled changes to Jev")
    r.add_argument("corpus")
    r.add_argument("--out", help="output base dir (default ./out)")
    r.add_argument("--workers", type=int, default=MAX_CONCURRENCY, help=f"concurrent requests (max {MAX_CONCURRENCY})")
    r.add_argument("--limit", type=int, help="send at most N pending changes")
    r.add_argument("--seed", type=int, default=7)
    r.add_argument("--max-candidates", type=int, help="ask only about the top N combined candidates (default: all 30); "
                                                      "use a smaller N if the API rejects 30 questions per request")
    r.add_argument("--key-file", default=KEY_FILE)
    r.add_argument("--dry", action="store_true", help="count pending changes, send nothing")
    e = sub.add_parser("evaluate", help="Jev vs combined on the answered sample")
    e.add_argument("corpus")
    e.add_argument("--out")
    sub.add_parser("status", help="show the call ledger")
    a = ap.parse_args(argv)
    if a.cmd == "run":
        run(a.corpus, a.out, a.workers, a.limit, a.seed, a.key_file, dry=a.dry, max_candidates=a.max_candidates)
    elif a.cmd == "evaluate":
        res = evaluate(a.corpus, a.out)
        print(render_markdown(res, a.corpus == "platform"))
    else:
        return status()
    return 0


if __name__ == "__main__":
    sys.exit(main())
