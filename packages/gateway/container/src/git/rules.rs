//! Merge rules a request asks for: `merge=union` paths, the optional Mergiraf driver and the
//! structural tier (Mergiraf retried on exactly the paths git's own merge left conflicted).
//!
//! The harness writes `.git/info/attributes` in its integration clone. The runner shares one bare
//! cache between concurrent requests, so it writes the attributes into the request's scratch
//! directory instead and points `core.attributesFile` at it for that request's merges only. The
//! arena has no `.gitattributes`, so the two are equivalent.

use std::path::{Path, PathBuf};

use super::GitCommand;
use crate::error::{Error, Result};

/// Mergiraf's documented git driver line (`mergiraf merge --help`).
const MERGIRAF_DRIVER: &str = "mergiraf merge --git %O %A %B -s %S -x %X -y %Y -p %P -l %L";
const MAX_PATTERN_CHARS: usize = 256;
/// Extensions the structural tier hands to Mergiraf: a subset of `mergiraf languages`. Prose
/// (Markdown) is left out on purpose: no test would catch an interleaved paragraph.
const STRUCTURAL_EXTENSIONS: &[&str] = &[
    "ts", "tsx", "mts", "cts", "js", "jsx", "mjs", "cjs", "json", "yml", "yaml", "toml", "rs",
    "go", "py", "java", "kt", "c", "h", "cc", "cpp", "hpp", "cs", "rb", "php", "scala", "lua",
    "dart", "ex", "exs", "sol", "html", "xml",
];
const ATTRIBUTES_FILE: &str = "attributes";
const STRUCTURAL_ATTRIBUTES_FILE: &str = "attributes-structural";

/// A gitattributes path pattern, such as `CHANGELOG.md` or `**/CHANGELOG.md`.
#[derive(Debug, Clone, PartialEq, Eq)]
pub(crate) struct AttrPattern(String);

impl AttrPattern {
    /// # Errors
    ///
    /// A reason when `raw` could not be written as one attributes line.
    pub(crate) fn parse(raw: &str) -> Result<Self, String> {
        let is_one_token = !raw.is_empty()
            && raw.chars().count() <= MAX_PATTERN_CHARS
            && !raw.chars().any(|c| c.is_whitespace() || c.is_control());
        let is_plain_pattern = !raw.starts_with(['#', '!', '"']);
        if is_one_token && is_plain_pattern {
            Ok(Self(raw.to_owned()))
        } else {
            Err(format!("{raw:?} is not a plain gitattributes pattern"))
        }
    }
}

/// The content merge driver for files no union pattern covers.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Default)]
pub(crate) enum MergeDriver {
    /// git's own line merge: what the harness uses.
    #[default]
    Git,
    /// Mergiraf's syntax-aware merge (a separate GPL-3.0 binary in the image).
    Mergiraf,
}

/// Whether a conflict from git's merge is retried with Mergiraf before it is reported.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Default)]
pub(crate) enum StructuralTier {
    /// Report git's conflict as is: the harness's behaviour.
    #[default]
    Off,
    /// Retry the conflicted paths Mergiraf supports; keep the result only if it is clean.
    Mergiraf,
}

/// How a request wants its merges done. The default is git's plain merge (the harness's queue
/// preset); the beanstalk preset adds union patterns for changelogs.
#[derive(Debug, Clone, Default, PartialEq, Eq)]
pub(crate) struct MergeRules {
    union_paths: Vec<AttrPattern>,
    driver: MergeDriver,
    tier: StructuralTier,
    /// Literal, anchored patterns of the paths a structural retry hands to Mergiraf.
    structural_paths: Vec<AttrPattern>,
}

impl MergeRules {
    pub(crate) fn new(
        union_paths: Vec<AttrPattern>,
        driver: MergeDriver,
        tier: StructuralTier,
    ) -> Self {
        Self {
            union_paths,
            driver,
            tier,
            structural_paths: Vec::new(),
        }
    }

