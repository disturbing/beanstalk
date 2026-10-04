#!/usr/bin/env python3
"""Footprint predictor: which modules will a change touch, given only its task text?

Library used by ``predict.py`` (the evaluation CLI) and by step 4's demo repo::

    from predictor import predict
    probs = predict("fix(auth): rate limit login", {"modules": {"src/auth": ["src/auth/login.ts"], ...},
                                                    "history": [optional corpus records, oldest first]})

``predict(text, ctx) -> {module: probability}``.  With no history it falls back to the lexical method
(TF-IDF of the task text against per-module documents built from module names and file paths), which
needs nothing but the tree.  With history it blends five signals, all strictly time-respecting (a
prediction for change k may use only changes before k and the tree at k's parent):

* ``prior``    recency-weighted module frequency over the last N changes (no text);
* ``lexical``  TF-IDF match of the task text against module names, directories and file names;
* ``knn``      past changes with similar text vote for the modules they touched;
* ``cochange`` modules the text names explicitly (``fix(core):``, ``[tui]``, paths, module names) plus
               the modules that historically change together with them;
* ``combined`` a logistic blend of the calibrated signals (weights fitted on a tuning slice).

Standard library only (Python 3.11+).
"""
from __future__ import annotations

import collections
import heapq
import json
import math
import os
import re
from typing import Iterable, Mapping, Sequence

HERE = os.path.dirname(os.path.abspath(__file__))

# --------------------------------------------------------------------------------------------------
# Text processing
# --------------------------------------------------------------------------------------------------

STOP = frozenset("""
a an the of to in for on at by with from into onto over under and or but nor so if then than as is are was were
be been being am it its this that these those there here what which who whom whose how why when where while do
does did done doing have has had having not no yes can could will would shall should may might must also only
just very more most less least other another such own same too again further once all any both each few many
much some every via per etc ie eg vs we you our your they their he she his her them i me my us
fix fixes fixed fixing add adds added adding update updates updated updating remove removes removed removing
change changes changed changing bump bumps bumped chore feat feature features refactor refactors refactored
refactoring revert wip minor patch major release releases version versions support supports supported improve
improves improved improvement allow allows allowed enable enables enabled handle handles handled ensure ensures
ensured avoid avoids prevent prevents make makes made use uses used using get gets set sets move moves moved
rename renames renamed cleanup clean simplify simplifies implement implements implemented introduce introduces
introduced address addresses issue issues pr bug bugs bugfix hotfix typo typos small tweak tweaks misc various
new old now still instead without within across around about after before during between through
""".split())

# Tokens that carry no module identity inside paths (extensions, generic layout words).
NOISE = frozenset("""
src lib index mod main js ts tsx jsx rs py md mdx json jsonc toml yaml yml mjs cjs mts cts snap lock d sh
test tests spec specs fixture fixtures e2e snapshots snapshot
""".split())

_CAMEL_A = re.compile(r"([a-z0-9])([A-Z])")
_CAMEL_B = re.compile(r"([A-Z]+)([A-Z][a-z])")
_NON_ALNUM = re.compile(r"[^A-Za-z0-9]+")
_URL = re.compile(r"https?://\S+|www\.\S+")
_HTML_COMMENT = re.compile(r"<!--.*?-->", re.S)
_MD_IMAGE = re.compile(r"!\[[^\]]*\]\([^)]*\)")
_EMAIL = re.compile(r"\S+@\S+\.\S+")
_TRAILER = re.compile(r"^\s*(?:co-authored-by|signed-off-by|reviewed-by|gitorigin-revid|generated-by|assisted-by|"
                      r"change-id|fixes|closes|resolves)\s*:.*$", re.I | re.M)
_GENERATED = re.compile(r"^.*(?:generated with|\U0001F916).*$", re.I | re.M)
_PR_SUFFIX = re.compile(r"\s*\(#\d+\)\s*$")


def split_words(text: str) -> list[str]:
    """Lower-case words of ``text``; splits camelCase, snake_case, kebab-case and path separators."""
    text = _CAMEL_A.sub(r"\1 \2", text)
    text = _CAMEL_B.sub(r"\1 \2", text)
    return [w.lower() for w in _NON_ALNUM.split(text) if w]


def stem(word: str) -> str:
    """Light plural stemmer (Harman's S-stemmer)."""
    n = len(word)
    if n > 4 and word.endswith("ies") and word[-4] not in "ae":
        return word[:-3] + "y"
    if n > 3 and word.endswith("es") and word[-3] not in "aeo":
        return word[:-1]
    if n > 3 and word.endswith("s") and word[-2] not in "us":
        return word[:-1]
    return word


def tokenize(text: str) -> list[str]:
    """Content tokens of free text: split, stop-word filtered, stemmed."""
    text = _URL.sub(" ", text)
    out = []
    for w in split_words(text):
        if len(w) < 2 or w.isdigit() or w in STOP or w in NOISE:
            continue
        s = stem(w)
        if s in STOP:
            continue
        out.append(s)
    return out


def path_tokens(path: str) -> list[str]:
    """Content tokens of a path (directory names and file name)."""
    return tokenize(path)


def clean_title(title: str) -> str:
    return _PR_SUFFIX.sub("", title or "").strip()


def clean_body(body: str, limit: int = 2500) -> str:
    """Drop trailers, comments, images, URLs and e-mail addresses from a PR body; keep the first ``limit`` chars."""
    b = body or ""
    b = _HTML_COMMENT.sub(" ", b)
    b = _TRAILER.sub(" ", b)
    b = _GENERATED.sub(" ", b)
    b = _MD_IMAGE.sub(" ", b)
    b = _URL.sub(" ", b)
    b = _EMAIL.sub(" ", b)
    return b.strip()[:limit]


def task_text(title: str, body: str = "", use_body: bool = False) -> str:
    t = clean_title(title)
    if use_body:
        b = clean_body(body)
        if b:
            return t + "\n" + b
    return t


# --------------------------------------------------------------------------------------------------
# The tree: modules, files, aliases
# --------------------------------------------------------------------------------------------------

