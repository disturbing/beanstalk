//! The Actions job runner: one process per container, one job per container.
//!
//! The executor's Durable Object starts a fresh container, posts the job (`POST /v1/job`), and
//! this process fetches the workflow file at the job's commit, cuts the workflow down to the one
//! job, runs `act` in host mode (`-P ubuntu-latest=-self-hosted`), and streams every log line out
//! through the container's outbound handler: small live batches for viewers, 64 KiB durable
//! chunks for R2, then the result. Nothing is kept here after it is acknowledged; the container
//! is destroyed when the job ends and is never given a second job.

pub mod act;
pub mod app;
pub mod config;
pub mod error;
pub mod git;
pub mod job;
pub mod mask;
pub mod outcome;
pub mod stream;
pub mod telemetry;
pub mod uplink;
pub mod wire;
pub mod workflow;
