"""Per-language adapters: how to find test units, run one/many/all, classify processes, and map
traced paths back to repo files. Everything else (tracing, selection, mutation) is shared."""

from __future__ import annotations

import glob
import os
import re
import shutil
import struct
import subprocess

ROOT = "/work/p"
OUT = "/work/out"  # build outputs that live outside the repo (Java)


def rel(path: str) -> str | None:
    if path == ROOT or not path.startswith(ROOT + "/"):
        return None
    return path[len(ROOT) + 1:]


def files(*patterns: str) -> list[str]:
    out = set()
    for p in patterns:
        out.update(glob.glob(os.path.join(ROOT, p), recursive=True))
    return sorted(rel(f) for f in out if os.path.isfile(f))


class Lang:
    name = ""
    env: dict = {}
    parallel = 4
    unit_timeout = 180
    source_globs: list[str] = []
    helper_globs: list[str] = []
    data_globs: list[str] = []
    config_globs: list[str] = []
    test_globs: list[str] = []
    drop_prefixes: tuple[str, ...] = ()
    comment = "//"
    rename_res: list[str] = []
    bool_words = ("true", "false")
    retnull: tuple[str, str] | None = None
    skip_line_re = re.compile(r"^\s*(import|package|use|from|#\[|@|mod )")

    def units(self) -> list[str]:
        return files(*self.test_globs)

    def environ(self) -> dict:
        e = dict(os.environ)
        e.update(self.env)
        return e

    def prepare(self) -> None:
        pass

    def unit_cmd(self, unit: str) -> list[str]:
        raise NotImplementedError

    def batch_cmd(self, units: list[str]) -> list[str]:
        raise NotImplementedError

    def full_cmd(self) -> list[str]:
        return self.batch_cmd(self.units())

    def classify(self, exe: str) -> str:
        return "run"

    def normalize(self, path: str) -> list[str]:
        r = rel(path)
        out = []
        if r is not None and not r.startswith(self.drop_prefixes):
            out.append(r)
        if os.path.lexists(path):
            real = os.path.realpath(path)
            rr = rel(real)
            if rr is not None and rr != r and not rr.startswith(self.drop_prefixes):
                out.append(rr)
        return out

    def after_mutation(self) -> None:
        pass

    def retouch(self, m: dict) -> None:
        """Make build caches see the mutation as new again before the second timed run."""

    def add_specials(self) -> list[tuple[str, str, str]]:
        """(description, path, content) of file-addition mutations."""
        return []

    def freshness(self) -> dict | None:
        return None


# ---------------------------------------------------------------- Python

class Python(Lang):
    name = "python"
    env = {"PYTHONDONTWRITEBYTECODE": "1"}
    source_globs = ["src/**/*.py"]
    helper_globs = ["tests/helpers/*.py", "tests/conftest.py"]
    data_globs = ["data/*", "tests/fixtures/*"]
    config_globs = ["config/*", "pyproject.toml"]
    test_globs = ["tests/**/test_*.py"]
    drop_prefixes = (".pytest_cache",)
    comment = "#"
    rename_res = [r"^\s*def ([a-z]\w*)\("]
    bool_words = ("True", "False")
    retnull = (r"return (?!None\b)(.+)$", "return None")
    PYTEST = ["python", "-m", "pytest", "-q", "-p", "no:cacheprovider", "-x"]

    def environ(self):
        e = super().environ()
        if os.environ.get("TI_PYC"):  # keep the bytecode cache on, to show __pycache__ maps back to sources
            e.pop("PYTHONDONTWRITEBYTECODE", None)
        return e

    def unit_cmd(self, unit):
        return self.PYTEST + [unit]

    def batch_cmd(self, units):
        return self.PYTEST + units

    def normalize(self, path):
        # A cached module (__pycache__/m.cpython-313.pyc) stands for its source m.py.
        m = re.match(r"(.*)/__pycache__/([^/.]+)\.[^/]+\.pyc$", path)
        if m:
            path = f"{m.group(1)}/{m.group(2)}.py"
        return super().normalize(path)

    def add_specials(self):
        return [
            ("add a package dir that shadows shop/core/money.py",
             "src/shop/core/money/__init__.py", "raise ImportError('shadowed')\n"),
            ("add a root conftest.py that fails collection", "conftest.py", "raise RuntimeError('boom')\n"),
        ]

    def freshness(self):
        return {
            "new_test": ("tests/test_fresh_slug.py",
                         "from shop.util.strings import slugify\n\n\ndef test_fresh_slug():\n"
                         "    assert slugify('Tea Kettle') == 'tea-kettle'\n"),
            "new_dep": "src/shop/util/strings.py",
            "break_dep": ("src/shop/util/strings.py", '"-", text.lower()', '"_", text.lower()'),
            "edit_test": ("tests/test_payments.py",
                          "\n\ndef test_fresh_ids():\n    from shop.core.ids import Sequence\n"
                          "    assert Sequence('P').take() == 'P00001'\n"),
            "edit_dep": "src/shop/core/ids.py",
            "break_edit_dep": ("src/shop/core/ids.py", ':05d}', ':06d}'),
        }