class Catalog:
    """Module and file tree as of one commit, maintained incrementally (add / remove files)."""

    def __init__(self) -> None:
        self.file_module: dict[str, str] = {}
        self.module_files: dict[str, set[str]] = {}
        self.by_base: dict[str, set[str]] = {}
        self.version = 0  # bumps whenever the set of modules changes

    def add(self, path: str, module: str) -> None:
        if path in self.file_module:
            return
        self.file_module[path] = module
        files = self.module_files.get(module)
        if files is None:
            files = self.module_files[module] = set()
            self.version += 1
        files.add(path)
        self.by_base.setdefault(path.rsplit("/", 1)[-1].lower(), set()).add(path)

    def remove(self, path: str) -> None:
        module = self.file_module.pop(path, None)
        if module is None:
            return
        files = self.module_files[module]
        files.discard(path)
        if not files:
            del self.module_files[module]
            self.version += 1
        base = path.rsplit("/", 1)[-1].lower()
        bucket = self.by_base.get(base)
        if bucket is not None:
            bucket.discard(path)
            if not bucket:
                del self.by_base[base]

    @property
    def modules(self) -> list[str]:
        return list(self.module_files)

    BORING = frozenset(("package.json", "cargo.toml", "cargo.lock", "pnpm-lock.yaml", "package-lock.json", "yarn.lock",
                        "changelog.md", "readme.md", "tsconfig.json", ".gitignore", "license", "pyproject.toml"))

    def representative_files(self, module: str, touched: Mapping[str, int] | None = None, n: int = 5) -> list[str]:
        """Most frequently changed files of ``module`` (if history is given), padded with the shortest paths.
        Manifests, lockfiles and READMEs say nothing about what a module does, so they are used only as a last resort."""
        files = self.module_files.get(module, ())
        interesting = [p for p in files if p.rsplit("/", 1)[-1].lower() not in self.BORING]
        pool = interesting or list(files)
        pool_set = set(pool)
        picked: list[str] = []
        if touched:
            ranked = sorted(((c, p) for p, c in touched.items() if p in pool_set), key=lambda cp: (-cp[0], cp[1]))
            picked = [p for _, p in ranked[:n]]
        if len(picked) < n:
            rest = sorted((p for p in pool if p not in picked), key=lambda p: (p.count("/"), len(p), p))
            picked += rest[: n - len(picked)]
        return picked


# --------------------------------------------------------------------------------------------------
# Lexical method: TF-IDF of task tokens against per-module documents
# --------------------------------------------------------------------------------------------------

class LexicalIndex:
    """Per-module documents built from the module path (boosted) and the directories and file names of its files.

    A document is a bag of path tokens; a module is a document.  Score = cosine-style match between the
    query and the document, ``dot / (|q| * |d|**alpha * ln(1+N)**(1-alpha))`` (alpha=1 is the cosine, alpha=0 the raw dot
    product; the last factor, N = number of modules, keeps the scale comparable across repositories of different size).
    Works with an empty history; the tree is maintained incrementally with ``add_file`` / ``remove_file``.
    """

    def __init__(self, name_weight: float = 3.0, alpha: float = 1.0) -> None:
        self.name_weight = float(name_weight)
        self.alpha = float(alpha)
        self._post: dict[str, dict[str, float]] = {}
        self._nfiles: collections.Counter = collections.Counter()
        self._idf: dict[str, float] = {}
        self._norm2: dict[str, float] = {}
        self._n = 0
        self._unk_idf = 1.0

    @staticmethod
    def _relative(path: str, module: str) -> str:
        if module != "(root)" and path.startswith(module + "/"):
            return path[len(module) + 1:]
        return path

    @staticmethod
    def name_tokens(module: str) -> list[str]:
        return path_tokens(module) if module != "(root)" else ["root"]

    def _bump(self, tokens: Iterable[str], module: str, delta: float) -> None:
        post = self._post
        for t in tokens:
            d = post.get(t)
            if d is None:
                if delta < 0:
                    continue
                d = post[t] = {}
            v = d.get(module, 0.0) + delta
            if v <= 1e-9:
                d.pop(module, None)
                if not d:
                    del post[t]
            else:
                d[module] = v

    def add_file(self, path: str, module: str) -> None:
        if self._nfiles[module] == 0:
            self._bump(self.name_tokens(module), module, self.name_weight)
        self._nfiles[module] += 1
        self._bump(path_tokens(self._relative(path, module)), module, 1.0)

    def remove_file(self, path: str, module: str) -> None:
        if self._nfiles[module] <= 0:
            return
        self._bump(path_tokens(self._relative(path, module)), module, -1.0)
        self._nfiles[module] -= 1
        if self._nfiles[module] == 0:
            self._bump(self.name_tokens(module), module, -self.name_weight)
            del self._nfiles[module]

    @property
    def modules(self) -> list[str]:
        return list(self._nfiles)

    def refresh(self) -> None:
        """Recompute idf and document norms from the current tree (cheap enough to call every few changes)."""
        n = len(self._nfiles)
        self._n = n
        idf: dict[str, float] = {}
        norm2: dict[str, float] = collections.defaultdict(float)
        for t, d in self._post.items():
            w = math.log(1.0 + n / len(d))
            idf[t] = w
            for m, tf in d.items():
                x = (1.0 + math.log(tf)) * w
                norm2[m] += x * x
        self._idf = idf
        self._norm2 = dict(norm2)
        self._unk_idf = math.log(1.0 + n / 0.5) if n else 1.0

    def score(self, tokens: Sequence[str], alphas: Sequence[float] | None = None):
        """Score every module sharing a token with the query.

        Returns ``{module: score}`` for ``self.alpha``; with ``alphas`` returns ``{alpha: {module: score}}``.
        """
        if not self._idf and self._nfiles:
            self.refresh()
        q = collections.Counter(tokens)
        acc: dict[str, float] = {}
        qn2 = 0.0
        post_map = self._post
        for t, c in q.items():
            post = post_map.get(t)
            idf = self._idf.get(t)
            if idf is None:
                idf = math.log(1.0 + self._n / len(post)) if post else self._unk_idf
            qw = (1.0 + math.log(c)) * idf
            qn2 += qw * qw
            if post:
                f = qw * idf
                for m, w in post.items():
                    acc[m] = acc.get(m, 0.0) + f * (1.0 + math.log(w))
        qn = math.sqrt(qn2) or 1.0
        norms = {m: math.sqrt(self._norm2.get(m, 0.0)) or 1.0 for m in acc}

        ref = math.log(1.0 + self._n) if self._n > 0 else 1.0  # idf scale of this tree: keeps alpha < 1 scores comparable across repos

        def build(alpha: float) -> dict[str, float]:
            scale = ref ** (1.0 - alpha)
            return {m: a / (qn * norms[m] ** alpha * scale) for m, a in acc.items()}

        if alphas is None:
            return build(self.alpha)
        return {al: build(al) for al in alphas}


