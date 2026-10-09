//! The act command line and the files it reads.
//!
//! Measured on act v0.2.89 in host mode: steps inherit act's own process environment, so act
//! runs with a cleared environment and secrets reach it only through `--secret-file` (a secret
//! in act's environment would be visible to every step). The `github` context comes from
//! `--env-file` (`GITHUB_REPOSITORY`, `GITHUB_REF`, `SHA_REF`, `GITHUB_SERVER_URL`, ...), because
//! the working directory is empty until `actions/checkout` runs. act fetches every `uses:`
//! action from `GITHUB_SERVER_URL`, which is the executor's `bs.internal` host: it serves the
//! job's own repository from Beanstalk and proxies everything else to github.com anonymously.

use std::collections::BTreeMap;
use std::ffi::OsString;
use std::path::{Path, PathBuf};
use std::sync::LazyLock;

use regex::Regex;

use crate::deps::plan::{TOKEN_SECRET, TOOL_DIR};
use crate::error::{Error, Result};
use crate::wire::JobRequest;

/// Where the job's inputs live: one 0700 directory per container (there is only ever one job).
#[derive(Debug, Clone)]
pub struct JobFiles {
    pub dir: PathBuf,
    pub workflow: PathBuf,
    pub event: PathBuf,
    pub env: PathBuf,
    pub secrets: PathBuf,
    pub vars: PathBuf,
    pub inputs: PathBuf,
    /// act's in-container artifact server: artifacts last as long as the job's container.
    pub artifacts: PathBuf,
    /// act's working directory: empty, as GitHub's workspace is before `actions/checkout`.
    pub workdir: PathBuf,
}

impl JobFiles {
    pub fn under(root: &Path) -> Self {
        let dir = root.join("_job");
        Self {
            workflow: dir.join("workflow.yml"),
            event: dir.join("event.json"),
            env: dir.join("job.env"),
            secrets: dir.join("job.secrets"),
            vars: dir.join("job.vars"),
            inputs: dir.join("job.inputs"),
            artifacts: root.join("_artifacts"),
            workdir: root.join("workspace"),
            dir,
        }
    }
}

/// A program, its arguments and the only environment it gets.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Invocation {
    pub program: PathBuf,
    pub args: Vec<OsString>,
    pub cwd: PathBuf,
    pub env: Vec<(String, String)>,
}

#[allow(clippy::expect_used)] // a constant pattern, checked by every test that runs it
static NAME: LazyLock<Regex> =
    LazyLock::new(|| Regex::new(r"^[A-Za-z_][A-Za-z0-9_]*$").expect("valid name pattern"));
#[allow(clippy::expect_used)] // a constant pattern, checked by every test that runs it
static LABEL: LazyLock<Regex> = LazyLock::new(|| {
    Regex::new(r"^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$").expect("valid label pattern")
});

/// Checks names before anything is written: env, var and secret names must be identifiers,
/// secrets may not start with `GITHUB_` (GitHub's own rule; `GITHUB_TOKEN` is added here),
/// runner labels must be plain.
///
/// # Errors
///
/// [`Error::InvalidRequest`] naming the first bad entry.
pub fn validate(request: &JobRequest) -> Result<()> {
    for name in request
        .env
        .keys()
        .chain(request.vars.keys())
        .chain(request.inputs.keys())
    {
        if !NAME.is_match(name) {
            return Err(Error::InvalidRequest(format!("bad variable name {name:?}")));
        }
    }
    for name in request.secrets.keys() {
        if !NAME.is_match(name) || name.to_ascii_uppercase().starts_with("GITHUB_") {
            return Err(Error::InvalidRequest(format!("bad secret name {name:?}")));
        }
    }
    if request.runner_labels.is_empty() {
        return Err(Error::InvalidRequest("runnerLabels is empty".into()));
    }
    if let Some(label) = request
        .runner_labels
        .iter()
        .find(|label| !LABEL.is_match(label))
    {
        return Err(Error::InvalidRequest(format!("bad runner label {label:?}")));
    }
    if !NAME.is_match(&request.job_name.replace('-', "_")) {
        return Err(Error::InvalidRequest(format!(
            "bad job name {:?}",
            request.job_name
        )));
    }
    Ok(())
}

