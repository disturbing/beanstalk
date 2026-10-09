//! One job, start to result: fetch the workflow, cut it to the job, run act, stream its lines,
//! stop it on cancel or timeout (SIGTERM to act's process group, SIGKILL after the grace), and
//! send the result once every chunk is acknowledged.

use std::collections::BTreeMap;
use std::os::unix::fs::PermissionsExt;
use std::path::Path;
use std::process::{ExitStatus, Stdio};
use std::time::{Instant, SystemTime, UNIX_EPOCH};

use nix::sys::signal::{Signal, killpg};
use nix::unistd::Pid;
use tokio::io::{AsyncBufReadExt, AsyncRead, BufReader};
use tokio::process::Command;
use tokio::sync::{mpsc, watch};
use tokio::time::{Duration, Instant as TokioInstant, MissedTickBehavior, sleep_until};

use crate::act::command::{self, ActPlan, Invocation, JobFiles, RunMode};
use crate::act::event::parse_line;
use crate::config::Config;
use crate::deps;
use crate::deps::plan::{DepsPlan, Trigger};
use crate::docker;
use crate::error::{Error, Result};
use crate::git;
use crate::mask::Masker;
use crate::outcome::{Recorded, Recorder};
use crate::stream::{Batcher, Flush, TICK};
use crate::uplink::Uplink;
use crate::wire::{Conclusion, FailureReason, JobRequest, Level, RunnerResult, StopReason};
use crate::workflow::{self, JobWorkflow};

/// Lines read from act but not yet recorded; act blocks on its pipe beyond this.
const LINE_BUFFER: usize = 1024;

/// Runs the job and returns its result after sending it (or failing to) to the executor.
pub async fn run<U: Uplink>(
    config: &Config,
    uplink: &U,
    request: JobRequest,
    stop: watch::Receiver<Option<StopReason>>,
) -> RunnerResult {
    let mut session = Session::new(config, uplink, &request);
    let outcome = session.execute(&request, stop).await;
    session.finish(&request, outcome).await
}

/// How act's run ended, before the record is folded in.
#[derive(Debug)]
enum Outcome {
    Exited {
        status: ExitStatus,
        stopped: Option<StopReason>,
        templates: BTreeMap<String, String>,
    },
    Failed {
        reason: FailureReason,
        error: Error,
    },
}

struct Session<'a, U> {
    config: &'a Config,
    uplink: &'a U,
    job_id: String,
    recorder: Recorder,
    batcher: Batcher,
    started_at: u64,
    /// The most memory the machine had in use, sampled every tick (`MemTotal - MemAvailable`).
    peak_memory: u64,
}

impl<'a, U: Uplink> Session<'a, U> {
    fn new(config: &'a Config, uplink: &'a U, request: &JobRequest) -> Self {
        let mut masker = Masker::new();
        masker.add(request.token.expose());
        for secret in request.secrets.values() {
            masker.add(secret.expose());
        }
        if let Some(grant) = &request.deps_cache {
            masker.add(grant.token.expose());
        }
        Self {
            config,
            uplink,
            job_id: request.job_id.clone(),
            recorder: Recorder::new(masker),
            batcher: Batcher::new(Instant::now()),
            started_at: now_ms(),
            peak_memory: 0,
        }
    }

    async fn execute(
        &mut self,
        request: &JobRequest,
        stop: watch::Receiver<Option<StopReason>>,
    ) -> Outcome {
        let prepared = match self.prepare(request).await {
            Ok(prepared) => prepared,
            Err((reason, error)) => return Outcome::Failed { reason, error },
        };
        let invocation = command::invocation(
            request,
            &prepared.files,
            self.config.act_bin(),
            &prepared.plan,
        );
        let deadline = TokioInstant::now() + Duration::from_secs(request.timeout_seconds);
        match self.supervise(&invocation, stop, deadline).await {
            Ok((status, stopped)) => Outcome::Exited {
                status,
                stopped,
                templates: prepared.workflow.output_templates,
            },
            Err(error) => Outcome::Failed {
                reason: FailureReason::Runner,
                error,
            },
        }
    }