# --------------------------------------------------------------------------------------------------
# Prior: recency-weighted frequency of modules
# --------------------------------------------------------------------------------------------------

class RecencyPrior:
    """Share of the last ``window`` changes that touched each module, weighted by recency.

    Weight of the change ``a`` positions back is ``0.5 ** (a / halflife)``; ``halflife=None`` weights equally.
    The score of a module is therefore an estimate of the probability that the next change touches it.
    """

    def __init__(self, window: int = 400, halflife: float | None = 150.0) -> None:
        self.window = max(1, int(window))
        self.gamma = 0.5 ** (1.0 / float(halflife)) if halflife else 1.0
        self._q: collections.deque[tuple[str, ...]] = collections.deque()
        self._d: dict[str, float] = {}
        self._z = 0.0

    def add(self, modules: Iterable[str]) -> None:
        mods = tuple(modules)
        g = self.gamma
        d = self._d
        if g != 1.0:
            for m in d:
                d[m] *= g
            self._z *= g
        for m in mods:
            d[m] = d.get(m, 0.0) + 1.0
        self._z += 1.0
        self._q.append(mods)
        if len(self._q) > self.window:
            old = self._q.popleft()
            w = g ** len(self._q)
            for m in old:
                v = d.get(m, 0.0) - w
                if v <= 1e-9:
                    d.pop(m, None)
                else:
                    d[m] = v
            self._z -= w

    def scores(self) -> dict[str, float]:
        z = self._z
        if z <= 1e-12:
            return {}
        return {m: min(1.0, v / z) for m, v in self._d.items() if v > 1e-9}


# --------------------------------------------------------------------------------------------------
# kNN over past changes' text
# --------------------------------------------------------------------------------------------------

class KnnIndex:
    """TF-IDF cosine index over the text of past changes; neighbours vote for the modules they touched.

    Time-respecting: ``add`` is called for a change only after it has been predicted, and the idf snapshot is
    refreshed from documents already in the index (never from the query or later documents).
    """

    def __init__(self, refresh_every: int = 50, topn: int = 100, min_sim: float = 0.03) -> None:
        self.refresh_every = refresh_every
        self.topn = topn
        self.min_sim = min_sim
        self._post: dict[str, list[tuple[int, float]]] = {}
        self._doc_tf: list[dict[str, float]] = []
        self._doc_mods: list[tuple[str, ...]] = []
        self._doc_norm: list[float] = []
        self._idf: dict[str, float] = {}
        self._unk_idf = 1.0
        self._since = 0

    def __len__(self) -> int:
        return len(self._doc_mods)

    def _refresh(self) -> None:
        n = len(self._doc_mods)
        self._idf = {t: math.log(1.0 + n / len(p)) for t, p in self._post.items()}
        self._unk_idf = math.log(1.0 + n)
        for i, tf in enumerate(self._doc_tf):
            self._doc_norm[i] = math.sqrt(sum((w * self._idf.get(t, self._unk_idf)) ** 2 for t, w in tf.items())) or 1.0
        self._since = 0

    def add(self, tokens: Sequence[str], modules: Iterable[str]) -> int:
        counts = collections.Counter(tokens)
        tf = {t: 1.0 + math.log(c) for t, c in counts.items()}
        doc = len(self._doc_mods)
        for t, w in tf.items():
            self._post.setdefault(t, []).append((doc, w))
        self._doc_tf.append(tf)
        self._doc_mods.append(tuple(modules))
        idf = self._idf
        unk = self._unk_idf
        self._doc_norm.append(math.sqrt(sum((w * idf.get(t, unk)) ** 2 for t, w in tf.items())) or 1.0)
        self._since += 1
        if self._since >= self.refresh_every or doc == 0:
            self._refresh()
        return doc

    def neighbors(self, tokens: Sequence[str]) -> list[tuple[float, int]]:
        """Top ``topn`` ``(cosine, doc_index)`` pairs, most similar first."""
        if not self._doc_mods:
            return []
        q = collections.Counter(tokens)
        acc: dict[int, float] = {}
        qn2 = 0.0
        idf_map = self._idf
        unk = self._unk_idf
        for t, c in q.items():
            post = self._post.get(t)
            idf = idf_map.get(t)
            if idf is None:
                idf = math.log(1.0 + len(self._doc_mods) / len(post)) if post else unk
            qw = (1.0 + math.log(c)) * idf
            qn2 += qw * qw
            if post:
                f = qw * idf
                for d, w in post:
                    acc[d] = acc.get(d, 0.0) + f * w
        qn = math.sqrt(qn2) or 1.0
        norms = self._doc_norm
        scored = ((a / (qn * norms[d]), d) for d, a in acc.items())
        top = heapq.nlargest(self.topn, scored)
        return [(s, d) for s, d in top if s >= self.min_sim]

    def doc_modules(self, doc: int) -> tuple[str, ...]:
        return self._doc_mods[doc]


def _identity(x):
    return x


