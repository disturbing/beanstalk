//! JSON bodies of the runner's API (plan §3).

mod requests;
mod responses;

pub(crate) use requests::{CheckBody, ComposeBody, RevertBody, SquashBody, UpdateRefBody};
pub(crate) use responses::{
    CheckResponse, ComposeResponse, HealthResponse, LandingBody, SquashResponse, UpdateRefResponse,
    VersionResponse,
};