    async fn prepare(
        &mut self,
        request: &JobRequest,
    ) -> std::result::Result<Prepared, (FailureReason, Error)> {
        self.say(
            Level::Info,
            &format!(
                "Fetching {} at {}",
                request.workflow_path,
                short(&request.github.sha)
            ),
        )
        .await;
        let scratch = self.config.work_root().join("_fetch");
        let source = git::fetch_workflow(request, &scratch, self.recorder.masker())
            .await
            .map_err(|error| match error {
                Error::Workflow(_) => (FailureReason::Workflow, error),
                other => (FailureReason::Runner, other),
            })?;
        let mut job = workflow::isolate_job_with_cache(
            &source,
            &request.job_name,
            &request.needs,
            deps_cache_budget(request),
        )
        .map_err(|error| (FailureReason::Workflow, error))?;
        if let Some(plan) = &job.deps {
            self.say(Level::Info, &deps_cache_line(plan)).await;
        }
        if !request.outputs.is_empty() {
            job.output_templates.clone_from(&request.outputs);
        }
        let files = JobFiles::under(self.config.work_root());
        write_files(request, &files, &job)
            .await
            .map_err(|error| (FailureReason::Runner, error))?;
        let (mode, daemon) = self.run_mode(&job).await?;
        let container_options = job.deps.as_ref().map(|_| command::deps_container_options());
        let plan = ActPlan {
            mode,
            github_actions: command::github_actions(request, &job.remote_actions),
            container_options,
        };
        self.say(
            Level::Info,
            &format!(
                "Running job {} with act {} (image {})",
                request.job_name,
                self.config.act_version(),
                self.config.image_version()
            ),
        )
        .await;
        Ok(Prepared {
            files,
            workflow: job,
            plan,
            _daemon: daemon,
        })
    }

    /// Host mode, or Docker mode with the inner daemon started, for a job that needs Docker.
    async fn run_mode(
        &mut self,
        job: &JobWorkflow,
    ) -> std::result::Result<(RunMode, Option<docker::Daemon>), (FailureReason, Error)> {
        if job.docker_features.is_empty() {
            return Ok((RunMode::Host, None));
        }
        let docker = self.config.docker();
        self.say(
            Level::Info,
            &format!(
                "The job uses {}: starting Docker; its steps run in {}",
                job.docker_features.join(", "),
                docker.job_image
            ),
        )
        .await;
        let daemon = docker::start(docker)
            .await
            .map_err(|error| (FailureReason::Runner, error))?;
        let mode = RunMode::Docker {
            image: docker.job_image.clone(),
            socket: docker.socket.clone(),
        };
        Ok((mode, Some(daemon)))
    }

    /// Runs act until it exits, recording and streaming its lines; stops it on cancel or at
    /// the deadline.
    async fn supervise(
        &mut self,
        invocation: &Invocation,
        mut stop: watch::Receiver<Option<StopReason>>,
        deadline: TokioInstant,
    ) -> Result<(ExitStatus, Option<StopReason>)> {
        let mut child = spawn(invocation)?;
        let group = child
            .id()
            .and_then(|pid| i32::try_from(pid).ok())
            .map(Pid::from_raw)
            .ok_or_else(|| Error::InvalidRequest("act exited before it could be watched".into()))?;
        let (sender, mut lines) = mpsc::channel::<String>(LINE_BUFFER);
        if let Some(stdout) = child.stdout.take() {
            tokio::spawn(forward_lines(stdout, sender.clone()));
        }
        if let Some(stderr) = child.stderr.take() {
            tokio::spawn(forward_lines(stderr, sender));
        }
        let mut ticker = tokio::time::interval(TICK);
        ticker.set_missed_tick_behavior(MissedTickBehavior::Delay);
        let mut stopped: Option<StopReason> = None;
        let mut kill_at: Option<TokioInstant> = None;
        let mut status: Option<ExitStatus> = None;
        let mut lines_open = true;
        while status.is_none() || lines_open {
            tokio::select! {
                line = lines.recv(), if lines_open => match line {
                    Some(line) => self.on_act_line(&line),
                    None => lines_open = false,
                },
                exited = child.wait(), if status.is_none() => {
                    status = Some(exited.map_err(Error::io("waiting for act"))?);
                }
                _ = ticker.tick() => {
                    self.sample_memory();
                    self.flush(Flush::WhenDue).await;
                }
                changed = stop.changed(), if stopped.is_none() => {
                    let reason = if changed.is_ok() { *stop.borrow() } else { None };
                    if let Some(reason) = reason {
                        stopped = Some(reason);
                        kill_at = Some(self.terminate(group, reason).await);
                    }
                }
                () = sleep_until(deadline), if stopped.is_none() => {
                    stopped = Some(StopReason::Timeout);
                    kill_at = Some(self.terminate(group, StopReason::Timeout).await);
                }
                () = sleep_until(kill_at.unwrap_or(deadline)), if kill_at.is_some() && status.is_none() => {
                    kill_at = None;
                    signal_group(group, Signal::SIGKILL);
                }
            }
        }
        let status =
            status.ok_or_else(|| Error::InvalidRequest("act's exit was not seen".into()))?;
        Ok((status, stopped))
    }