# ---------------------------------------------------------------- TypeScript (Node 24, type stripping)

class TypeScript(Lang):
    name = "ts"
    source_globs = ["src/**/*.ts", "packages/utils/**/*.ts"]
    helper_globs = ["test/helpers/*.ts"]
    data_globs = ["data/*", "test/fixtures/*"]
    config_globs = ["config/*", "package.json", "packages/utils/package.json"]
    test_globs = ["test/**/*.test.ts"]
    rename_res = [r"\bfunction ([a-z]\w*)\s*[(<]", r"^\s+(?:async\s+)?([a-z]\w*)\([^)]*\)\s*(?::\s*[^={]+)?\{\s*$"]
    retnull = (r"return (?!undefined\b)([^;]+);", "return undefined;")

    def unit_cmd(self, unit):
        return ["node", "--test", "--test-reporter=dot", unit]

    def batch_cmd(self, units):
        return ["node", "--test", "--test-reporter=dot"] + units

    def add_specials(self):
        return [
            ("add a nearer node_modules/@shop/utils that shadows the workspace package",
             "src/node_modules/@shop/utils/package.json",
             '{"name":"@shop/utils","type":"module","exports":{".":"./x.js","./strings":"./x.js","./validation":"./x.js"}}\n'),
        ]


    def freshness(self):
        return {
            "new_test": ("test/fresh_slug.test.ts",
                         'import { test } from "node:test";\nimport assert from "node:assert/strict";\n'
                         'import { slugify } from "@shop/utils/strings";\n\n'
                         'test("fresh slug", () => {\n  assert.equal(slugify("Tea Kettle"), "tea-kettle");\n});\n'),
            "new_dep": "packages/utils/src/strings.ts",
            "break_dep": ("packages/utils/src/strings.ts", '/g, "-")', '/g, "_")'),
            "edit_test": ("test/payments.test.ts",
                          '\ntest("fresh ids", async () => {\n'
                          '  const { Sequence } = await import("../src/shop/core/ids.ts");\n'
                          '  assert.equal(new Sequence("P").take(), "P00001");\n});\n'),
            "edit_dep": "src/shop/core/ids.ts",
            "break_edit_dep": ("src/shop/core/ids.ts", 'padStart(5, "0")', 'padStart(6, "0")'),
        }

# ---------------------------------------------------------------- Java (javac per test closure + JUnit console)

JUNIT_JAR = "/opt/junit/junit-platform-console-standalone-1.11.4.jar"


