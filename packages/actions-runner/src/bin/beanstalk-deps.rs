//! `beanstalk-deps restore | save`: the dependency cache's two steps inside a job
//! (docs/claude-opus/27). A cache problem never fails the job: the tool says what happened and
//! exits 0; only a misconfigured step (no workspace, no token) exits non-zero.

use actions_runner::deps::{restore, save, step};
use anyhow::{Context, bail};

#[tokio::main]
async fn main() -> anyhow::Result<()> {
    let command = std::env::args().nth(1).unwrap_or_default();
    let env = step::StepEnv::from_env().context("reading the step's environment")?;
    match command.as_str() {
        "restore" => restore::run(&env).await.context("restoring dependencies"),
        "save" => save::run(&env).await.context("saving dependencies"),
        other => bail!("usage: beanstalk-deps restore|save (got {other:?})"),
    }
}