    async fn terminate(&mut self, group: Pid, reason: StopReason) -> TokioInstant {
        let why = match reason {
            StopReason::Timeout => "The job ran past its timeout",
            StopReason::Cancelled => "The job was cancelled",
        };
        self.say(Level::Error, &format!("{why}: stopping it")).await;
        signal_group(group, Signal::SIGTERM);
        TokioInstant::now() + self.config.cancel_grace()
    }

    fn sample_memory(&mut self) {
        if let Some(in_use) = deps::memory::memory_in_use() {
            self.peak_memory = self.peak_memory.max(in_use);
        }
    }

    fn on_act_line(&mut self, line: &str) {
        if let Some(log_line) = self.recorder.record(parse_line(line), now_ms()) {
            self.batcher.push(log_line);
        }
    }

    async fn say(&mut self, level: Level, text: &str) {
        let line = self.recorder.runner_line(now_ms(), level, text);
        self.batcher.push(line);
        self.flush(Flush::WhenDue).await;
    }

    async fn flush(&mut self, flush: Flush) {
        let now = Instant::now();
        while let Some(batch) = self.batcher.take(now, flush) {
            if let Err(error) = self
                .uplink
                .batch(&self.job_id, batch.index, &batch.lines)
                .await
            {
                tracing::error!(%error, index = batch.index, "a log batch could not be delivered");
            }
        }
    }

    async fn finish(mut self, request: &JobRequest, outcome: Outcome) -> RunnerResult {
        let (ending, templates) = match outcome {
            Outcome::Exited {
                status,
                stopped,
                templates,
            } => {
                let (conclusion, reason) =
                    conclusion_of(self.recorder.job_result(), status, stopped);
                let ending = Ending {
                    conclusion,
                    reason,
                    error: None,
                    exit_code: status.code(),
                };
                (ending, templates)
            }
            Outcome::Failed { reason, error } => {
                let message = self.recorder.masker().apply(&error.to_string());
                self.say(Level::Error, &message).await;
                let ending = Ending {
                    conclusion: Conclusion::Failure,
                    reason: Some(reason),
                    error: Some(message),
                    exit_code: None,
                };
                (ending, BTreeMap::new())
            }
        };
        remove_secrets(self.config.work_root()).await;
        if self.peak_memory > 0 {
            let line = format!(
                "Peak memory in use during the job: {} MiB",
                self.peak_memory / (1024 * 1024)
            );
            self.say(Level::Info, &line).await;
        }
        self.flush(Flush::Everything).await;
        let result = assemble(AssembleInput {
            request,
            batches: self.batcher.batches(),
            recorded: self.recorder.into_recorded(),
            ending,
            templates: &templates,
            started_at: self.started_at,
            config: self.config,
        });
        if let Err(error) = self.uplink.result(&result).await {
            tracing::error!(%error, "the result could not be delivered; the executor polls /v1/status");
        }
        result
    }
}

struct Prepared {
    files: JobFiles,
    workflow: JobWorkflow,
    plan: ActPlan,
    /// Kept alive while act runs.
    _daemon: Option<docker::Daemon>,
}

fn spawn(invocation: &Invocation) -> Result<tokio::process::Child> {
    Command::new(&invocation.program)
        .args(&invocation.args)
        .current_dir(&invocation.cwd)
        .env_clear()
        .envs(invocation.env.iter().map(|(name, value)| (name, value)))
        .stdin(Stdio::null())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .process_group(0)
        .kill_on_drop(true)
        .spawn()
        .map_err(Error::io("starting act"))
}

