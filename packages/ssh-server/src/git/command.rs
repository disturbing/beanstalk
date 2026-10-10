//! The command an SSH client asks to run: `git-upload-pack '/<owner>/<repo>.git'` or
//! `git-receive-pack …`, as git's ssh transport sends it. Nothing else is served.

use std::fmt;

/// The two git services served over SSH.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Service {
    UploadPack,
    ReceivePack,
}

impl Service {
    /// The smart-HTTP name of the service (`git-upload-pack`, `git-receive-pack`).
    pub fn as_str(self) -> &'static str {
        match self {
            Self::UploadPack => "git-upload-pack",
            Self::ReceivePack => "git-receive-pack",
        }
    }
}

/// A repository path the gateway serves: `<owner>/<repo>` (the clone URL's path without `.git`).
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct RepoPath {
    owner: String,
    repo: String,
}

impl RepoPath {
    /// `/owner/repo.git`, `owner/repo.git` or `owner/repo`, under the gateway's naming rules.
    pub fn parse(path: &str) -> Option<Self> {
        parse_repo_path(path)
    }

    pub fn owner(&self) -> &str {
        &self.owner
    }

    pub fn repo(&self) -> &str {
        &self.repo
    }

    /// The gateway's smart-HTTP base path for this repository: `/git/<owner>/<repo>.git`.
    pub fn gateway_path(&self) -> String {
        format!("/git/{}/{}.git", self.owner, self.repo)
    }
}

impl fmt::Display for RepoPath {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        write!(f, "{}/{}", self.owner, self.repo)
    }
}

/// A parsed exec request.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct GitCommand {
    pub service: Service,
    pub path: RepoPath,
}

/// Why an exec request is refused; the text is shown to the person on stderr.
#[derive(Debug, Clone, PartialEq, Eq, thiserror::Error)]
pub enum CommandError {
    #[error("gitstalk serves git only: git-upload-pack or git-receive-pack '<owner>/<repo>.git'")]
    NotGit,
    #[error("not a repository path: {0:?}; use <owner>/<repo>.git")]
    BadPath(String),
}

const MAX_COMMAND_LEN: usize = 512;

/// Parses an exec request's command line.
///
/// # Errors
///
/// [`CommandError::NotGit`] for any other command, [`CommandError::BadPath`] when the argument is
/// not `<owner>/<repo>[.git]`.
pub fn parse_command(command: &[u8]) -> Result<GitCommand, CommandError> {
    if command.len() > MAX_COMMAND_LEN {
        return Err(CommandError::NotGit);
    }
    let text = std::str::from_utf8(command).map_err(|_| CommandError::NotGit)?;
    let (program, argument) = split_program(text.trim()).ok_or(CommandError::NotGit)?;
    let service = match program {
        "git-upload-pack" => Service::UploadPack,
        "git-receive-pack" => Service::ReceivePack,
        _ => return Err(CommandError::NotGit),
    };
    let unquoted = unquote(argument).ok_or_else(|| CommandError::BadPath(argument.into()))?;
    let path = parse_repo_path(&unquoted).ok_or(CommandError::BadPath(unquoted))?;
    Ok(GitCommand { service, path })
}

/// `git-upload-pack <arg>` or `git upload-pack <arg>`.
fn split_program(text: &str) -> Option<(&str, &str)> {
    let (first, rest) = text.split_once(' ')?;
    if first == "git" {
        let (sub, argument) = rest.trim_start().split_once(' ')?;
        return match sub {
            "upload-pack" => Some(("git-upload-pack", argument.trim())),
            "receive-pack" => Some(("git-receive-pack", argument.trim())),
            _ => None,
        };
    }
    Some((first, rest.trim()))
}

/// git quotes the path in single quotes, writing a quote inside as `'\''`. Bare words pass.
fn unquote(argument: &str) -> Option<String> {
    if !argument.starts_with('\'') {
        return (!argument.contains(['\'', '"', ' ', '\\'])).then(|| argument.to_owned());
    }
    let mut out = String::new();
    let mut rest = argument;
    while let Some(after_open) = rest.strip_prefix('\'') {
        let close = after_open.find('\'')?;
        out.push_str(after_open.get(..close)?);
        rest = after_open.get(close + 1..)?;
        if let Some(after_escape) = rest.strip_prefix("\\'") {
            out.push('\'');
            rest = after_escape;
        }
    }
    rest.is_empty().then_some(out)
}

