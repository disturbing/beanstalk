//! Path helpers with the semantics of Python's `posixpath.normpath`, `posixpath.dirname`,
//! `os.path.realpath` and `os.path.relpath`, so read sets and junit file names match the
//! harness's `arena.py` and `ci.py` exactly.

use std::path::{Component, Path, PathBuf};

/// `posixpath.normpath`: collapses `.`, `..` and repeated slashes; a relative path keeps leading
/// `..` components and normalises to `.` when nothing is left.
#[must_use]
pub(crate) fn normalize(path: &str) -> String {
    let is_absolute = path.starts_with('/');
    let mut parts: Vec<&str> = Vec::new();
    for part in path.split('/') {
        match part {
            "" | "." => {}
            ".." if parts.last().is_some_and(|last| *last != "..") => {
                parts.pop();
            }
            ".." if is_absolute => {}
            _ => parts.push(part),
        }
    }
    let joined = parts.join("/");
    if is_absolute {
        format!("/{joined}")
    } else if joined.is_empty() {
        ".".to_owned()
    } else {
        joined
    }
}

/// `posixpath.dirname`: everything before the last `/` (trailing slashes trimmed), or `""`.
#[must_use]
pub(crate) fn parent_dir(path: &str) -> &str {
    match path.rfind('/') {
        None => "",
        Some(index) => {
            let head = &path[..=index];
            let trimmed = head.trim_end_matches('/');
            if trimmed.is_empty() { head } else { trimmed }
        }
    }
}

/// `posixpath.join(dir, path)` for a relative `path`.
#[must_use]
pub(crate) fn join(dir: &str, path: &str) -> String {
    if path.starts_with('/') || dir.is_empty() {
        path.to_owned()
    } else if dir.ends_with('/') {
        format!("{dir}{path}")
    } else {
        format!("{dir}/{path}")
    }
}

/// `os.path.realpath`: symlinks resolved; the part of the path that does not exist is kept as
/// written, after lexical normalisation.
#[must_use]
pub(crate) fn real_path(path: &Path) -> PathBuf {
    if let Ok(real) = std::fs::canonicalize(path) {
        return real;
    }
    let lexical = PathBuf::from(normalize(&path.to_string_lossy()));
    let mut existing = lexical.as_path();
    let mut missing = Vec::new();
    while let (Some(parent), Some(name)) = (existing.parent(), existing.file_name()) {
        missing.push(name.to_owned());
        existing = parent;
        if let Ok(real) = std::fs::canonicalize(existing) {
            return missing
                .iter()
                .rev()
                .fold(real, |path, name| path.join(name));
        }
    }
    lexical
}

/// `os.path.relpath(path, start)` for absolute paths, with `/` separators.
#[must_use]
pub(crate) fn relative_to(path: &Path, start: &Path) -> String {
    let path_parts = normal_components(path);
    let start_parts = normal_components(start);
    let common = path_parts
        .iter()
        .zip(&start_parts)
        .take_while(|(a, b)| a == b)
        .count();
    let ups = std::iter::repeat_n("..".to_owned(), start_parts.len() - common);
    let downs = path_parts.into_iter().skip(common);
    let parts: Vec<String> = ups.chain(downs).collect();
    if parts.is_empty() {
        ".".to_owned()
    } else {
        parts.join("/")
    }
}

fn normal_components(path: &Path) -> Vec<String> {
    path.components()
        .filter_map(|component| match component {
            Component::Normal(name) => Some(name.to_string_lossy().into_owned()),
            _ => None,
        })
        .collect()
}

#[cfg(test)]
mod tests {
    #![allow(clippy::unwrap_used, clippy::expect_used)] // tests fail loudly by design

    use proptest::prelude::*;

    use super::*;

    #[test]
    fn normalizes_like_posixpath() {
        assert_eq!(normalize("src/./cart/../lib/money.ts"), "src/lib/money.ts");
        assert_eq!(normalize("./x.ts"), "x.ts");
        assert_eq!(normalize("../x.ts"), "../x.ts");
        assert_eq!(normalize("src/../../x"), "../x");
        assert_eq!(normalize("a//b/"), "a/b");
        assert_eq!(normalize(""), ".");
        assert_eq!(normalize("/a/../../b"), "/b");
    }

    #[test]
    fn dirname_and_join_match_posixpath() {
        assert_eq!(parent_dir("src/cart/service.ts"), "src/cart");
        assert_eq!(parent_dir("app.ts"), "");
        assert_eq!(parent_dir("/x.ts"), "/");
        assert_eq!(join("src", "./a.ts"), "src/./a.ts");
        assert_eq!(join("", "./a.ts"), "./a.ts");
    }

    #[test]
    fn relative_paths_climb_out_of_the_start() {
        assert_eq!(
            relative_to(Path::new("/w/a/b.ts"), Path::new("/w")),
            "a/b.ts"
        );
        assert_eq!(
            relative_to(Path::new("/x/b.ts"), Path::new("/w/a")),
            "../../x/b.ts"
        );
        assert_eq!(relative_to(Path::new("/w"), Path::new("/w")), ".");
    }

    #[test]
    fn real_path_keeps_a_missing_tail() {
        let root = tempfile::tempdir().unwrap();
        let real_root = std::fs::canonicalize(root.path()).unwrap();

        let resolved = real_path(&root.path().join("gone/../missing.ts"));

        assert_eq!(resolved, real_root.join("missing.ts"));
    }

    proptest! {
        #[test]
        fn normalize_is_idempotent(path in "(\\.\\.?/|[a-z]{1,3}/|/){0,6}[a-z.]{0,4}") {
            let once = normalize(&path);
            prop_assert_eq!(normalize(&once), once.clone());
            prop_assert!(!once.contains("//"));
            prop_assert!(once == "." || !once.split('/').any(|part| part == "."), "{}", once);
        }
    }
}