/// The `--env-file` content: the job's extra env plus the `github` context act needs.
pub fn env_file(request: &JobRequest) -> String {
    let github = &request.github;
    let owner = github.repository.split('/').next().unwrap_or_default();
    let mut entries: BTreeMap<&str, &str> = request
        .env
        .iter()
        .map(|(name, value)| (name.as_str(), value.as_str()))
        .collect();
    let graphql_url = format!("{}/graphql", github.api_url.trim_end_matches("/v3"));
    let context = [
        ("GITHUB_REPOSITORY", github.repository.as_str()),
        ("GITHUB_REPOSITORY_OWNER", owner),
        ("GITHUB_REF", github.git_ref.as_str()),
        ("SHA_REF", github.sha.as_str()),
        ("GITHUB_SERVER_URL", github.server_url.as_str()),
        ("GITHUB_API_URL", github.api_url.as_str()),
        ("GITHUB_GRAPHQL_URL", graphql_url.as_str()),
        ("GITHUB_RUN_ID", github.run_id.as_str()),
        ("GITHUB_RUN_NUMBER", github.run_number.as_str()),
        ("GITHUB_RUN_ATTEMPT", github.run_attempt.as_str()),
    ];
    entries.extend(context);
    dotenv(entries)
}

/// The `--secret-file` content: the named secrets and `GITHUB_TOKEN`.
pub fn secret_file(request: &JobRequest) -> String {
    let mut entries: BTreeMap<&str, &str> = request
        .secrets
        .iter()
        .map(|(name, value)| (name.as_str(), value.expose()))
        .collect();
    entries.insert("GITHUB_TOKEN", request.token.expose());
    if let Some(grant) = &request.deps_cache {
        entries.insert(TOKEN_SECRET, grant.token.expose());
    }
    dotenv(entries)
}

/// The `--var-file` content (`vars.*`).
pub fn vars_file(request: &JobRequest) -> String {
    dotenv(
        request
            .vars
            .iter()
            .map(|(name, value)| (name.as_str(), value.as_str())),
    )
}

/// The `--input-file` content (`inputs.*` of a `workflow_dispatch`).
pub fn inputs_file(request: &JobRequest) -> String {
    dotenv(
        request
            .inputs
            .iter()
            .map(|(name, value)| (name.as_str(), value.as_str())),
    )
}

/// Where the job's steps run.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum RunMode {
    /// On the container itself (`-P <label>=-self-hosted`): the common case.
    Host,
    /// In a job container of `image` on the Docker daemon started inside this container, for
    /// jobs with `services:`, `container:` or Docker actions.
    Docker { image: String, socket: String },
}

/// How act runs this job.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ActPlan {
    pub mode: RunMode,
    /// `owner/repo` of the actions act fetches from github.com rather than from
    /// `GITHUB_SERVER_URL` (Beanstalk): one `--replace-ghe-action-with-github-com` each, since
    /// act does not split a comma list. Empty when the server is github.com itself.
    pub github_actions: Vec<String>,
    /// Docker mode with the dependency cache: `--container-options` for the job container.
    pub container_options: Option<String>,
}

/// The job container's options for the dependency cache in Docker mode: the cache tool and its
/// zstd mounted read-only from the image, and `CAP_SYS_ADMIN` so the restore step (root in the
/// job container) mounts the `node_modules` tmpfs inside the job container itself, after
/// checkout, exactly as on the host. A `--tmpfs` at `node_modules` from the start does not work:
/// `actions/checkout` empties the workspace first and fails on the mount (`EBUSY`, measured).
/// The capability stays inside the job's own microVM, where the job already has root.
pub fn deps_container_options() -> String {
    format!("--cap-add SYS_ADMIN -v {TOOL_DIR}:{TOOL_DIR}:ro")
}