def knn_vote(neighbors: Sequence[tuple[float, int]], doc_modules, k: int = 20, power: float = 1.0,
             lam: float = 0.3, seq_of=None, query_seq: int | None = None, decay: float | None = None) -> dict[str, float]:
    """Similarity-weighted vote of the top-``k`` neighbours: ``sum(sim**power) over neighbours touching m``
    divided by ``sum(sim**power) + lam``.  The ``lam`` term shrinks the vote when all neighbours are weak."""
    votes: dict[str, float] = {}
    total = 0.0
    for sim, d in neighbors[:k]:
        w = sim ** power
        if decay and seq_of is not None and query_seq is not None:
            w *= 0.5 ** ((query_seq - seq_of(d)) / decay)
        total += w
        for m in doc_modules(d):
            votes[m] = votes.get(m, 0.0) + w
    if total <= 0:
        return {}
    denom = total + lam
    return {m: v / denom for m, v in votes.items()}


# --------------------------------------------------------------------------------------------------
# Explicit references in the text: scopes, paths, module names
# --------------------------------------------------------------------------------------------------

TYPE_WORDS = frozenset("""fix feat chore docs doc test tests refactor perf ci build style revert release wip hotfix deps dep bump
merge init feature bugfix cleanup misc minor major patch note todo""".split())
_TAG_BRACKET = re.compile(r"\[([^\]]{1,60})\]\s*")
_TAG_CONV = re.compile(r"([A-Za-z]+)\(([^)]{1,60})\)!?:\s*")
_TAG_PREFIX = re.compile(r"([A-Za-z0-9_./,+&| -]{1,40}?):\s+")
_TAG_SPLIT = re.compile(r"[,/+&|;]|\s+and\s+")
_PATH_RE = re.compile(r"(?<![\w@./-])(?:\.?[\w@.-]+/)+[\w@.-]+")
_FILE_RE = re.compile(r"(?<![\w./-])[\w-]+(?:\.[\w-]+)*\.(?:rs|ts|tsx|js|jsx|mjs|cjs|py|go|toml|json|jsonc|md|mdx|yml|yaml|sh|"
                      r"sql|css|html|lock)\b", re.I)


def leading_tags(title: str) -> tuple[list[str], str]:
    """Scope tags at the start of a title: ``type(scope):``, ``[tag]``, ``scope:``.  Returns (tags, remainder)."""
    s = (title or "").strip()
    tags: list[str] = []
    for _ in range(4):
        m = _TAG_BRACKET.match(s)
        if m:
            tags.append(m.group(1))
            s = s[m.end():]
            continue
        m = _TAG_CONV.match(s)
        if m:
            tags.append(m.group(2))
            s = s[m.end():]
            continue
        m = _TAG_PREFIX.match(s)
        if m:
            tag = m.group(1).strip()
            if tag.lower() not in TYPE_WORDS and not tag.isdigit():
                tags.append(tag)
            s = s[m.end():]
            continue
        break
    return tags, s


def split_tag(tag: str) -> list[str]:
    return [p.strip() for p in _TAG_SPLIT.split(tag) if p.strip()]


def alias_words(text: str) -> tuple[str, ...]:
    return tuple(stem(w) for w in split_words(text.lstrip(".@")))


def tag_keys(title: str) -> list[str]:
    """Normalised leading scope tags of a title (``fix(core):`` -> ``core``; ``[tui, core]`` -> ``tui``, ``core``)."""
    keys = []
    for tag in leading_tags(title)[0]:
        for part in split_tag(tag):
            words = alias_words(part)
            if words and not all(w.isdigit() for w in words) and len(" ".join(words)) <= 40:
                key = " ".join(words)
                if key not in keys:
                    keys.append(key)
    return keys


