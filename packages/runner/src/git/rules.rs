//! Merge rules a request asks for: `merge=union` paths and the optional Mergiraf driver.
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

/// How a request wants its merges done. The default is git's plain merge (the harness's queue
/// preset); the beanstalk preset adds union patterns for changelogs.
#[derive(Debug, Clone, Default, PartialEq, Eq)]
pub(crate) struct MergeRules {
    union_paths: Vec<AttrPattern>,
    driver: MergeDriver,
}

impl MergeRules {
    pub(crate) fn new(union_paths: Vec<AttrPattern>, driver: MergeDriver) -> Self {
        Self {
            union_paths,
            driver,
        }
    }

    /// Writes the request's attributes file into `scratch` (when one is needed).
    ///
    /// # Errors
    ///
    /// [`Error::Io`] when the file cannot be written.
    pub(crate) async fn prepare(&self, scratch: &Path) -> Result<MergeSetup> {
        let attributes_file = match self.attributes() {
            None => None,
            Some(content) => {
                let path = scratch.join("attributes");
                tokio::fs::write(&path, content)
                    .await
                    .map_err(Error::io(format!("writing {}", path.display())))?;
                Some(path)
            }
        };
        Ok(MergeSetup {
            attributes_file,
            driver: self.driver,
        })
    }

    /// Attributes file content; later lines win, so union patterns override the driver line.
    fn attributes(&self) -> Option<String> {
        let driver_line =
            (self.driver == MergeDriver::Mergiraf).then(|| "* merge=mergiraf".to_owned());
        let lines: Vec<String> = driver_line
            .into_iter()
            .chain(
                self.union_paths
                    .iter()
                    .map(|pattern| format!("{} merge=union", pattern.0)),
            )
            .collect();
        (!lines.is_empty()).then(|| lines.join("\n") + "\n")
    }
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

    #[test]
    fn default_rules_need_no_attributes() {
        assert_eq!(MergeRules::default().attributes(), None);
    }

    #[test]
    fn union_paths_become_the_harness_attribute_lines() {
        let rules = MergeRules::new(
            patterns(&["CHANGELOG.md", "CHANGELOG*.md", "**/CHANGELOG.md"]),
            MergeDriver::Git,
        );

        assert_eq!(
            rules.attributes().unwrap(),
            "CHANGELOG.md merge=union\nCHANGELOG*.md merge=union\n**/CHANGELOG.md merge=union\n"
        );
    }

    #[test]
    fn union_lines_follow_the_mergiraf_line_so_they_win() {
        let rules = MergeRules::new(patterns(&["CHANGELOG.md"]), MergeDriver::Mergiraf);

        assert_eq!(
            rules.attributes().unwrap(),
            "* merge=mergiraf\nCHANGELOG.md merge=union\n"
        );
    }

    #[test]
    fn refuses_patterns_that_would_break_the_file() {
        assert!(AttrPattern::parse("a b").is_err());
        assert!(AttrPattern::parse("x\nmerge=ours").is_err());
        assert!(AttrPattern::parse("!negated").is_err());
        assert!(AttrPattern::parse("").is_err());
    }
}