/// Actions baked into the image (Dockerfile); always taken from github.com.
pub const BAKED_ACTIONS: [&str; 7] = [
    "actions/checkout",
    "actions/setup-node",
    "actions/cache",
    "actions/upload-artifact",
    "actions/download-artifact",
    "actions/setup-python",
    "actions/github-script",
];

/// The actions to take from github.com: the job's remote actions and the baked ones, except
/// the job's own repository (served by Beanstalk). None when the server is github.com.
pub fn github_actions(request: &JobRequest, remote_actions: &[String]) -> Vec<String> {
    let server = request.github.server_url.trim_end_matches('/');
    if server == "https://github.com" {
        return Vec::new();
    }
    let own = request.github.repository.to_ascii_lowercase();
    let mut actions: Vec<String> = BAKED_ACTIONS
        .iter()
        .map(|action| (*action).to_owned())
        .chain(remote_actions.iter().cloned())
        .chain(std::iter::once("cloudflare/wrangler-action".to_owned()))
        .filter(|action| action.to_ascii_lowercase() != own)
        .collect();
    actions.sort();
    actions.dedup();
    actions
}

/// act's command line for the job.
pub fn invocation(
    request: &JobRequest,
    files: &JobFiles,
    act_bin: &Path,
    plan: &ActPlan,
) -> Invocation {
    let mut args: Vec<OsString> = vec![
        request.event_name.clone().into(),
        "-W".into(),
        files.workflow.clone().into(),
        "-j".into(),
        request.job_name.clone().into(),
    ];
    let (platform, socket) = match &plan.mode {
        RunMode::Host => ("-self-hosted".to_owned(), "-".to_owned()),
        RunMode::Docker { image, socket } => (image.clone(), format!("unix://{socket}")),
    };
    for label in &request.runner_labels {
        args.push("-P".into());
        args.push(format!("{label}={platform}").into());
    }
    for flag in [
        "--json",
        "--no-skip-checkout",
        // Actions baked into the image are used as they are; others are fetched once.
        "--action-offline-mode",
        "--no-cache-server",
    ] {
        args.push(flag.into());
    }
    args.push("--container-daemon-socket".into());
    args.push(socket.into());
    if let (RunMode::Docker { .. }, Some(options)) = (&plan.mode, &plan.container_options) {
        args.push("--container-options".into());
        args.push(options.clone().into());
    }
    for action in &plan.github_actions {
        args.push("--replace-ghe-action-with-github-com".into());
        args.push(action.clone().into());
    }
    for (flag, path) in [
        ("-e", &files.event),
        ("--env-file", &files.env),
        ("--secret-file", &files.secrets),
        ("--var-file", &files.vars),
        ("--input-file", &files.inputs),
        ("--artifact-server-path", &files.artifacts),
    ] {
        args.push(flag.into());
        args.push(path.clone().into());
    }
    // act's in-container artifact server; steps run on this host's network in both modes.
    args.push("--artifact-server-addr".into());
    args.push("127.0.0.1".into());
    args.push("--actor".into());
    args.push(request.github.actor.clone().into());
    for (name, value) in &request.matrix {
        args.push("--matrix".into());
        args.push(format!("{name}:{}", matrix_value(value)).into());
    }
    let mut env = act_environment();
    if let RunMode::Docker { socket, .. } = &plan.mode {
        env.push(("DOCKER_HOST".to_owned(), format!("unix://{socket}")));
    }
    Invocation {
        program: act_bin.to_path_buf(),
        args,
        cwd: files.workdir.clone(),
        env,
    }
}

fn matrix_value(value: &serde_json::Value) -> String {
    match value {
        serde_json::Value::String(text) => text.clone(),
        other => other.to_string(),
    }
}

/// The environment act runs with: nothing of the runner's, so nothing leaks into steps.
fn act_environment() -> Vec<(String, String)> {
    let path = "/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin";
    [
        ("PATH", path),
        ("HOME", "/home/runner"),
        ("USER", "runner"),
        ("LANG", "C.UTF-8"),
        ("LC_ALL", "C.UTF-8"),
        ("TERM", "dumb"),
        ("CI", "true"),
        ("ACT_DISABLE_VERSION_CHECK", "1"),
    ]
    .into_iter()
    .map(|(name, value)| (name.to_owned(), value.to_owned()))
    .collect()
}

