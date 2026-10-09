//! The CI dependency cache (docs/claude-opus/27-ci-dependency-cache.md): `node_modules`
//! restored into a tmpfs from content-addressed chunks in R2 and saved back by changed chunk.
//!
//! [`plan`] runs in the job runner and adds the restore and save steps to the job; the rest is
//! the `beanstalk-deps` tool those steps run inside the job (host mode, or the job container in
//! Docker mode), talking to the executor Worker at `http://deps.internal`.

pub mod archive;
pub mod chunks;
pub mod client;
pub mod key;
pub mod manifest;
pub mod memory;
pub mod plan;
pub mod restore;
pub mod save;
pub mod shim;
pub mod step;
pub mod tree;