class RefResolver:
    """Maps explicit references in a task text to modules of the current tree.

    Returns ``(module, kind)`` pairs.  Kinds, from most to least specific: ``path_file`` (a file of the tree),
    ``path_dir`` (a directory / module path), ``path_base`` (a bare file name), ``scope`` (a title tag naming a
    module), ``scope_prefix`` / ``scope_word`` (a tag that is a prefix of, or a word in, one module's name) and
    ``name`` (a module name mentioned in the text).
    """

    def __init__(self, catalog: Catalog) -> None:
        self.cat = catalog
        self._version = -1
        self._alias: dict[tuple[str, ...], list[str]] = {}
        self._pairs: list[tuple[tuple[str, ...], str]] = []
        self._max_len = 1

    def _ensure(self) -> None:
        if self._version == self.cat.version:
            return
        alias: dict[tuple[str, ...], list[str]] = collections.defaultdict(list)
        pairs: list[tuple[tuple[str, ...], str]] = []
        for m in self.cat.module_files:
            if m == "(root)":
                continue
            segs = [s for s in m.split("/") if s]
            forms = {alias_words(segs[-1])}
            if len(segs) >= 2:
                forms.add(alias_words(segs[-2] + " " + segs[-1]))
            for f in forms:
                if not f or all((w in NOISE or w in STOP or len(w) < 2) for w in f):
                    continue
                if m not in alias[f]:
                    alias[f].append(m)
                pairs.append((f, m))
        self._alias = dict(alias)
        self._pairs = pairs
        self._max_len = max((len(k) for k in self._alias), default=1)
        self._version = self.cat.version

    # -- scopes --------------------------------------------------------------------------------
    def _lookup_scope(self, part: str) -> list[tuple[str, str]]:
        words = alias_words(part)
        words = tuple(w for w in words if w)
        if not words:
            return []
        for start in range(0, min(len(words), 3)):
            w = words[start:]
            if start and len(w) == 0:
                break
            mods = self._alias.get(w)
            if mods and len(mods) <= 4:
                return [(m, "scope") for m in mods]
        w = words
        pref = sorted({m for a, m in self._pairs if a[:len(w)] == w})
        if 1 <= len(pref) <= 2:
            return [(m, "scope_prefix") for m in pref]
        if len(w) == 1 and len(w[0]) >= 4:
            cont = sorted({m for a, m in self._pairs if w[0] in a})
            if 1 <= len(cont) <= 2:
                return [(m, "scope_word") for m in cont]
        return []

    # -- paths ---------------------------------------------------------------------------------
    def _lookup_path(self, tok: str) -> list[tuple[str, str]]:
        tok = tok.strip("`'\".,;:()[]{}<>")
        tok = tok[2:] if tok.startswith("./") else tok
        tok = tok.rstrip("/")
        if "/" not in tok or len(tok) < 3:
            return []
        out: list[tuple[str, str]] = []
        fm = self.cat.file_module
        if tok in fm:
            return [(fm[tok], "path_file")]
        best = None
        for m in self.cat.module_files:
            if m != "(root)" and (tok == m or tok.startswith(m + "/")):
                if best is None or len(m) > len(best):
                    best = m
        if best:
            return [(best, "path_dir")]
        under = sorted(m for m in self.cat.module_files if m != "(root)" and m.startswith(tok + "/"))
        if 0 < len(under) <= 3:
            return [(m, "path_dir") for m in under]
        base = tok.rsplit("/", 1)[-1].lower()
        mods = sorted({fm[p] for p in self.cat.by_base.get(base, ()) if p.endswith("/" + tok)})
        if 0 < len(mods) <= 3:
            out = [(m, "path_file") for m in mods]
        return out

    def _lookup_base(self, tok: str) -> list[tuple[str, str]]:
        paths = self.cat.by_base.get(tok.lower())
        if not paths:
            return []
        mods = sorted({self.cat.file_module[p] for p in paths})
        if 0 < len(mods) <= 3:
            return [(m, "path_base") for m in mods]
        return []

    # -- names ---------------------------------------------------------------------------------
    def _mentions(self, text: str) -> list[tuple[str, str]]:
        words = [stem(w) for w in split_words(_URL.sub(" ", text))]
        out: list[tuple[str, str]] = []
        i = 0
        n = len(words)
        while i < n:
            hit = False
            for ln in range(min(self._max_len, n - i), 0, -1):
                mods = self._alias.get(tuple(words[i:i + ln]))
                if mods:
                    if len(mods) <= 4:
                        out.extend((m, "name") for m in mods)
                    i += ln
                    hit = True
                    break
            if not hit:
                i += 1
        return out

    def resolve(self, title: str, text: str | None = None) -> list[tuple[str, str]]:
        """References in ``title`` (tags and mentions) and in ``text`` (title plus optional body)."""
        self._ensure()
        text = title if text is None else text
        found: dict[tuple[str, str], None] = {}
        tags, rest = leading_tags(title)
        for tag in tags:
            for part in split_tag(tag):
                for ref in self._lookup_scope(part):
                    found[ref] = None
        body_part = text[len(title):] if text.startswith(title) else ""
        scan_text = rest + "\n" + body_part
        for tok in _PATH_RE.findall(text):
            for ref in self._lookup_path(tok):
                found[ref] = None
        for tok in _FILE_RE.findall(text):
            if "/" in tok:
                continue
            for ref in self._lookup_base(tok):
                found[ref] = None
        for ref in self._mentions(scan_text):
            found[ref] = None
        return list(found)


class CoChange:
    """Modules the text names explicitly, expanded by what historically changes together with them.

    Explicit references come from ``RefResolver`` (paths, module names, scope tags that match a module name) and from a
    scope dictionary learned from history (a tag such as ``[c3]`` or ``fix(ci):`` maps to the modules past changes
    carrying that tag touched).  ``score = 1 - prod_r (1 - conf_r * P(m | r))`` over referenced modules ``r``
    (``P(r | r) = 1``), where ``P(m | r)`` is the share of past changes touching ``r`` that also touched ``m`` and
    ``conf_r`` is the online estimate of how often a reference of that kind to ``r`` was right (shrunk towards the
    overall rate of that kind).  Learned tags add ``P(m | tag)`` directly.
    """

    def __init__(self, window: int | None = None, max_modules: int = 25, beta: float = 1.0, kappa: float = 4.0) -> None:
        self.window = window
        self.max_modules = max_modules
        self.beta = beta
        self.kappa = kappa
        self.cnt: collections.Counter = collections.Counter()
        self.pair: dict[str, collections.Counter] = collections.defaultdict(collections.Counter)
        self._hist: collections.deque[tuple[tuple[str, ...], tuple[str, ...]]] = collections.deque()
        self._ref_stats: dict[tuple[str, str], list[int]] = collections.defaultdict(lambda: [0, 0])
        self._kind_stats: dict[str, list[int]] = collections.defaultdict(lambda: [0, 0])
        self.tag_n: collections.Counter = collections.Counter()
        self.tag_mod: dict[str, collections.Counter] = collections.defaultdict(collections.Counter)

    def confidence(self, kind: str, module: str) -> float:
        kn, kh = self._kind_stats[kind] if kind in self._kind_stats else (0, 0)
        k_rate = (kh + 1.0) / (kn + 2.0)
        mn, mh = self._ref_stats[(kind, module)] if (kind, module) in self._ref_stats else (0, 0)
        return (mh + self.kappa * k_rate) / (mn + self.kappa)

    def score(self, refs: Sequence[tuple[str, str]], tags: Sequence[str] = ()) -> dict[str, float]:
        conf: dict[str, float] = {}
        for m, kind in refs:
            c = self.confidence(kind, m)
            conf[m] = 1.0 - (1.0 - conf.get(m, 0.0)) * (1.0 - c)
        out: dict[str, float] = {}
        for r, c in conf.items():
            out[r] = 1.0 - (1.0 - out.get(r, 0.0)) * (1.0 - c)
            cr = self.cnt.get(r, 0)
            if cr <= 0:
                continue
            denom = cr + self.beta
            for m, n in self.pair[r].items():
                if m == r:
                    continue
                p = c * n / denom
                out[m] = 1.0 - (1.0 - out.get(m, 0.0)) * (1.0 - p)
        for key in tags:
            n = self.tag_n.get(key, 0)
            if n <= 0:
                continue
            for m, c in self.tag_mod[key].items():
                p = c / (n + self.beta)
                out[m] = 1.0 - (1.0 - out.get(m, 0.0)) * (1.0 - p)
        return out

    def observe(self, modules: Iterable[str], refs: Sequence[tuple[str, str]], tags: Sequence[str] = ()) -> None:
        mods = tuple(sorted(set(modules)))
        mset = set(mods)
        for m, kind in refs:
            hit = 1 if m in mset else 0
            s = self._ref_stats[(kind, m)]
            s[0] += 1
            s[1] += hit
            k = self._kind_stats[kind]
            k[0] += 1
            k[1] += hit
        if len(mods) > self.max_modules:
            return
        tags = tuple(tags)
        self._apply(mods, tags, +1)
        self._hist.append((mods, tags))
        if self.window and len(self._hist) > self.window:
            old_mods, old_tags = self._hist.popleft()
            self._apply(old_mods, old_tags, -1)

    def _apply(self, mods: tuple[str, ...], tags: tuple[str, ...], sign: int) -> None:
        for r in mods:
            self.cnt[r] += sign
            row = self.pair[r]
            for m in mods:
                if m != r:
                    row[m] += sign
        for key in tags:
            self.tag_n[key] += sign
            row = self.tag_mod[key]
            for m in mods:
                row[m] += sign
        if sign < 0:
            for r in mods:
                if self.cnt[r] <= 0:
                    del self.cnt[r]
                row = self.pair.get(r)
                if row is not None:
                    for m in [m for m, c in row.items() if c <= 0]:
                        del row[m]
            for key in tags:
                if self.tag_n[key] <= 0:
                    del self.tag_n[key]
                    self.tag_mod.pop(key, None)
                else:
                    row = self.tag_mod[key]
                    for m in [m for m, c in row.items() if c <= 0]:
                        del row[m]