/// `NAME="value"` lines as act's dotenv reader expects them: backslash, double quote, `$`,
/// newline and carriage return escaped, so a value is taken literally.
pub fn dotenv<'a>(entries: impl IntoIterator<Item = (&'a str, &'a str)>) -> String {
    let mut text = String::new();
    for (name, value) in entries {
        text.push_str(name);
        text.push_str("=\"");
        for character in value.chars() {
            match character {
                '\\' => text.push_str("\\\\"),
                '"' => text.push_str("\\\""),
                '$' => text.push_str("\\$"),
                '\n' => text.push_str("\\n"),
                '\r' => text.push_str("\\r"),
                other => text.push(other),
            }
        }
        text.push_str("\"\n");
    }
    text
}

#[cfg(test)]
mod tests {
    use std::collections::BTreeMap;

    use super::*;
    use crate::wire::{GithubContext, Secret};

    fn request() -> JobRequest {
        JobRequest {
            job_id: "job-1".into(),
            workflow_path: ".github/workflows/ci.yml".into(),
            workflow_source: None,
            job_name: "test".into(),
            event_name: "push".into(),
            event_payload: serde_json::json!({}),
            github: GithubContext {
                repository: "coop/app".into(),
                git_ref: "refs/heads/main".into(),
                sha: "0123abcd".into(),
                server_url: "http://bs.internal".into(),
                api_url: "http://bs.internal/api/v3".into(),
                run_id: "7".into(),
                run_number: "3".into(),
                run_attempt: "1".into(),
                actor: "coop".into(),
            },
            token: Secret::new("bsj_token_value"),
            env: BTreeMap::from([("BEANSTALK_LINE".to_owned(), "stalk".to_owned())]),
            vars: BTreeMap::new(),
            inputs: BTreeMap::new(),
            outputs: BTreeMap::new(),
            secrets: BTreeMap::from([("NPM_TOKEN".to_owned(), Secret::new("npm-secret"))]),
            matrix: BTreeMap::from([("node".to_owned(), serde_json::json!(20))]),
            needs: BTreeMap::new(),
            timeout_seconds: 3600,
            runner_labels: vec!["ubuntu-latest".into(), "ubuntu-24.04".into()],
            deps_cache: None,
        }
    }

    fn host_plan() -> ActPlan {
        ActPlan {
            mode: RunMode::Host,
            github_actions: vec!["actions/checkout".into(), "actions/setup-node".into()],
            container_options: None,
        }
    }

    #[test]
    fn takes_actions_from_github_one_flag_each_but_never_the_jobs_own_repository() {
        let mut job = request();
        job.github.repository = "actions/checkout".into();
        let actions = github_actions(&job, &["acme/lint".into(), "actions/checkout".into()]);
        assert!(actions.contains(&"acme/lint".to_owned()));
        assert!(actions.contains(&"actions/setup-node".to_owned()));
        assert!(!actions.contains(&"actions/checkout".to_owned()));
        job.github.server_url = "https://github.com".into();
        assert!(github_actions(&job, &["acme/lint".into()]).is_empty());
        let files = JobFiles::under(Path::new("/w"));
        let args = args_of(&invocation(
            &request(),
            &files,
            Path::new("act"),
            &host_plan(),
        ));
        let flags = args
            .iter()
            .filter(|arg| *arg == "--replace-ghe-action-with-github-com");
        assert_eq!(flags.count(), 2);
    }

