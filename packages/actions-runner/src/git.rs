//! Reading the workflow file at the job's commit before act starts (act parses the workflow
//! before any step, and the workspace stays empty until `actions/checkout`, as on GitHub). One
//! shallow fetch of the commit from `GITHUB_SERVER_URL/<owner>/<repo>` into a scratch
//! repository, then `git show`. The token travels as an HTTP header set through git's
//! environment, never on a command line or in a URL.

use std::path::{Component, Path};
use std::process::Stdio;
use std::time::Duration;

use base64::Engine;
use base64::engine::general_purpose::STANDARD;
use tokio::process::Command;

use crate::error::{Error, Result};
use crate::mask::Masker;
use crate::wire::JobRequest;

const FETCH_TIMEOUT: Duration = Duration::from_mins(2);
/// Characters of git's error output kept in a failure message.
const ERROR_EXCERPT_CHARS: usize = 400;

/// The workflow file's text at the job's commit.
///
/// # Errors
///
/// [`Error::Workflow`] for a path outside the repository, [`Error::Fetch`] when git cannot
/// fetch the commit or the commit has no such file, [`Error::Timeout`] after two minutes.
pub async fn fetch_workflow(
    request: &JobRequest,
    scratch: &Path,
    masker: &Masker,
) -> Result<String> {
    let path = checked_path(&request.workflow_path)?;
    tokio::fs::create_dir_all(scratch)
        .await
        .map_err(Error::io("creating the fetch directory"))?;
    let remote = format!(
        "{}/{}",
        request.github.server_url.trim_end_matches('/'),
        request.github.repository
    );
    let target = if request.github.sha.is_empty() {
        request.github.git_ref.as_str()
    } else {
        request.github.sha.as_str()
    };
    let header = format!(
        "AUTHORIZATION: basic {}",
        STANDARD.encode(format!("x-access-token:{}", request.token.expose()))
    );
    let git = GitCall {
        dir: scratch,
        header: &header,
        masker,
    };
    git.run(&["init", "-q", "."]).await?;
    git.run(&[
        "fetch",
        "--depth=1",
        "--no-tags",
        "--quiet",
        &remote,
        target,
    ])
    .await?;
    git.run(&["show", &format!("FETCH_HEAD:{path}")]).await
}

/// A relative path inside the repository, without `..`.
fn checked_path(path: &str) -> Result<&str> {
    let is_inside = !path.is_empty()
        && Path::new(path)
            .components()
            .all(|component| matches!(component, Component::Normal(_)));
    let is_yaml = Path::new(path)
        .extension()
        .is_some_and(|extension| extension == "yml" || extension == "yaml");
    if is_inside && is_yaml {
        Ok(path)
    } else {
        Err(Error::Workflow(format!("bad workflow path {path:?}")))
    }
}

struct GitCall<'a> {
    dir: &'a Path,
    header: &'a str,
    masker: &'a Masker,
}

impl GitCall<'_> {
    async fn run(&self, args: &[&str]) -> Result<String> {
        let child = Command::new("git")
            .args(args)
            .current_dir(self.dir)
            .env("GIT_TERMINAL_PROMPT", "0")
            .env("GIT_CONFIG_COUNT", "1")
            .env("GIT_CONFIG_KEY_0", "http.extraHeader")
            .env("GIT_CONFIG_VALUE_0", self.header)
            .stdin(Stdio::null())
            .stdout(Stdio::piped())
            .stderr(Stdio::piped())
            .kill_on_drop(true)
            .spawn()
            .map_err(Error::io("starting git"))?;
        let output = tokio::time::timeout(FETCH_TIMEOUT, child.wait_with_output())
            .await
            .map_err(|_| Error::Timeout {
                op: "fetching the workflow",
                seconds: FETCH_TIMEOUT.as_secs(),
            })?
            .map_err(Error::io("running git"))?;
        if output.status.success() {
            return Ok(String::from_utf8_lossy(&output.stdout).into_owned());
        }
        let stderr = String::from_utf8_lossy(&output.stderr);
        let excerpt: String = self
            .masker
            .apply(stderr.trim())
            .chars()
            .take(ERROR_EXCERPT_CHARS)
            .collect();
        Err(Error::Fetch(format!("git {} failed: {excerpt}", args[0])))
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn accepts_a_workflow_path_inside_the_repository() {
        assert!(checked_path(".github/workflows/ci.yml").is_ok());
        assert!(checked_path(".beanstalk/automations/a.yaml").is_ok());
    }

    #[test]
    fn refuses_paths_that_leave_the_repository_or_are_not_yaml() {
        for path in [
            "../x.yml",
            "/etc/passwd.yml",
            ".github/../../x.yml",
            "ci.json",
            "",
        ] {
            assert!(checked_path(path).is_err(), "{path} was accepted");
        }
    }
}