async fn forward_lines(stream: impl AsyncRead + Unpin, sender: mpsc::Sender<String>) {
    let mut reader = BufReader::new(stream);
    let mut buffer = Vec::new();
    loop {
        buffer.clear();
        match reader.read_until(b'\n', &mut buffer).await {
            Ok(0) => return,
            Ok(_) => {
                let line = String::from_utf8_lossy(&buffer)
                    .trim_end_matches(['\n', '\r'])
                    .to_owned();
                if sender.send(line).await.is_err() {
                    return;
                }
            }
            Err(error) => {
                tracing::warn!(%error, "reading act's output failed");
                return;
            }
        }
    }
}

fn signal_group(group: Pid, signal: Signal) {
    if let Err(error) = killpg(group, signal) {
        tracing::debug!(%error, ?signal, "signalling act's process group failed (it may have exited)");
    }
}

async fn write_files(request: &JobRequest, files: &JobFiles, job: &JobWorkflow) -> Result<()> {
    create_private_dir(&files.dir).await?;
    tokio::fs::create_dir_all(&files.workdir)
        .await
        .map_err(Error::io("creating the workspace"))?;
    let event = serde_json::to_string(&request.event_payload)
        .map_err(|error| Error::InvalidRequest(format!("event payload: {error}")))?;
    write_private(&files.workflow, &job.yaml).await?;
    write_private(&files.event, &event).await?;
    write_private(&files.env, &command::env_file(request)).await?;
    write_private(&files.vars, &command::vars_file(request)).await?;
    write_private(&files.inputs, &command::inputs_file(request)).await?;
    write_private(&files.secrets, &command::secret_file(request)).await
}

async fn create_private_dir(dir: &Path) -> Result<()> {
    tokio::fs::create_dir_all(dir)
        .await
        .map_err(Error::io("creating the job directory"))?;
    tokio::fs::set_permissions(dir, std::fs::Permissions::from_mode(0o700))
        .await
        .map_err(Error::io("protecting the job directory"))
}

async fn write_private(path: &Path, content: &str) -> Result<()> {
    tokio::fs::write(path, content)
        .await
        .map_err(Error::io(format!("writing {}", path.display())))?;
    tokio::fs::set_permissions(path, std::fs::Permissions::from_mode(0o600))
        .await
        .map_err(Error::io(format!("protecting {}", path.display())))
}

async fn remove_secrets(work_root: &Path) {
    let files = JobFiles::under(work_root);
    if let Err(error) = tokio::fs::remove_file(&files.secrets).await
        && error.kind() != std::io::ErrorKind::NotFound
    {
        tracing::warn!(%error, "removing the secret file failed");
    }
}

/// act's verdict, or the stop that cut it short. A timeout is a failure, as on GitHub; a
/// cancel is `cancelled`. act exiting non-zero without a verdict is a runner failure.
fn conclusion_of(
    job_result: Option<&str>,
    status: ExitStatus,
    stopped: Option<StopReason>,
) -> (Conclusion, Option<FailureReason>) {
    match (stopped, job_result) {
        (Some(StopReason::Timeout), _) => (Conclusion::Failure, Some(FailureReason::Timeout)),
        (Some(StopReason::Cancelled), _) => (Conclusion::Cancelled, Some(FailureReason::Cancelled)),
        (None, Some("success")) => (Conclusion::Success, None),
        (None, Some("skipped")) => (Conclusion::Skipped, None),
        (None, Some(_)) => (Conclusion::Failure, Some(FailureReason::Steps)),
        (None, None) if status.success() => (Conclusion::Success, None),
        (None, None) => (Conclusion::Failure, Some(FailureReason::Runner)),
    }
}

type StepOutputs = BTreeMap<String, BTreeMap<String, String>>;

struct AssembleInput<'a> {
    request: &'a JobRequest,
    recorded: Recorded,
    ending: Ending,
    templates: &'a BTreeMap<String, String>,
    started_at: u64,
    batches: u32,
    config: &'a Config,
}