    #[test]
    fn runs_a_docker_job_in_its_image_against_the_inner_daemon() {
        let files = JobFiles::under(Path::new("/w"));
        let plan = ActPlan {
            mode: RunMode::Docker {
                image: "catthehacker/ubuntu:act-24.04".into(),
                socket: "/var/run/docker.sock".into(),
            },
            github_actions: Vec::new(),
            container_options: Some(deps_container_options()),
        };
        let invocation = invocation(&request(), &files, Path::new("act"), &plan);
        let args = args_of(&invocation);
        assert!(
            args.windows(2)
                .any(|pair| pair == ["-P", "ubuntu-latest=catthehacker/ubuntu:act-24.04"])
        );
        assert!(
            args.windows(2)
                .any(|pair| pair == ["--container-daemon-socket", "unix:///var/run/docker.sock"])
        );
        assert!(invocation.env.iter().any(|(name, _)| name == "DOCKER_HOST"));
        assert!(args.windows(2).any(|pair| {
            pair[0] == "--container-options" && pair[1].starts_with("--cap-add SYS_ADMIN -v")
        }));
    }

    fn args_of(invocation: &Invocation) -> Vec<String> {
        invocation
            .args
            .iter()
            .map(|arg| arg.to_string_lossy().into_owned())
            .collect()
    }

    #[test]
    fn runs_the_one_job_in_host_mode_for_each_label() {
        let files = JobFiles::under(Path::new("/w"));
        let invocation = invocation(
            &request(),
            &files,
            Path::new("/usr/local/bin/act"),
            &host_plan(),
        );
        let args = args_of(&invocation);
        assert_eq!(
            &args[..5],
            ["push", "-W", "/w/_job/workflow.yml", "-j", "test"]
        );
        assert!(
            args.windows(2)
                .any(|pair| pair == ["-P", "ubuntu-latest=-self-hosted"])
        );
        assert!(
            args.windows(2)
                .any(|pair| pair == ["-P", "ubuntu-24.04=-self-hosted"])
        );
        assert!(args.windows(2).any(|pair| pair == ["--matrix", "node:20"]));
        assert!(args.contains(&"--no-skip-checkout".to_owned()));
        assert_eq!(invocation.cwd, PathBuf::from("/w/workspace"));
    }

    #[test]
    fn never_puts_a_secret_on_the_command_line_or_in_acts_environment() {
        let files = JobFiles::under(Path::new("/w"));
        let invocation = invocation(&request(), &files, Path::new("act"), &host_plan());
        let everything = format!("{:?} {:?}", invocation.args, invocation.env);
        assert!(!everything.contains("npm-secret"));
        assert!(!everything.contains("bsj_token_value"));
        assert!(invocation.env.iter().all(|(name, _)| name != "NPM_TOKEN"));
    }

    #[test]
    fn writes_the_github_context_and_the_token_to_their_files() {
        let env = env_file(&request());
        assert!(env.contains("GITHUB_REPOSITORY=\"coop/app\"\n"));
        assert!(env.contains("GITHUB_REPOSITORY_OWNER=\"coop\"\n"));
        assert!(env.contains("SHA_REF=\"0123abcd\"\n"));
        assert!(env.contains("GITHUB_SERVER_URL=\"http://bs.internal\"\n"));
        assert!(env.contains("GITHUB_GRAPHQL_URL=\"http://bs.internal/api/graphql\"\n"));
        assert!(env.contains("BEANSTALK_LINE=\"stalk\"\n"));
        let secrets = secret_file(&request());
        assert!(secrets.contains("GITHUB_TOKEN=\"bsj_token_value\"\n"));
        assert!(secrets.contains("NPM_TOKEN=\"npm-secret\"\n"));
    }

    #[test]
    fn escapes_values_so_they_are_taken_literally() {
        let text = dotenv([("V", "a \"q\" $HOME \\ x\nnext")]);
        assert_eq!(text, "V=\"a \\\"q\\\" \\$HOME \\\\ x\\nnext\"\n");
    }

    #[test]
    fn refuses_a_secret_named_like_githubs_own() {
        let mut bad = request();
        bad.secrets.insert("GITHUB_TOKEN".into(), Secret::new("x"));
        assert!(matches!(validate(&bad), Err(Error::InvalidRequest(_))));
    }

    #[test]
    fn refuses_a_variable_name_that_is_not_an_identifier() {
        let mut bad = request();
        bad.env.insert("BAD NAME".into(), "x".into());
        assert!(matches!(validate(&bad), Err(Error::InvalidRequest(_))));
        assert!(validate(&request()).is_ok());
    }
}