# --------------------------------------------------------------------------------------------------
# Calibration and blending
# --------------------------------------------------------------------------------------------------

class Isotonic:
    """Monotone non-decreasing map from a raw score to a probability (pool-adjacent-violators)."""

    def __init__(self, xs: Sequence[float] | None = None, ys: Sequence[float] | None = None) -> None:
        self.xs = list(xs) if xs else [0.0, 1.0]
        self.ys = list(ys) if ys else [0.0, 1.0]

    @classmethod
    def fit(cls, samples: Iterable[tuple[float, float, float]], min_weight: float = 30.0) -> "Isotonic":
        """``samples`` are ``(x, y, weight)``.  Blocks lighter than ``min_weight`` are merged into a neighbour."""
        agg: dict[float, list[float]] = {}
        for x, y, w in samples:
            a = agg.get(x)
            if a is None:
                agg[x] = [w, w * y, w * x]
            else:
                a[0] += w
                a[1] += w * y
                a[2] += w * x
        if not agg:
            return cls()
        blocks: list[list[float]] = []  # [sum_w, sum_wy, sum_wx]
        for x in sorted(agg):
            blocks.append(list(agg[x]))
            while len(blocks) >= 2 and blocks[-2][1] / blocks[-2][0] > blocks[-1][1] / blocks[-1][0]:
                b = blocks.pop()
                blocks[-1][0] += b[0]
                blocks[-1][1] += b[1]
                blocks[-1][2] += b[2]
        while len(blocks) > 1:
            i = min(range(len(blocks)), key=lambda j: blocks[j][0])
            if blocks[i][0] >= min_weight:
                break
            if i == 0:
                j = 1
            elif i == len(blocks) - 1:
                j = i - 1
            else:
                mi = blocks[i][1] / blocks[i][0]
                dl = abs(mi - blocks[i - 1][1] / blocks[i - 1][0])
                dr = abs(mi - blocks[i + 1][1] / blocks[i + 1][0])
                j = i - 1 if dl <= dr else i + 1
            lo, hi = min(i, j), max(i, j)
            blocks[lo][0] += blocks[hi][0]
            blocks[lo][1] += blocks[hi][1]
            blocks[lo][2] += blocks[hi][2]
            del blocks[hi]
        xs = [b[2] / b[0] for b in blocks]
        ys = [b[1] / b[0] for b in blocks]
        # pooled blocks can end up with equal xs after merges; keep strictly increasing xs
        cx, cy = [xs[0]], [ys[0]]
        for x, y in zip(xs[1:], ys[1:]):
            if x > cx[-1] + 1e-12:
                cx.append(x)
                cy.append(max(y, cy[-1]))
        return cls(cx, cy)

    def __call__(self, x: float) -> float:
        xs, ys = self.xs, self.ys
        if x <= xs[0]:
            return ys[0]
        if x >= xs[-1]:
            return ys[-1]
        lo, hi = 0, len(xs) - 1
        while hi - lo > 1:
            mid = (lo + hi) // 2
            if xs[mid] <= x:
                lo = mid
            else:
                hi = mid
        span = xs[hi] - xs[lo]
        t = (x - xs[lo]) / span if span > 0 else 0.0
        return ys[lo] + t * (ys[hi] - ys[lo])

    def to_json(self) -> dict:
        return {"xs": [round(x, 6) for x in self.xs], "ys": [round(y, 6) for y in self.ys]}

    @classmethod
    def from_json(cls, d: Mapping) -> "Isotonic":
        return cls(d["xs"], d["ys"])


def logit(p: float, eps: float = 1e-4) -> float:
    p = min(1.0 - eps, max(eps, p))
    return math.log(p / (1.0 - p))


def sigmoid(z: float) -> float:
    if z >= 0:
        return 1.0 / (1.0 + math.exp(-z))
    e = math.exp(z)
    return e / (1.0 + e)