/// `/owner/repo.git`, `owner/repo.git`, `owner/repo` or with a trailing slash, under the
/// gateway's naming rules (handles and repository names as the HTTPS proxy takes them).
fn parse_repo_path(path: &str) -> Option<RepoPath> {
    let trimmed = path.strip_prefix('/').unwrap_or(path);
    let trimmed = trimmed.strip_suffix('/').unwrap_or(trimmed);
    let (owner, repo) = trimmed.split_once('/')?;
    let repo = repo.strip_suffix(".git").unwrap_or(repo);
    (is_name(owner, 63) && is_name(repo, 100)).then(|| RepoPath {
        owner: owner.to_owned(),
        repo: repo.to_owned(),
    })
}

/// `[A-Za-z0-9][A-Za-z0-9._-]{0,max-1}`.
fn is_name(value: &str, max: usize) -> bool {
    let mut chars = value.chars();
    let starts_well = chars.next().is_some_and(|c| c.is_ascii_alphanumeric());
    starts_well
        && value.len() <= max
        && chars.all(|c| c.is_ascii_alphanumeric() || matches!(c, '.' | '_' | '-'))
}

#[cfg(test)]
mod tests {
    use super::*;
    use proptest::prelude::*;

    fn parsed(command: &str) -> Result<(Service, String), CommandError> {
        parse_command(command.as_bytes()).map(|c| (c.service, c.path.to_string()))
    }

    #[test]
    fn accepts_the_forms_git_sends() {
        let expected = Ok((Service::UploadPack, "acme/greeter".to_owned()));
        assert_eq!(parsed("git-upload-pack '/acme/greeter.git'"), expected);
        assert_eq!(parsed("git-upload-pack 'acme/greeter.git'"), expected);
        assert_eq!(parsed("git-upload-pack '/acme/greeter'"), expected);
        assert_eq!(parsed("git upload-pack '/acme/greeter.git/'"), expected);
        assert_eq!(parsed("git-upload-pack acme/greeter.git"), expected);
        assert_eq!(
            parsed("git-receive-pack '/acme/greeter.git'"),
            Ok((Service::ReceivePack, "acme/greeter".to_owned()))
        );
    }

    #[test]
    fn builds_the_gateway_path() -> Result<(), CommandError> {
        let command = parse_command(b"git-receive-pack '/acme/my.repo.git'")?;
        assert_eq!(command.path.gateway_path(), "/git/acme/my.repo.git");
        Ok(())
    }

    #[test]
    fn refuses_other_commands() {
        for command in [
            "",
            "ls",
            "bash -c 'id'",
            "git-upload-archive '/acme/greeter.git'",
            "git upload-archive '/acme/greeter.git'",
            "scp -t /tmp",
        ] {
            assert_eq!(parsed(command), Err(CommandError::NotGit), "{command}");
        }
    }

    #[test]
    fn refuses_paths_outside_the_naming_rules() {
        for path in [
            "'/acme/../etc.git'",
            "'/acme'",
            "'/acme/greeter/extra.git'",
            "'~/greeter.git'",
            "'/.hidden/repo.git'",
            "'/acme/greeter.git' ; rm -rf /",
            "'/acme/gr eeter.git'",
            "'/acme/gr'\\''eeter.git'",
        ] {
            let result = parsed(&format!("git-upload-pack {path}"));
            assert!(
                matches!(result, Err(CommandError::BadPath(_))),
                "{path}: {result:?}"
            );
        }
    }

    proptest! {
        #[test]
        fn never_panics(bytes in proptest::collection::vec(any::<u8>(), 0..600)) {
            let _ = parse_command(&bytes);
        }

        #[test]
        fn valid_names_round_trip(owner in "[A-Za-z0-9][A-Za-z0-9._-]{0,20}", repo in "[A-Za-z0-9][A-Za-z0-9_-]{0,20}") {
            let command = format!("git-receive-pack '/{owner}/{repo}.git'");
            let parsed = parse_command(command.as_bytes()).map_err(|e| TestCaseError::fail(e.to_string()))?;
            prop_assert_eq!(parsed.path.owner(), owner.as_str());
            prop_assert_eq!(parsed.path.repo(), repo.as_str());
        }
    }
}
