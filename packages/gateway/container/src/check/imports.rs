//! The static TypeScript import closure of a test file (the harness's `arena.import_depths`): the
//! files a failing test reads through relative static imports, with their distance in hops.

use std::collections::HashSet;
use std::path::{Path, PathBuf};
use std::sync::LazyLock;

use regex::Regex;
use serde::{Serialize, Serializer};

use super::paths;

/// `arena.IMPORT_RE`, verbatim.
const IMPORT_PATTERN: &str =
    r#"(?:\bfrom|\bimport|\brequire\s*\(|\bimport\s*\()\s*["']([^"'\n]+)["']"#;
/// `arena.RESOLVE_SUFFIXES`, in order.
const RESOLVE_SUFFIXES: [&str; 10] = [
    "",
    ".ts",
    ".tsx",
    ".mts",
    ".cts",
    ".js",
    ".mjs",
    "/index.ts",
    "/index.tsx",
    "/index.js",
];
/// `import_depths`' `limit`: the closure stops growing past this many files.
const MAX_CLOSURE_FILES: usize = 5000;
/// Directories `arena.list_files` never enters.
const SKIPPED_DIRS: [&str; 2] = [".git", "node_modules"];

#[allow(clippy::expect_used)] // a constant pattern, compiled by the unit tests
static IMPORT_SPEC: LazyLock<Regex> =
    LazyLock::new(|| Regex::new(IMPORT_PATTERN).expect("IMPORT_PATTERN compiles"));

/// Files reachable from a test file, in breadth-first discovery order, with their import hops.
/// Serialises as a JSON object in that order, as the harness's dict does.
#[derive(Debug, Clone, Default, PartialEq, Eq)]
pub(crate) struct ImportDepths {
    entries: Vec<(String, u32)>,
}

impl ImportDepths {
    pub(crate) fn paths(&self) -> impl Iterator<Item = &str> {
        self.entries.iter().map(|(path, _)| path.as_str())
    }

    #[cfg(test)]
    pub(crate) fn hops(&self, path: &str) -> Option<u32> {
        self.entries
            .iter()
            .find(|(entry, _)| entry == path)
            .map(|(_, hops)| *hops)
    }
}

impl Serialize for ImportDepths {
    fn serialize<S: Serializer>(&self, serializer: S) -> Result<S::Ok, S::Error> {
        serializer.collect_map(self.entries.iter().map(|(path, hops)| (path, hops)))
    }
}

/// Breadth-first import hops from `start` to every file in its static import closure.
pub(crate) fn import_depths(root: &Path, start: &str, files: &HashSet<String>) -> ImportDepths {
    let mut seen: HashSet<String> = HashSet::new();
    let mut entries = Vec::new();
    if files.contains(start) {
        seen.insert(start.to_owned());
        entries.push((start.to_owned(), 0));
    }
    let mut frontier = entries.clone();
    while !frontier.is_empty() && entries.len() < MAX_CLOSURE_FILES {
        let mut next = Vec::new();
        for (file, hops) in &frontier {
            let Some(text) = read_source(&root.join(file)) else {
                continue;
            };
            for spec in import_specs(&text) {
                let Some(resolved) = resolve_import(file, spec, files) else {
                    continue;
                };
                if seen.insert(resolved.clone()) {
                    entries.push((resolved.clone(), hops + 1));
                    next.push((resolved, hops + 1));
                }
            }
        }
        frontier = next;
    }
    ImportDepths { entries }
}

/// The repository file a relative import names (`arena.resolve_import`): TypeScript's
/// `./x.js` means `./x.ts`, then the suffixes in order.
pub(crate) fn resolve_import(
    from_file: &str,
    spec: &str,
    files: &HashSet<String>,
) -> Option<String> {
    if !spec.starts_with('.') {
        return None;
    }
    let base = paths::normalize(&paths::join(paths::parent_dir(from_file), spec));
    let ts_twin = base.strip_suffix(".js").map(|stem| format!("{stem}.ts"));
    ts_twin
        .into_iter()
        .chain(
            RESOLVE_SUFFIXES
                .iter()
                .map(|suffix| format!("{base}{suffix}")),
        )
        .find(|candidate| files.contains(candidate))
}

fn import_specs(text: &str) -> impl Iterator<Item = &str> {
    IMPORT_SPEC
        .captures_iter(text)
        .filter_map(|captures| captures.get(1))
        .map(|spec| spec.as_str())
}

/// A source file as Python's text mode reads it: invalid UTF-8 replaced, newlines universal.
fn read_source(path: &Path) -> Option<String> {
    let bytes = std::fs::read(path).ok()?;
    let text = String::from_utf8_lossy(&bytes);
    Some(text.replace("\r\n", "\n").replace('\r', "\n"))
}