def fit_logistic(rows: Sequence[tuple[Sequence[float], float, float]], l2: float = 1.0, iters: int = 30) -> list[float]:
    """Newton-Raphson logistic regression.  ``rows`` are ``(features, label, weight)``; a bias is prepended.
    Returns ``[bias, w1, w2, ...]``.  ``l2`` penalises the non-bias weights."""
    if not rows:
        return []
    nf = len(rows[0][0]) + 1
    beta = [0.0] * nf
    for _ in range(iters):
        g = [0.0] * nf
        h = [[0.0] * nf for _ in range(nf)]
        for feats, y, w in rows:
            x = (1.0,) + tuple(feats)
            z = sum(b * v for b, v in zip(beta, x))
            p = sigmoid(z)
            r = w * (p - y)
            s = w * p * (1.0 - p)
            for i in range(nf):
                xi = x[i]
                g[i] += r * xi
                hi = h[i]
                sxi = s * xi
                for j in range(i, nf):
                    hi[j] += sxi * x[j]
        for i in range(nf):
            for j in range(i):
                h[i][j] = h[j][i]
        for i in range(1, nf):
            g[i] += l2 * beta[i]
            h[i][i] += l2
        h[0][0] += 1e-9
        step = _solve(h, g)
        for i in range(nf):
            beta[i] -= step[i]
        if max(abs(s) for s in step) < 1e-6:
            break
    return beta


def _solve(a: list[list[float]], b: list[float]) -> list[float]:
    n = len(b)
    m = [row[:] + [b[i]] for i, row in enumerate(a)]
    for c in range(n):
        piv = max(range(c, n), key=lambda r: abs(m[r][c]))
        if abs(m[piv][c]) < 1e-12:
            m[piv][c] = 1e-12
        m[c], m[piv] = m[piv], m[c]
        for r in range(c + 1, n):
            f = m[r][c] / m[c][c]
            if f:
                for k in range(c, n + 1):
                    m[r][k] -= f * m[c][k]
    x = [0.0] * n
    for i in range(n - 1, -1, -1):
        x[i] = (m[i][n] - sum(m[i][j] * x[j] for j in range(i + 1, n))) / m[i][i]
    return x


METHODS = ("prior", "lexical", "knn", "cochange")
BLEND_FEATURES = METHODS


class Blend:
    """Calibrated logistic blend of the four signals.  ``p = sigmoid(b + sum_i w_i * logit(cal_i(s_i)))``."""

    def __init__(self, calibrators: Mapping[str, Isotonic], beta: Sequence[float]) -> None:
        self.cal = dict(calibrators)
        self.beta = list(beta)

    def features(self, raw: Mapping[str, float]) -> list[float]:
        return [logit(self.cal[name](raw.get(name, 0.0))) for name in BLEND_FEATURES]

    def __call__(self, raw: Mapping[str, float]) -> float:
        f = self.features(raw)
        z = self.beta[0] + sum(w * v for w, v in zip(self.beta[1:], f))
        return sigmoid(z)

    def to_json(self) -> dict:
        return {"calibrators": {k: v.to_json() for k, v in self.cal.items()}, "beta": [round(b, 6) for b in self.beta]}

    @classmethod
    def from_json(cls, d: Mapping) -> "Blend":
        return cls({k: Isotonic.from_json(v) for k, v in d["calibrators"].items()}, d["beta"])


# --------------------------------------------------------------------------------------------------
# The predictor
# --------------------------------------------------------------------------------------------------

DEFAULT_PARAMS: dict = {
    "prior_window": 400, "prior_halflife": 150.0,
    "lex_name_weight": 3.0, "lex_alpha": 0.5,
    "knn_k": 20, "knn_power": 1.0, "knn_lambda": 0.3, "knn_decay": None, "knn_topn": 100,
    "co_window": None, "co_max_modules": 25, "co_beta": 1.0, "co_kappa": 4.0,
    "hist_max_modules": None,
    "lex_top": 50, "prior_top": 30,
}


def load_defaults() -> dict:
    """Shipped parameters and calibrators (``defaults.json``, written by ``predict.py --export-defaults``):
    ``lexical`` (``params``, ``calibration``) for the no-history mode, ``history`` (``params``, ``blend``) otherwise."""
    path = os.path.join(HERE, "defaults.json")
    if os.path.exists(path):
        with open(path) as fh:
            return json.load(fh)
    return {}


class Predictor:
    """Incremental predictor: maintain the tree with ``add_file`` / ``remove_file``, feed finished changes to
    ``observe``, ask for ``components`` / ``predict`` before each new change."""

    def __init__(self, params: Mapping | None = None, use_body: bool = False) -> None:
        p = dict(DEFAULT_PARAMS)
        p.update(params or {})
        self.params = p
        self.use_body = use_body
        self.catalog = Catalog()
        self.lex = LexicalIndex(p["lex_name_weight"], p["lex_alpha"])
        self.prior = RecencyPrior(p["prior_window"], p["prior_halflife"])
        self.knn = KnnIndex(topn=p["knn_topn"])
        self.resolver = RefResolver(self.catalog)
        self.co = CoChange(p["co_window"], p["co_max_modules"], p["co_beta"], p["co_kappa"])
        self.touch: dict[str, collections.Counter] = collections.defaultdict(collections.Counter)
        self.n_observed = 0
        self.blend: Blend | None = None

    # -- tree -----------------------------------------------------------------------------------
    def add_file(self, path: str, module: str) -> None:
        if path in self.catalog.file_module:
            return
        self.catalog.add(path, module)
        self.lex.add_file(path, module)

    def remove_file(self, path: str) -> None:
        module = self.catalog.file_module.get(path)
        if module is None:
            return
        self.catalog.remove(path)
        self.lex.remove_file(path, module)

    # -- history --------------------------------------------------------------------------------
    def text_of(self, title: str, body: str = "") -> str:
        return task_text(title, body, self.use_body)

    def observe(self, rec: Mapping, refs: Sequence[tuple[str, str]] | None = None) -> None:
        """Add a finished change (``title``, ``body``, ``modules``, optional ``files``) to the history.
        ``refs`` are the references ``components`` resolved for this change before it was known (recomputed if omitted)."""
        mods = list(rec.get("modules") or sorted({f["module"] for f in rec.get("files", []) if f.get("module")}))
        text = self.text_of(rec.get("title", ""), rec.get("body", ""))
        cap = self.params["hist_max_modules"]
        if not cap or len(mods) <= cap:
            self.prior.add(mods)
            self.knn.add(tokenize(text), mods)
        if refs is None:
            refs = self.resolver.resolve(clean_title(rec.get("title", "")), text)
        self.co.observe(mods, refs, tag_keys(clean_title(rec.get("title", ""))))
        for f in rec.get("files", ()):
            self.touch[f.get("module", "")][f["path"]] += 1
        self.n_observed += 1

    # -- scoring --------------------------------------------------------------------------------
    def components(self, title: str, body: str = "") -> dict:
        text = self.text_of(title, body)
        p = self.params
        tokens = tokenize(text)
        if self.lex._nfiles:
            lex = self.lex.score(tokens)
        else:
            lex = {}
        lex = dict(heapq.nlargest(p["lex_top"], lex.items(), key=lambda kv: (kv[1], kv[0]))) if lex else {}
        prior_all = self.prior.scores()
        prior = dict(heapq.nlargest(p["prior_top"], prior_all.items(), key=lambda kv: (kv[1], kv[0]))) if prior_all else {}
        nb = self.knn.neighbors(tokens)
        knn = knn_vote(nb, self.knn.doc_modules, p["knn_k"], p["knn_power"], p["knn_lambda"],
                       seq_of=_identity, query_seq=len(self.knn), decay=p["knn_decay"])
        refs = self.resolver.resolve(clean_title(title), text)
        co = self.co.score(refs, tag_keys(clean_title(title)))
        return {"prior": prior, "lexical": lex, "knn": knn, "cochange": co, "refs": refs, "neighbors": nb}

    def predict_parts(self, comps: Mapping) -> dict[str, float]:
        """Blend component scores into probabilities (needs a fitted ``self.blend``; otherwise lexical only)."""
        if self.blend is None:
            cal = getattr(self, "lexical_cal", _DEFAULT_LEXICAL_CAL)
            return {m: cal(s) for m, s in comps["lexical"].items()}
        cands = set()
        for name in METHODS:
            cands.update(comps[name])
        return {m: self.blend({name: comps[name].get(m, 0.0) for name in METHODS}) for m in cands}


