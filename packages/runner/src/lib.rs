//! Git and test runner for beanstalk's integration decisions.
//!
//! An HTTP service that squashes, composes, reverts and tests commits held in Cloudflare
//! Artifacts git remotes for the `RunDO` Durable Object, with the semantics of the local race
//! harness (`research/race/harness/gitops.py` and `ci.py`), so cloud and local races compare
//! metric for metric. The API contract is section 3 of
//! `docs/claude-opus/10-cf-prototype-plan.md`; `packages/runner/README.md` summarises it.

pub mod app;
pub mod config;
pub mod error;
pub mod telemetry;

mod check;
mod git;
mod integrate;
mod process;
mod resolve;
mod wire;
mod workspace;