/// How the job ended, in the result's terms.
struct Ending {
    conclusion: Conclusion,
    reason: Option<FailureReason>,
    error: Option<String>,
    exit_code: Option<i32>,
}

fn assemble(input: AssembleInput<'_>) -> RunnerResult {
    let recorded = input.recorded;
    let outputs =
        workflow::resolve_outputs(input.templates, &recorded.step_outputs, &recorded.masker);
    RunnerResult {
        job_id: input.request.job_id.clone(),
        conclusion: input.ending.conclusion,
        reason: input.ending.reason,
        error: input.ending.error,
        exit_code: input.ending.exit_code,
        outputs: outputs.values,
        unresolved_outputs: outputs.unresolved,
        step_outputs: mask_outputs(&recorded.step_outputs, &recorded.masker),
        steps: recorded.steps,
        annotations: recorded.annotations,
        summaries: recorded.summaries,
        started_at: input.started_at,
        finished_at: now_ms(),
        lines: recorded.lines,
        batches: input.batches,
        act_version: input.config.act_version().to_owned(),
        image_version: input.config.image_version().to_owned(),
    }
}

fn mask_outputs(step_outputs: &StepOutputs, masker: &Masker) -> StepOutputs {
    step_outputs
        .iter()
        .map(|(step, outputs)| {
            let hidden = outputs
                .iter()
                .map(|(name, value)| (name.clone(), masker.apply(value)))
                .collect();
            (step.clone(), hidden)
        })
        .collect()
}

/// The tmpfs budget when the job may use the dependency cache: the executor granted it and the
/// repository or org variable `BEANSTALK_DEPS_CACHE` does not turn it off.
fn deps_cache_budget(request: &JobRequest) -> Option<u64> {
    let grant = request.deps_cache.as_ref()?;
    let switch = request.vars.get("BEANSTALK_DEPS_CACHE").map(String::as_str);
    (!deps::plan::is_switched_off(switch)).then_some(grant.tmpfs_max_bytes)
}

fn deps_cache_line(plan: &DepsPlan) -> String {
    let trigger = match &plan.trigger {
        Trigger::SetupNode { package_manager } => {
            format!("actions/setup-node with cache: {package_manager}")
        }
        Trigger::ActionsCache => "actions/cache of node_modules".to_owned(),
        Trigger::Native => "beanstalk/deps-cache".to_owned(),
    };
    format!(
        "Dependency cache on ({trigger}): node_modules in {} goes in memory, restored from and saved to the repository's snapshots",
        plan.install_dir
    )
}

pub(crate) fn now_ms() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map_or(0, |elapsed| {
            u64::try_from(elapsed.as_millis()).unwrap_or(u64::MAX)
        })
}

fn short(sha: &str) -> &str {
    sha.get(..12).unwrap_or(sha)
}

#[cfg(test)]
mod tests {
    use std::os::unix::process::ExitStatusExt;

    use super::*;

    #[test]
    fn a_timeout_is_a_failure_whatever_act_said() {
        let status = ExitStatus::from_raw(0);
        assert_eq!(
            conclusion_of(Some("success"), status, Some(StopReason::Timeout)),
            (Conclusion::Failure, Some(FailureReason::Timeout))
        );
    }

    #[test]
    fn a_cancel_is_cancelled() {
        let status = ExitStatus::from_raw(15);
        assert_eq!(
            conclusion_of(None, status, Some(StopReason::Cancelled)),
            (Conclusion::Cancelled, Some(FailureReason::Cancelled))
        );
    }

    #[test]
    fn acts_verdict_decides_otherwise() {
        let failed = ExitStatus::from_raw(1 << 8);
        assert_eq!(
            conclusion_of(Some("failure"), failed, None),
            (Conclusion::Failure, Some(FailureReason::Steps))
        );
        assert_eq!(
            conclusion_of(Some("success"), ExitStatus::from_raw(0), None),
            (Conclusion::Success, None)
        );
    }

    #[test]
    fn act_failing_without_a_verdict_is_the_runners_failure() {
        let failed = ExitStatus::from_raw(2 << 8);
        assert_eq!(
            conclusion_of(None, failed, None),
            (Conclusion::Failure, Some(FailureReason::Runner))
        );
    }
}