# Rough default calibration of the lexical cosine to a probability, used when no fitted blend is available.
_DEFAULT_LEXICAL_CAL = Isotonic([0.0, 0.1, 0.25, 0.5, 0.8], [0.0, 0.03, 0.12, 0.35, 0.6])


def ctx_from_dir(root: str, depth: int = 2, ignore: Sequence[str] = ("node_modules", ".git", "dist", "build", "__pycache__")) -> dict:
    """``ctx["modules"]`` for a checked-out directory: module = the first ``depth`` path segments of each file's directory
    (``depth=2`` gives ``src/auth`` for ``src/auth/login.ts``); files at the top level belong to ``(root)``.
    Paths in the lists are relative to ``root``."""
    modules: dict[str, list[str]] = {}
    for dirpath, dirnames, filenames in os.walk(root):
        dirnames[:] = sorted(d for d in dirnames if d not in ignore)
        for name in sorted(filenames):
            rel = os.path.relpath(os.path.join(dirpath, name), root).replace(os.sep, "/")
            segs = rel.split("/")[:-1]
            module = "/".join(segs[:depth]) if segs else "(root)"
            modules.setdefault(module, []).append(rel)
    for files in modules.values():
        files.sort()
    return {"modules": dict(sorted(modules.items()))}


_CACHE: list = []


def _fingerprint(ctx: Mapping) -> tuple:
    mods = ctx.get("modules") or {}
    hist = ctx.get("history") or ()
    return (len(mods), sum(len(v) for v in mods.values()), len(hist))


def build_predictor(ctx: Mapping, use_body: bool = False, defaults: Mapping | None = None) -> Predictor:
    """Create a predictor from ``ctx = {"modules": {module: [paths]}, "history": [records]}``."""
    defaults = load_defaults() if defaults is None else defaults
    history = ctx.get("history") or ()
    hist_defaults = defaults.get("history") if history else None
    params = (hist_defaults or {}).get("params") or (defaults.get("lexical") or {}).get("params") or {}
    pred = Predictor(params, use_body=use_body)
    for module, paths in (ctx.get("modules") or {}).items():
        for path in (paths or [f"{module}/index"]):  # a module without files is still a candidate (matched by its name)
            pred.add_file(path, module)
    pred.lex.refresh()
    for rec in history:
        pred.observe(rec)
    if hist_defaults and hist_defaults.get("blend"):
        pred.blend = Blend.from_json(hist_defaults["blend"])
    pred.lexical_cal = (Isotonic.from_json(defaults["lexical"]["calibration"])
                        if (defaults.get("lexical") or {}).get("calibration") else _DEFAULT_LEXICAL_CAL)
    return pred


def predict(text: str, ctx: Mapping, use_body: bool = False) -> dict[str, float]:
    """Predict ``{module: probability}`` that a change described by ``text`` touches each module.

    ``ctx["modules"]`` maps module name to its file paths (the tree at the parent commit);
    ``ctx["history"]`` is an optional list of earlier changes (corpus records: ``title``, ``body``, ``modules``,
    optionally ``files``), oldest first.  With no history the result is the lexical method alone.
    The first line of ``text`` is the title; the remainder is treated as the body (used only with ``use_body=True``).
    Every module of ``ctx["modules"]`` is returned, most likely first.
    """
    fp = _fingerprint(ctx)
    pred = None
    for key_ctx, key_fp, cached in _CACHE:
        if key_ctx is ctx and key_fp == fp and cached.use_body == use_body:
            pred = cached
            break
    if pred is None:
        pred = build_predictor(ctx, use_body=use_body)
        _CACHE.append((ctx, fp, pred))
        del _CACHE[:-4]
    title, _, body = (text or "").partition("\n")
    comps = pred.components(title, body)
    if pred.n_observed > 0 and pred.blend is not None:
        probs = pred.predict_parts(comps)
    else:
        cal = getattr(pred, "lexical_cal", _DEFAULT_LEXICAL_CAL)
        probs = {m: cal(s) for m, s in comps["lexical"].items()}
    for m in (ctx.get("modules") or {}):
        probs.setdefault(m, 0.0)
    return dict(sorted(probs.items(), key=lambda kv: (-kv[1], kv[0])))