    /// The rules of a structural retry of `conflicted`: Mergiraf on exactly those paths, union
    /// patterns still winning. `None` when the tier is off, git's merge already was Mergiraf, or
    /// a path is one Mergiraf does not parse or one a pattern cannot name literally.
    pub(crate) fn structural_retry(&self, conflicted: &[String]) -> Option<Self> {
        let is_eligible = self.tier == StructuralTier::Mergiraf
            && self.driver == MergeDriver::Git
            && !conflicted.is_empty();
        if !is_eligible {
            return None;
        }
        let structural_paths = conflicted
            .iter()
            .map(|path| literal_pattern(path))
            .collect::<Option<Vec<_>>>()?;
        Some(Self {
            union_paths: self.union_paths.clone(),
            driver: MergeDriver::Git,
            tier: StructuralTier::Off,
            structural_paths,
        })
    }

    /// Writes the request's attributes file into `scratch` (when one is needed).
    ///
    /// # Errors
    ///
    /// [`Error::Io`] when the file cannot be written.
    pub(crate) async fn prepare(&self, scratch: &Path) -> Result<MergeSetup> {
        let file_name = if self.structural_paths.is_empty() {
            ATTRIBUTES_FILE
        } else {
            STRUCTURAL_ATTRIBUTES_FILE
        };
        let attributes_file = match self.attributes() {
            None => None,
            Some(content) => {
                let path = scratch.join(file_name);
                tokio::fs::write(&path, content)
                    .await
                    .map_err(Error::io(format!("writing {}", path.display())))?;
                Some(path)
            }
        };
        let uses_mergiraf =
            self.driver == MergeDriver::Mergiraf || !self.structural_paths.is_empty();
        Ok(MergeSetup {
            attributes_file,
            driver: if uses_mergiraf {
                MergeDriver::Mergiraf
            } else {
                MergeDriver::Git
            },
        })
    }

    /// Attributes file content; later lines win, so union patterns override the driver lines.
    fn attributes(&self) -> Option<String> {
        let driver_line =
            (self.driver == MergeDriver::Mergiraf).then(|| "* merge=mergiraf".to_owned());
        let structural_lines = self
            .structural_paths
            .iter()
            .map(|pattern| format!("{} merge=mergiraf", pattern.0));
        let union_lines = self
            .union_paths
            .iter()
            .map(|pattern| format!("{} merge=union", pattern.0));
        let lines: Vec<String> = driver_line
            .into_iter()
            .chain(structural_lines)
            .chain(union_lines)
            .collect();
        (!lines.is_empty()).then(|| lines.join("\n") + "\n")
    }
}

/// Whether the structural tier hands `path` to Mergiraf: a supported extension.
#[must_use]
pub(crate) fn is_structural(path: &str) -> bool {
    let name = path.rsplit('/').next().unwrap_or(path);
    name.rsplit_once('.').is_some_and(|(stem, extension)| {
        !stem.is_empty() && STRUCTURAL_EXTENSIONS.contains(&extension)
    })
}

/// `/<path>` as a pattern matching only that file, when `path` is structural and has no
/// character gitattributes would read as a glob or an escape.
fn literal_pattern(path: &str) -> Option<AttrPattern> {
    let is_literal = !path.contains(['*', '?', '[', '\\']);
    if !(is_literal && is_structural(path)) {
        return None;
    }
    AttrPattern::parse(&format!("/{path}")).ok()
}

/// Merge rules made concrete for one request.
#[derive(Debug)]
pub(crate) struct MergeSetup {
    attributes_file: Option<PathBuf>,
    driver: MergeDriver,
}

impl MergeSetup {
    /// Adds the attributes file and driver definition to a merge command.
    pub(crate) fn apply<'a>(&self, command: GitCommand<'a>) -> GitCommand<'a> {
        let command = match &self.attributes_file {
            Some(path) => command.config("core.attributesFile", path.to_string_lossy()),
            None => command,
        };
        match self.driver {
            MergeDriver::Git => command,
            MergeDriver::Mergiraf => command
                .config("merge.mergiraf.name", "mergiraf")
                .config("merge.mergiraf.driver", MERGIRAF_DRIVER),
        }
    }
}

