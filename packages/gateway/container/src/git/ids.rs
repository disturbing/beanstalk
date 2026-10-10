//! Validated git identifiers: commit and tree ids, full ref names.

use std::fmt;

use serde::Serialize;

/// Longest ref name accepted; Artifacts and git allow more, nothing here needs it.
const MAX_REF_NAME_BYTES: usize = 1024;
const FORBIDDEN_REF_CHARS: &[char] = &[' ', '~', '^', ':', '?', '*', '[', '\\'];

/// A full commit id: 40 (SHA-1) or 64 (SHA-256) hex digits, stored lowercase.
#[derive(Debug, Clone, PartialEq, Eq, Hash, PartialOrd, Ord, Serialize)]
#[serde(transparent)]
pub(crate) struct CommitSha(String);

impl CommitSha {
    /// # Errors
    ///
    /// A reason when `raw` is not a full hex object id (abbreviations are refused: the runner
    /// never guesses which commit was meant).
    pub(crate) fn parse(raw: &str) -> Result<Self, String> {
        parse_object_id(raw).map(Self)
    }

    pub(crate) fn as_str(&self) -> &str {
        &self.0
    }

    /// The all-zero id git uses for "no commit".
    pub(crate) fn is_null(&self) -> bool {
        self.0.bytes().all(|byte| byte == b'0')
    }
}

impl fmt::Display for CommitSha {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        f.write_str(&self.0)
    }
}

/// A tree id, as `git merge-tree --write-tree` prints it.
#[derive(Debug, Clone, PartialEq, Eq)]
pub(crate) struct TreeId(String);

impl TreeId {
    pub(crate) fn parse(raw: &str) -> Result<Self, String> {
        parse_object_id(raw).map(Self)
    }

    pub(crate) fn as_str(&self) -> &str {
        &self.0
    }
}

fn parse_object_id(raw: &str) -> Result<String, String> {
    let is_full_length = raw.len() == 40 || raw.len() == 64;
    if is_full_length && raw.bytes().all(|byte| byte.is_ascii_hexdigit()) {
        Ok(raw.to_ascii_lowercase())
    } else {
        Err(format!(
            "{raw:?} is not a full 40- or 64-digit hex object id"
        ))
    }
}

/// A full ref name (`refs/...`) that `git check-ref-format` accepts.
#[derive(Debug, Clone, PartialEq, Eq, Hash)]
pub(crate) struct RefName(String);

impl RefName {
    /// # Errors
    ///
    /// A reason when `raw` is not a full, well-formed ref name.
    pub(crate) fn parse(raw: &str) -> Result<Self, String> {
        if !raw.starts_with("refs/") {
            return Err(format!("{raw:?} is not a full ref name (refs/...)"));
        }
        match format_problem(raw) {
            Some(problem) => Err(format!("{raw:?} is not a valid ref name: {problem}")),
            None => Ok(Self(raw.to_owned())),
        }
    }

    /// Where a clean result is published on the trunk so later steps can fetch it by name.
    pub(crate) fn candidate(sha: &CommitSha) -> Self {
        Self(format!("refs/beanstalk/candidates/{sha}"))
    }

    pub(crate) fn as_str(&self) -> &str {
        &self.0
    }
}

impl fmt::Display for RefName {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        f.write_str(&self.0)
    }
}

/// The first rule of `git check-ref-format` that `name` breaks, if any.
#[allow(clippy::case_sensitive_file_extension_comparisons)] // git's `.lock` rule is case-sensitive
fn format_problem(name: &str) -> Option<&'static str> {
    if name.len() > MAX_REF_NAME_BYTES {
        return Some("too long");
    }
    if name
        .chars()
        .any(|c| c.is_ascii_control() || FORBIDDEN_REF_CHARS.contains(&c))
    {
        return Some("contains a control character, space, or one of ~ ^ : ? * [ \\");
    }
    if name.contains("..") || name.contains("@{") {
        return Some("contains .. or @{");
    }
    if name.ends_with('.') || name.ends_with('/') || name.contains("//") {
        return Some("ends with . or / or has an empty component");
    }
    let bad_component = name
        .split('/')
        .any(|component| component.starts_with('.') || component.ends_with(".lock"));
    bad_component.then_some("a component starts with . or ends with .lock")
}

#[cfg(test)]
mod tests {
    #![allow(clippy::unwrap_used, clippy::expect_used)] // tests fail loudly by design

    use std::process::Command;

    use proptest::prelude::*;

    use super::*;

    fn git_accepts(name: &str) -> bool {
        Command::new("git")
            .args(["check-ref-format", name])
            .env("GIT_CONFIG_NOSYSTEM", "1")
            .env("GIT_CONFIG_GLOBAL", "/dev/null")
            .status()
            .expect("git on PATH")
            .success()
    }

    #[test]
    fn accepts_full_shas_in_either_case() {
        let upper = "ABCDEF0123456789ABCDEF0123456789ABCDEF01";

        assert_eq!(
            CommitSha::parse(upper).unwrap().as_str(),
            upper.to_ascii_lowercase()
        );
        assert!(CommitSha::parse(&"a".repeat(64)).is_ok());
    }

    #[test]
    fn refuses_abbreviated_and_non_hex_shas() {
        assert!(CommitSha::parse("abc1234").is_err());
        assert!(CommitSha::parse(&"g".repeat(40)).is_err());
        assert!(CommitSha::parse(&"a".repeat(41)).is_err());
    }

    #[test]
    fn recognises_the_null_sha() {
        let almost_null = format!("{}1", "0".repeat(39));

        assert!(CommitSha::parse(&"0".repeat(40)).unwrap().is_null());
        assert!(!CommitSha::parse(&almost_null).unwrap().is_null());
    }

    #[test]
    fn refuses_short_ref_names() {
        assert!(RefName::parse("heads/main").is_err());
        assert!(RefName::parse("main").is_err());
    }

    #[test]
    fn names_candidate_refs_by_sha() {
        let sha = CommitSha::parse(&"b".repeat(40)).unwrap();

        assert_eq!(
            RefName::candidate(&sha).as_str(),
            format!("refs/beanstalk/candidates/{}", "b".repeat(40))
        );
    }

    fn ref_like() -> impl Strategy<Value = String> {
        proptest::string::string_regex("refs/[a-z0-9._@{}~^:?*\\[\\\\ /-]{1,12}").unwrap()
    }

    proptest! {
        #![proptest_config(ProptestConfig::with_cases(96))]

        #[test]
        fn ref_validation_agrees_with_git(name in ref_like()) {
            prop_assert_eq!(RefName::parse(&name).is_ok(), git_accepts(&name), "{}", name);
        }
    }
}
