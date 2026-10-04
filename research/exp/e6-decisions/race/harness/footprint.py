"""Footprint prediction from a task's title and prompt only (never oracle fields).

Methods, in order of preference for ``--footprint auto``:
  * ``predictor``: research/footprint-prediction/predictor.py ``predict(text, ctx) -> {module: prob}``;
  * ``lexical``: identifier overlap between the task text and each module's paths and exports;
  * ``haiku``: a ``claude -p --model haiku`` classifier returning JSON (opt-in; costs money).
"""
from __future__ import annotations

import importlib.util
import inspect
import math
import os
import re
from collections import Counter

from .arena import list_files, module_of, placement_modules

HERE = os.path.dirname(os.path.abspath(__file__))
PREDICTOR = os.path.normpath(os.path.join(HERE, "..", "..", "footprint-prediction", "predictor.py"))

STOP = set("""a an and are as at be been but by can could did do does doesn't don't each else for from get has have
how i if in into is it its it's just like make may me more most must my need needs new no not now of off on once only
or other our out over same should so some such than that the their them then there these they this those to too up us
use used uses using very via want wants was we were what when where which while who why will with without would you
your app code change changes file files add adds added support supports allow allows also""".split())
GENERIC_FILE_TOKENS = {"index", "types", "type", "util", "utils", "main", "mod", "lib", "src", "test", "tests", "ts"}
EXPORT_RE = re.compile(r"\bexport\s+(?:default\s+)?(?:declare\s+)?(?:async\s+)?(?:function\*?|class|const|let|var|"
                       r"interface|type|enum|abstract\s+class)\s+([A-Za-z_$][\w$]*)")


def split_words(text: str) -> list[str]:
    text = re.sub(r"([a-z0-9])([A-Z])", r"\1 \2", text)
    text = re.sub(r"([A-Z]+)([A-Z][a-z])", r"\1 \2", text)
    return [w for w in re.split(r"[^A-Za-z0-9]+", text.lower()) if w]


def stem(w: str) -> str:
    for suf in ("ies", "ing", "ed", "es", "s"):
        if len(w) > len(suf) + 2 and w.endswith(suf):
            return w[: -len(suf)] + ("y" if suf == "ies" else "")
    return w


def tokens(text: str) -> list[str]:
    return [stem(w) for w in split_words(text) if w not in STOP and len(w) > 1 and not w.isdigit()]


class ModuleCatalog:
    """Placement modules of the base tree with the lexical evidence for each."""

    def __init__(self, root: str):
        self.root = root
        self.files = list_files(root)
        self.modules: dict[str, dict] = {}
        for f in self.files:
            mods = placement_modules([f])
            if not mods:
                continue
            m = next(iter(mods))
            entry = self.modules.setdefault(m, {"files": [], "exports": [], "path_tokens": Counter(),
                                                "export_tokens": Counter()})
            entry["files"].append(f)
            for seg in f.split("/"):
                base = seg.rsplit(".", 1)[0]
                for t in tokens(base):
                    if t not in GENERIC_FILE_TOKENS:
                        entry["path_tokens"][t] += 1
            if f.endswith((".ts", ".tsx", ".mts", ".js", ".mjs")):
                try:
                    with open(os.path.join(root, f), encoding="utf-8", errors="replace") as fh:
                        src = fh.read()
                except OSError:
                    continue
                for name in EXPORT_RE.findall(src):
                    entry["exports"].append(name)
                    for t in tokens(name):
                        entry["export_tokens"][t] += 1
        n = max(len(self.modules), 1)
        df: Counter = Counter()
        for e in self.modules.values():
            for t in set(e["path_tokens"]) | set(e["export_tokens"]):
                df[t] += 1
        self.idf = {t: math.log(1 + n / c) for t, c in df.items()}

    def describe(self) -> list[tuple[str, str]]:
        out = []
        for m in sorted(self.modules):
            e = self.modules[m]
            files = ", ".join(os.path.basename(f) for f in e["files"][:8])
            exports = ", ".join(sorted(set(e["exports"]))[:20])
            out.append((m, f"files: {files}" + (f"; exports: {exports}" if exports else "")))
        return out

    def context(self) -> dict:
        """ctx for footprint-prediction/predictor.py: {"modules": {module: [paths]}, "history": []}."""
        return {"modules": {m: list(e["files"]) for m, e in sorted(self.modules.items())}, "history": [],
                "corpus": "arena", "module_depth": 2, "repo": self.root, "files": list(self.files)}