class Java(Lang):
    name = "java"
    source_globs = ["src/main/java/**/*.java"]
    helper_globs = ["src/test/java/**/testkit/*.java"]
    data_globs = ["src/main/resources/data/**/*", "src/test/resources/**/*"]
    config_globs = ["src/main/resources/*.properties"]
    test_globs = ["src/test/java/**/*Test.java"]
    rename_res = [r"^\s+(?:public |private |protected )?(?:static )?(?:final )?[\w<>\[\],? ]+\s([a-z]\w*)\([^;]*$"]
    skip_line_re = re.compile(r"^\s*(import|package|@)")
    parallel = 6
    _n = 0
    _src_cache: dict = {}

    @staticmethod
    def _cls(test: str) -> str:
        return test[len("src/test/java/"):-len(".java")].replace("/", ".")

    def _cmd(self, tests: list[str], out: str) -> list[str]:
        sel = " ".join(f"--select-class {self._cls(t)}" for t in tests)
        srcs = " ".join(tests)
        return ["sh", "-c",
                f"rm -rf {out} && javac -nowarn -encoding UTF-8 -sourcepath src/main/java:src/test/java "
                f"-cp '/opt/junit/*' -d {out} {srcs} && "
                f"java -cp {out}:src/test/resources:src/main/resources:{JUNIT_JAR} "
                f"org.junit.platform.console.ConsoleLauncher --disable-banner --details=none "
                f"--fail-if-no-tests {sel}"]

    def unit_cmd(self, unit):
        return self._cmd([unit], f"{OUT}/{unit.replace('/', '_')}")

    def batch_cmd(self, units):
        return self._cmd(units, f"{OUT}/batch")

    def full_cmd(self):
        # The normal build compiles every main and test source, then runs every test class.
        units = self.units()
        cmd = self._cmd(units, f"{OUT}/full")
        cmd[2] = cmd[2].replace(" ".join(units), "$(find src/main/java src/test/java -name '*.java')")
        return cmd

    def classify(self, exe):
        return "build" if os.path.basename(exe) == "javac" else "run"

    def normalize(self, path):
        if path.startswith(OUT + "/") and path.endswith(".class"):
            src = self._class_source(path)
            return [src] if src else []
        return super().normalize(path)

    def _class_source(self, path: str) -> str | None:
        try:
            st = os.stat(path)
        except OSError:
            return None
        key = (path, st.st_mtime_ns)
        if key not in self._src_cache:
            self._src_cache[key] = _java_source_of(path)
        internal = self._src_cache[key]
        if not internal:
            return None
        for base in ("src/main/java", "src/test/java"):
            if os.path.exists(os.path.join(ROOT, base, internal)):
                return f"{base}/{internal}"
        return None

    def add_specials(self):
        return [
            ("add a test-resources app.properties that shadows the main config (classpath order)",
             "src/test/resources/app.properties", "currency=USD\ntax_region=NY\n"),
        ]

    def freshness(self):
        return {
            "new_test": ("src/test/java/shop/billing/FreshSlugTest.java",
                         "package shop.billing;\n\nimport static org.junit.jupiter.api.Assertions.assertEquals;\n\n"
                         "import org.junit.jupiter.api.Test;\n\nclass FreshSlugTest {\n    @Test\n    void slug() {\n"
                         "        assertEquals(\"tea-kettle\", shop.util.Strings.slugify(\"Tea Kettle\"));\n    }\n}\n"),
            "new_dep": "src/main/java/shop/util/Strings.java",
            "break_dep": ("src/main/java/shop/util/Strings.java", '"[^a-z0-9]+", "-")', '"[^a-z0-9]+", "_")'),
            # The new dependency is an inlined compile-time constant: only the compiler trace sees it.
            "edit_test": ("src/test/java/shop/billing/PaymentsTest.java",
                          "@@BEFORE_LAST_BRACE@@\n    @Test\n    void freshIds() {\n"
                          "        assertEquals(\"P00001\", new shop.core.Sequence(\"P\").take());\n    }\n"),
            "edit_dep": "src/main/java/shop/core/Limits.java",
            "break_edit_dep": ("src/main/java/shop/core/Limits.java", "ID_WIDTH = 5", "ID_WIDTH = 6"),
        }


