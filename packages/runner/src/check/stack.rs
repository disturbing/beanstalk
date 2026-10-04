//! Repository files named in failure stack traces (the harness's `arena.stack_files`).

use std::path::Path;
use std::sync::LazyLock;

use regex::Regex;

use super::paths;

/// `arena.STACK_PATH`, verbatim: an absolute `.ts`/`.js` path followed by `:<line>`.
const STACK_PATTERN: &str = r#"(?:file://)?(/[^\s:'"()]+?\.(?:ts|tsx|mts|js|mjs)):\d+"#;

#[allow(clippy::expect_used)] // a constant pattern, compiled by the unit tests
static STACK_PATH: LazyLock<Regex> =
    LazyLock::new(|| Regex::new(STACK_PATTERN).expect("STACK_PATTERN compiles"));

/// Files under `root_real` named in `text`, relative to it, in first-seen order, without
/// `node_modules`.
pub(crate) fn stack_files(text: &str, root_real: &Path) -> Vec<String> {
    let prefix = format!("{}/", root_real.to_string_lossy());
    let mut found: Vec<String> = Vec::new();
    for captures in STACK_PATH.captures_iter(text) {
        let Some(path) = captures.get(1) else {
            continue;
        };
        let real = paths::real_path(Path::new(path.as_str()));
        if !real.to_string_lossy().starts_with(&prefix) {
            continue;
        }
        let relative = paths::relative_to(&real, root_real);
        if !found.contains(&relative) && !relative.contains("node_modules") {
            found.push(relative);
        }
    }
    found
}

#[cfg(test)]
mod tests {
    #![allow(clippy::unwrap_used, clippy::expect_used)] // tests fail loudly by design

    use proptest::prelude::*;

    use super::*;

    #[test]
    fn matches_the_harness_unit_test() {
        let root = Path::new("/w/app");
        let trace = "Error\n    at total (file:///w/app/src/cart/index.ts:15:9)\n    at node:internal/x:1:1";

        assert_eq!(stack_files(trace, root), ["src/cart/index.ts"]);
    }

    #[test]
    fn keeps_first_seen_order_without_duplicates_or_outsiders() {
        let root = Path::new("/w/app");
        let trace = "at a (/w/app/src/b.ts:1:1)\nat b (/w/app/src/a.ts:2:2)\nat c (/w/app/src/b.ts:3:3)\n\
                     at d (/w/app/node_modules/x/i.js:1:1)\nat e (/w/other/z.ts:1:1)\nat f (/w/application/q.ts:1:1)";

        assert_eq!(stack_files(trace, root), ["src/b.ts", "src/a.ts"]);
    }

    proptest! {
        #[test]
        fn every_reported_file_is_inside_the_root(text in "[ -~\\n]{0,200}") {
            let root = Path::new("/w/app");
            for file in stack_files(&text, root) {
                prop_assert!(!file.starts_with('/') && !file.starts_with(".."), "{}", file);
            }
        }
    }
}