def _match(t: str, vocab: Counter) -> tuple[float, str | None]:
    """Exact token match (1.0), else a shared prefix of 5+ characters (0.5): router ~ routes."""
    if vocab.get(t):
        return 1.0, t
    if len(t) >= 5:
        for v in vocab:
            if len(v) >= 5 and (v.startswith(t[:5]) and t.startswith(v[:5])):
                return 0.5, v
    return 0.0, None


def lexical_predict(text: str, title: str, cat: ModuleCatalog, tau: float = 2.0) -> dict[str, float]:
    """Identifier overlap between task text and each module's path tokens (x2) and exports (x1), IDF-weighted."""
    title_toks = Counter(tokens(title))
    body_toks = Counter(tokens(text))
    scores: dict[str, float] = {}
    for m, e in cat.modules.items():
        s = 0.0
        for t in set(title_toks) | set(body_toks):
            w_text = 2.0 * min(title_toks.get(t, 0), 1) + 1.0 * min(body_toks.get(t, 0), 1)
            mp, vp = _match(t, e["path_tokens"])
            me, ve = _match(t, e["export_tokens"])
            w_mod = 2.0 * mp + 1.0 * me
            if w_text and w_mod:
                s += w_text * w_mod * cat.idf.get(vp or ve or t, 1.0)
        if s > 0:
            scores[m] = 1.0 - math.exp(-s / tau)
    return dict(sorted(scores.items(), key=lambda kv: -kv[1]))


def select(probs: dict[str, float], threshold: float, min_k: int = 1, max_k: int = 4) -> list[str]:
    ranked = sorted(probs.items(), key=lambda kv: (-kv[1], kv[0]))
    chosen = [m for m, p in ranked if p >= threshold][:max_k]
    if len(chosen) < min_k:
        chosen = [m for m, p in ranked[:min_k] if p > 0]
    return chosen


class StepTwoPredictor:
    """Wraps research/footprint-prediction/predictor.py when it exists."""

    def __init__(self, path: str = PREDICTOR):
        self.path = path
        self.fn = None
        self.error: str | None = None
        if not os.path.exists(path):
            self.error = "predictor.py not found"
            return
        try:
            spec = importlib.util.spec_from_file_location("footprint_predictor", path)
            mod = importlib.util.module_from_spec(spec)  # type: ignore[arg-type]
            assert spec and spec.loader
            spec.loader.exec_module(mod)
            self.fn = getattr(mod, "predict")
        except Exception as e:  # noqa: BLE001 - another agent's file; never let it break the race
            self.error = f"predictor.py failed to load: {e!r}"

    def __call__(self, text: str, ctx: dict) -> dict[str, float]:
        assert self.fn is not None
        try:
            params = inspect.signature(self.fn).parameters
        except (TypeError, ValueError):
            params = {}
        if "use_body" in params:  # the task prompt is part of what the scheduler may read
            out = self.fn(text, ctx, use_body=True)
        else:
            out = self.fn(text, ctx) if len(params) >= 2 or not params else self.fn(text)
        if not isinstance(out, dict):
            raise TypeError(f"predict returned {type(out).__name__}, expected dict")
        return {str(k): float(v) for k, v in out.items()}


def normalise(probs: dict[str, float], known: set[str]) -> dict[str, float]:
    """Map predictor output onto placement modules (accepts file paths or ``app/``-prefixed names)."""
    out: dict[str, float] = {}
    for k, p in probs.items():
        key = k[4:] if k.startswith("app/") else k
        if key not in known and "." in os.path.basename(key):
            key = module_of(key)
        if (known and key not in known) or p <= 0:
            continue
        out[key] = max(out.get(key, 0.0), min(p, 1.0))
    return dict(sorted(out.items(), key=lambda kv: -kv[1]))


def prf(pred: set[str], actual: set[str]) -> dict:
    tp = len(pred & actual)
    p = tp / len(pred) if pred else (1.0 if not actual else 0.0)
    r = tp / len(actual) if actual else 1.0
    f = 2 * p * r / (p + r) if p + r else 0.0
    return {"precision": round(p, 4), "recall": round(r, 4), "f1": round(f, 4), "tp": tp,
            "pred": len(pred), "actual": len(actual)}