def _java_source_of(path: str) -> str | None:
    """Reads a class file's this_class package and SourceFile attribute -> 'shop/core/Money.java'."""
    with open(path, "rb") as f:
        b = f.read()
    try:
        n = struct.unpack_from(">H", b, 8)[0]
        pos, i = 10, 1
        utf8, classes = {}, {}
        while i < n:
            tag = b[pos]
            pos += 1
            if tag == 1:
                ln = struct.unpack_from(">H", b, pos)[0]
                utf8[i] = b[pos + 2:pos + 2 + ln].decode("utf-8", "replace")
                pos += 2 + ln
            elif tag in (3, 4, 9, 10, 11, 12, 17, 18):
                pos += 4
            elif tag in (5, 6):
                pos += 8
                i += 1
            elif tag in (7, 8, 16, 19, 20):
                if tag == 7:
                    classes[i] = struct.unpack_from(">H", b, pos)[0]
                pos += 2
            elif tag == 15:
                pos += 3
            else:
                return None
            i += 1
        this_class = struct.unpack_from(">H", b, pos + 2)[0]
        name = utf8[classes[this_class]]
        pos += 6
        ic = struct.unpack_from(">H", b, pos)[0]
        pos += 2 + 2 * ic
        for _ in range(2):  # fields, methods
            cnt = struct.unpack_from(">H", b, pos)[0]
            pos += 2
            for _ in range(cnt):
                ac = struct.unpack_from(">H", b, pos + 6)[0]
                pos += 8
                for _ in range(ac):
                    pos += 6 + struct.unpack_from(">I", b, pos + 2)[0]
        ac = struct.unpack_from(">H", b, pos)[0]
        pos += 2
        for _ in range(ac):
            nm, ln = struct.unpack_from(">HI", b, pos)
            if utf8.get(nm) == "SourceFile":
                sf = utf8[struct.unpack_from(">H", b, pos + 6)[0]]
                pkg = name.rsplit("/", 1)[0] if "/" in name else ""
                return f"{pkg}/{sf}" if pkg else sf
            pos += 6 + ln
    except (struct.error, KeyError, IndexError):
        return None
    return None


# ---------------------------------------------------------------- Go

class Go(Lang):
    name = "go"
    env = {"GOFLAGS": "-mod=mod", "GOTOOLCHAIN": "local"}
    parallel = 4
    source_globs = ["internal/**/*.go"]
    helper_globs = ["internal/testkit/*.go"]
    data_globs = ["data/*", "internal/**/testdata/*", "internal/**/*.json"]
    config_globs = ["config/*", "go.mod"]
    test_globs = ["internal/**/*_test.go"]
    rename_res = [r"^func (?:\([^)]*\) )?([A-Za-z]\w*)\("]
    skip_line_re = re.compile(r"^\s*(import|package|//go:|\")")
    _funcs: dict = {}

    def units(self):
        return [u for u in files(*self.test_globs) if self.tests_in(u)]

    def source_files(self):
        return [f for f in files(*self.source_globs) if not f.endswith("_test.go")
                and not f.startswith("internal/testkit/")]

    def tests_in(self, unit):
        p = os.path.join(ROOT, unit)
        try:
            with open(p) as f:
                return re.findall(r"^func (Test\w+)\(\w+ \*testing\.T\)", f.read(), re.M)
        except OSError:
            return []

    def prepare(self):
        subprocess.run(["go", "test", "-count=1", "-run", "^$", "./..."], cwd=ROOT, env=self.environ(),
                       stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)

    def _go(self, units):
        pkgs, names = [], []
        for u in units:
            d = "./" + os.path.dirname(u)
            if d not in pkgs:
                pkgs.append(d)
            names += self.tests_in(u)
        return ["go", "test", "-count=1"] + pkgs + ["-run", "^(" + "|".join(names) + ")$"]

    def unit_cmd(self, unit):
        return self._go([unit])

    def batch_cmd(self, units):
        return self._go(units)

    def full_cmd(self):
        return ["go", "test", "-count=1", "./..."]

    def classify(self, exe):
        return "run" if exe.endswith(".test") else "build"

    def retouch(self, m):
        # Go caches by content hash: a trailing comment forces the same recompiles again.
        for e in m["edits"]:
            if e["after"] is not None and e["path"].endswith(".go"):
                with open(os.path.join(ROOT, e["path"]), "w") as f:
                    f.write(e["after"] + "\n// retouch\n")

    def add_specials(self):
        return [
            ("add a file to the money package whose init() panics",
             "internal/money/zz_added.go", "package money\n\nfunc init() { panic(\"added\") }\n"),
        ]


    def freshness(self):
        def edit(text):
            text = text.replace('"shop/internal/money"\n)', '"shop/internal/ids"\n\t"shop/internal/money"\n)', 1)
            return text + ('\nfunc TestFreshIds(t *testing.T) {\n\tif ids.NewSequence("P", 1).Take() != "P00001" {\n'
                           '\t\tt.Fatal("ids")\n\t}\n}\n')
        return {
            "new_test": ("internal/payments/fresh_test.go",
                         'package payments\n\nimport (\n\t"testing"\n\n\t"shop/internal/util/strutil"\n)\n\n'
                         'func TestFreshSlug(t *testing.T) {\n\tif strutil.Slugify("Tea Kettle") != "tea-kettle" {\n'
                         '\t\tt.Fatal("slug")\n\t}\n}\n'),
            "new_dep": "internal/util/strutil/strutil.go",
            "break_dep": ("internal/util/strutil/strutil.go", 'strings.ToLower(text), "-")', 'strings.ToLower(text), "_")'),
            "edit_test": ("internal/payments/payments_test.go", edit),
            "edit_dep": "internal/ids/ids.go",
            "break_edit_dep": ("internal/ids/ids.go", "%s%05d", "%s%06d"),
        }