#[cfg(test)]
mod tests {
    #![allow(clippy::unwrap_used, clippy::expect_used)] // tests fail loudly by design

    use super::*;

    fn patterns(raw: &[&str]) -> Vec<AttrPattern> {
        raw.iter()
            .map(|pattern| AttrPattern::parse(pattern).unwrap())
            .collect()
    }

    fn paths(raw: &[&str]) -> Vec<String> {
        raw.iter().map(|path| (*path).to_owned()).collect()
    }

    #[test]
    fn default_rules_need_no_attributes() {
        assert_eq!(MergeRules::default().attributes(), None);
    }

    #[test]
    fn union_paths_become_the_harness_attribute_lines() {
        let rules = MergeRules::new(
            patterns(&["CHANGELOG.md", "CHANGELOG*.md", "**/CHANGELOG.md"]),
            MergeDriver::Git,
            StructuralTier::Off,
        );

        assert_eq!(
            rules.attributes().unwrap(),
            "CHANGELOG.md merge=union\nCHANGELOG*.md merge=union\n**/CHANGELOG.md merge=union\n"
        );
    }

    #[test]
    fn union_lines_follow_the_mergiraf_line_so_they_win() {
        let rules = MergeRules::new(
            patterns(&["CHANGELOG.md"]),
            MergeDriver::Mergiraf,
            StructuralTier::Off,
        );

        assert_eq!(
            rules.attributes().unwrap(),
            "* merge=mergiraf\nCHANGELOG.md merge=union\n"
        );
    }

    #[test]
    fn structural_retry_names_each_conflicted_path_before_the_union_lines() {
        let rules = MergeRules::new(
            patterns(&["CHANGELOG.md"]),
            MergeDriver::Git,
            StructuralTier::Mergiraf,
        );

        let retry = rules
            .structural_retry(&paths(&["src/a.ts", "b.json"]))
            .unwrap();

        assert_eq!(
            retry.attributes().unwrap(),
            "/src/a.ts merge=mergiraf\n/b.json merge=mergiraf\nCHANGELOG.md merge=union\n"
        );
        assert_eq!(retry.structural_retry(&paths(&["src/a.ts"])), None);
    }

    #[test]
    fn structural_retry_needs_the_tier_and_every_path_supported() {
        let on = MergeRules::new(Vec::new(), MergeDriver::Git, StructuralTier::Mergiraf);
        let already = MergeRules::new(Vec::new(), MergeDriver::Mergiraf, StructuralTier::Mergiraf);
        let typescript = paths(&["src/a.ts"]);

        assert!(on.structural_retry(&typescript).is_some());
        assert!(
            MergeRules::default()
                .structural_retry(&typescript)
                .is_none()
        );
        assert!(already.structural_retry(&typescript).is_none());
        assert!(
            on.structural_retry(&paths(&["src/a.ts", "README.md"]))
                .is_none()
        );
        assert!(on.structural_retry(&paths(&["src/[x].ts"])).is_none());
        assert!(on.structural_retry(&paths(&["src/a b.ts"])).is_none());
        assert!(on.structural_retry(&[]).is_none());
    }

    #[test]
    fn structural_paths_are_judged_by_extension() {
        assert!(is_structural("src/billing/service.ts"));
        assert!(is_structural("package.json"));
        assert!(!is_structural("CHANGELOG.md"));
        assert!(!is_structural("Makefile"));
        assert!(!is_structural("src/.ts"));
        assert!(!is_structural("src.ts/readme"));
    }

    #[test]
    fn refuses_patterns_that_would_break_the_file() {
        assert!(AttrPattern::parse("a b").is_err());
        assert!(AttrPattern::parse("x\nmerge=ours").is_err());
        assert!(AttrPattern::parse("!negated").is_err());
        assert!(AttrPattern::parse("").is_err());
    }
}