/// Every file under `root`, relative and `/`-separated (`arena.list_files`): `.git` and
/// `node_modules` are skipped, and, as in `os.walk`, a symlink to a directory is neither entered
/// nor listed.
pub(crate) fn list_files(root: &Path) -> HashSet<String> {
    let mut files = HashSet::new();
    let mut pending = vec![PathBuf::new()];
    while let Some(dir) = pending.pop() {
        let Ok(entries) = std::fs::read_dir(root.join(&dir)) else {
            continue;
        };
        for entry in entries.flatten() {
            let name = entry.file_name().to_string_lossy().into_owned();
            let relative = dir.join(&name);
            match entry_kind(&entry) {
                EntryKind::Dir if !SKIPPED_DIRS.contains(&name.as_str()) => pending.push(relative),
                EntryKind::Dir | EntryKind::LinkedDir => {}
                EntryKind::File if name == ".git" => {}
                EntryKind::File => {
                    files.insert(relative.to_string_lossy().replace('\\', "/"));
                }
            }
        }
    }
    files
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum EntryKind {
    Dir,
    LinkedDir,
    File,
}

fn entry_kind(entry: &std::fs::DirEntry) -> EntryKind {
    let Ok(kind) = entry.file_type() else {
        return EntryKind::File;
    };
    if kind.is_dir() {
        EntryKind::Dir
    } else if kind.is_symlink() && entry.path().is_dir() {
        EntryKind::LinkedDir
    } else {
        EntryKind::File
    }
}

#[cfg(test)]
mod tests {
    #![allow(clippy::unwrap_used, clippy::expect_used)] // tests fail loudly by design

    use proptest::prelude::*;

    use super::*;

    fn write(root: &Path, files: &[(&str, &str)]) {
        for (path, content) in files {
            let full = root.join(path);
            std::fs::create_dir_all(full.parent().unwrap()).unwrap();
            std::fs::write(full, content).unwrap();
        }
    }

    fn file_set(paths: &[&str]) -> HashSet<String> {
        paths.iter().map(|path| (*path).to_owned()).collect()
    }

    #[test]
    fn follows_static_dynamic_and_require_imports() {
        let text = r#"import type { Cart } from "../cart/index.ts";
import { money } from './money.js';
const lazy = await import ( './lazy.ts' );
const old = require("./old");
import 'node:test';
"#;

        let specs: Vec<&str> = import_specs(text).collect();

        assert_eq!(
            specs,
            [
                "../cart/index.ts",
                "./money.js",
                "./lazy.ts",
                "./old",
                "node:test"
            ]
        );
    }

    #[test]
    fn resolves_like_the_harness() {
        let files = file_set(&["src/money.ts", "src/cart/index.ts", "src/old.mjs"]);

        assert_eq!(
            resolve_import("src/a.ts", "./money.js", &files).as_deref(),
            Some("src/money.ts")
        );
        assert_eq!(
            resolve_import("src/a.ts", "./cart", &files).as_deref(),
            Some("src/cart/index.ts")
        );
        assert_eq!(
            resolve_import("src/a.ts", "./old", &files).as_deref(),
            Some("src/old.mjs")
        );
        assert_eq!(resolve_import("src/a.ts", "node:test", &files), None);
        assert_eq!(resolve_import("src/a.ts", "../outside.ts", &files), None);
    }

    #[test]
    fn records_breadth_first_hops() {
        // The harness's own fixture: test/invoice.test.ts -> src/invoice -> src/money.
        let root = tempfile::tempdir().unwrap();
        write(
            root.path(),
            &[
                (
                    "test/invoice.test.ts",
                    "import { invoice } from '../src/invoice/index.ts';\n",
                ),
                (
                    "src/invoice/index.ts",
                    "import { round } from '../money/index.ts';\n",
                ),
                (
                    "src/money/index.ts",
                    "export const round = (x: number) => x;\n",
                ),
                ("src/users/index.ts", "export const users = [];\n"),
            ],
        );
        let files = list_files(root.path());

        let depths = import_depths(root.path(), "test/invoice.test.ts", &files);

        let order: Vec<&str> = depths.paths().collect();
        assert_eq!(
            order,
            [
                "test/invoice.test.ts",
                "src/invoice/index.ts",
                "src/money/index.ts"
            ]
        );
        assert_eq!(depths.hops("src/money/index.ts"), Some(2));
    }

    #[test]
    fn a_missing_start_has_an_empty_closure() {
        let root = tempfile::tempdir().unwrap();

        let depths = import_depths(root.path(), "gone.test.ts", &HashSet::new());

        assert_eq!(depths.paths().count(), 0);
    }

    #[test]
    fn serialises_in_discovery_order() {
        let depths = ImportDepths {
            entries: vec![("z.ts".to_owned(), 0), ("a.ts".to_owned(), 1)],
        };

        assert_eq!(
            serde_json::to_string(&depths).unwrap(),
            r#"{"z.ts":0,"a.ts":1}"#
        );
    }

    #[test]
    fn lists_files_without_git_or_node_modules() {
        let root = tempfile::tempdir().unwrap();
        write(
            root.path(),
            &[
                ("src/a.ts", ""),
                ("node_modules/x/index.js", ""),
                (".git/HEAD", ""),
                ("deep/node_modules/y.js", ""),
            ],
        );

        let files = list_files(root.path());

        assert_eq!(files, file_set(&["src/a.ts"]));
    }

    proptest! {
        #[test]
        fn import_scanning_never_panics(text in "\\PC{0,200}") {
            let files = file_set(&["a.ts"]);
            for spec in import_specs(&text) {
                let _resolved = resolve_import("src/x.ts", spec, &files);
            }
        }

        #[test]
        fn resolved_imports_are_always_repository_files(spec in "\\.{1,2}/[a-z./]{0,12}") {
            let files = file_set(&["src/a.ts", "src/b/index.ts", "c.js"]);
            if let Some(resolved) = resolve_import("src/x.ts", &spec, &files) {
                prop_assert!(files.contains(&resolved));
            }
        }
    }
}