# ---------------------------------------------------------------- Rust

class Rust(Lang):
    name = "rust"
    parallel = 1
    unit_timeout = 300
    env = {"CARGO_TERM_COLOR": "never", "CARGO_INCREMENTAL": "1"}
    source_globs = ["crates/*/src/**/*.rs"]
    helper_globs = ["crates/shop-testkit/src/**/*.rs"]
    data_globs = ["data/*", "crates/shop-testkit/fixtures/*"]
    config_globs = ["config/*", "Cargo.toml", "crates/*/Cargo.toml"]
    test_globs = ["crates/*/tests/*.rs"]
    drop_prefixes = ("target/",)
    rename_res = [r"\bfn ([a-z]\w*)\s*[(<]"]
    skip_line_re = re.compile(r"^\s*(use |mod |#\[|//|pub mod |pub use )")

    def source_files(self):
        return [f for f in files(*self.source_globs) if not f.startswith("crates/shop-testkit/")]

    @staticmethod
    def _crate(unit):
        toml = os.path.join(ROOT, unit.split("/tests/")[0], "Cargo.toml")
        with open(toml) as f:
            return re.search(r'^name\s*=\s*"([^"]+)"', f.read(), re.M).group(1)

    def prepare(self):
        subprocess.run(["cargo", "test", "--workspace", "--no-run", "-q"], cwd=ROOT, env=self.environ(),
                       stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)

    def unit_cmd(self, unit):
        return ["cargo", "test", "-q", "-p", self._crate(unit), "--test", os.path.basename(unit)[:-3]]

    def batch_cmd(self, units):
        cmd = ["cargo", "test", "-q"]
        for c in dict.fromkeys(self._crate(u) for u in units):
            cmd += ["-p", c]
        for u in units:
            cmd += ["--test", os.path.basename(u)[:-3]]
        return cmd

    def full_cmd(self):
        return ["cargo", "test", "-q", "--workspace"]

    def classify(self, exe):
        return "run" if "/target/debug/deps/" in exe else "build"

    def retouch(self, m):
        # Cargo fingerprints by mtime: rewriting bumps it, so the full run recompiles too.
        for e in m["edits"]:
            if e["after"] is not None:
                with open(os.path.join(ROOT, e["path"]), "w") as f:
                    f.write(e["after"])

    def add_specials(self):
        return [
            ("add a build.rs to shop-core that fails (cargo auto-detects build scripts)",
             "crates/shop-core/build.rs", "fn main() { panic!(\"added build script\"); }\n"),
        ]

    def freshness(self):
        return {
            "new_test": ("crates/shop-billing/tests/fresh_test.rs",
                         'use shop_util::strings::slugify;\n\n#[test]\nfn fresh_slug() {\n'
                         '    assert_eq!(slugify("Tea Kettle"), "tea-kettle");\n}\n'),
            "new_dep": "crates/shop-util/src/strings.rs",
            "break_dep": ("crates/shop-util/src/strings.rs", "out.push('-');", "out.push('_');"),
            "edit_test": ("crates/shop-billing/tests/payments_test.rs",
                          '\n#[test]\nfn fresh_ids() {\n    let mut s = shop_core::ids::Sequence::new("P");\n'
                          '    assert_eq!(s.take(), "P00001");\n}\n'),
            "edit_dep": "crates/shop-core/src/ids.rs",
            "break_edit_dep": ("crates/shop-core/src/ids.rs", "{:05}", "{:06}"),
        }


LANGS = {c.name: c for c in (Python, TypeScript, Java, Go, Rust)}


def clean_out():
    shutil.rmtree(OUT, ignore_errors=True)
    os.makedirs(OUT, exist_ok=True)
