//! The restore step (doc 27 §4.3): mount a tmpfs at `node_modules`, look the lockfile up,
//! fetch the snapshot's chunks (at most 16 in flight: above that the container's outbound path
//! reset connections in the spike), verify each against the manifest, extract it, and leave the
//! job's own install to run afterwards. A miss, a refusal or a failure leaves an empty tmpfs
//! and the install fills it, so the job never depends on the cache.

use std::path::Path;
use std::sync::Arc;
use std::time::Instant;

use serde_json::json;
use tokio::sync::Semaphore;
use tokio::task::JoinSet;

use super::archive;
use super::client::DepsClient;
use super::key::{self, Lockfile};
use super::manifest::{LookupRequest, LookupResponse, Manifest, Match};
use super::memory::{self, Placement};
use super::shim;
use super::step::{RestoreState, StepEnv, elapsed_ms, human, report, say};
use crate::error::{Error, Result};

/// Requests in flight to `deps.internal`.
const MAX_IN_FLIGHT: usize = 16;
/// Extracted trees cost up to 1.5x their size in tmpfs (4 KiB pages for small files); 1.25x is
/// the planning figure from the spike.
const TMPFS_OVERHEAD_PERCENT: u64 = 125;
/// Before the Worker answers, the tmpfs is sized by this default (the Worker's figure is used
/// for the budget check).
const DEFAULT_TMPFS_BYTES: u64 = 6 * 1024 * 1024 * 1024;

/// Runs the restore step. Never fails the job for a cache problem: it says what happened.
///
/// # Errors
///
/// [`Error::Io`] when the lockfile or the step's state cannot be read or written.
pub async fn run(env: &StepEnv) -> Result<()> {
    let started = Instant::now();
    let install = env.install_path();
    let node_modules = install.join("node_modules");
    let tmpfs_bytes = std::env::var("BEANSTALK_DEPS_TMPFS_MAX_BYTES")
        .ok()
        .and_then(|value| value.parse().ok())
        .unwrap_or(DEFAULT_TMPFS_BYTES);
    let lockfile = key::find_lockfile(&install);
    let manager = lockfile
        .as_ref()
        .map_or("npm", |lockfile| lockfile.package_manager);
    // The version probes (`npm --version` alone takes about 0.4 s) run while the tmpfs mounts.
    let (mounted, toolchain) = tokio::join!(
        memory::ensure_tmpfs(&node_modules, tmpfs_bytes),
        memory::toolchain(manager)
    );
    let mounted_ms = elapsed_ms(started);
    let placement = match mounted {
        Ok(placement) => placement,
        Err(error) => {
            say(&format!("Dependency cache skipped: {error}"));
            report(
                &json!({ "event": "restore", "result": "skipped", "reason": error.to_string() }),
            );
            return Ok(());
        }
    };
    say(&format!(
        "node_modules is in memory ({} tmpfs at {})",
        human(tmpfs_bytes),
        node_modules.display()
    ));
    let Some(lockfile) = lockfile else {
        say("No lockfile in the install directory: nothing to restore or save.");
        report(&json!({ "event": "restore", "result": "no-lockfile" }));
        return Ok(());
    };
    let lock_bytes = std::fs::read(&lockfile.path).map_err(Error::io("reading the lockfile"))?;
    let keys = key::keys(
        &env.install_dir,
        &lockfile,
        &lock_bytes,
        &toolchain,
        &env.flags,
    );
    let client = DepsClient::new(&env.url, &env.token)?;
    let looked_up = client
        .lookup(&LookupRequest {
            family_key: keys.family.clone(),
            snapshot_key: keys.snapshot.clone(),
        })
        .await;
    let answer = match looked_up {
        Ok(answer) => answer,
        Err(error) => {
            say(&format!(
                "Dependency cache unavailable ({error}); the install runs as usual."
            ));
            report(&json!({ "event": "restore", "result": "unavailable" }));
            return Ok(());
        }
    };
    let state = RestoreState {
        install_dir: env.install_dir.clone(),
        family_key: keys.family,
        snapshot_key: keys.snapshot,
        lockfile: lockfile.name.to_owned(),
        package_manager: lockfile.package_manager.to_owned(),
        platform: toolchain.platform,
        node_major: toolchain.node_major,
        flags: env.flags.clone(),
        matched: answer.matched,
        chunk_count: answer.chunk_count,
        can_save: answer.can_save,
        snapshot_max_bytes: answer.snapshot_max_bytes,
        restored_chunks: Vec::new(),
    };
    let looked_up_ms = elapsed_ms(started);
    let outcome = if answer.matched == Match::Partial && env.wipes_tree {
        Outcome::Skipped(
            "this job installs with `npm ci`, which deletes node_modules, so the family's previous snapshot is not downloaded; the save uploads only the chunks that changed".into(),
        )
    } else {
        restore_snapshot(&client, &answer, &install, &node_modules).await
    };
    finish(
        env,
        state,
        &lockfile,
        outcome,
        Timing {
            started,
            placement,
            mounted_ms,
            looked_up_ms,
        },
    )
}

#[derive(Clone, Copy)]
struct Timing {
    started: Instant,
    placement: Placement,
    /// From the start to the tmpfs mounted (and the tool versions read).
    mounted_ms: u64,
    /// From the start to the lookup answered.
    looked_up_ms: u64,
}

/// What the restore did.
enum Outcome {
    Restored {
        manifest: Box<Manifest>,
        downloaded: u64,
    },
    Skipped(String),
    Failed(Error),
    Miss,
}

async fn restore_snapshot(
    client: &DepsClient,
    answer: &LookupResponse,
    install: &Path,
    node_modules: &Path,
) -> Outcome {
    let Some(manifest) = answer
        .manifest
        .clone()
        .filter(|_| answer.matched != Match::None)
    else {
        return Outcome::Miss;
    };
    let needed = manifest
        .extracted_bytes
        .saturating_mul(TMPFS_OVERHEAD_PERCENT)
        / 100;
    if needed > answer.tmpfs_max_bytes {
        return Outcome::Skipped(format!(
            "the snapshot needs about {} of memory, over the {} budget",
            human(needed),
            human(answer.tmpfs_max_bytes)
        ));
    }
    match fetch_and_extract(client, &manifest, install).await {
        Ok(downloaded) => {
            freshen_hidden_lockfiles(node_modules);
            Outcome::Restored {
                manifest: Box::new(manifest),
                downloaded,
            }
        }
        Err(error) => {
            memory::empty(node_modules);
            Outcome::Failed(error)
        }
    }
}

/// Every chunk at once (at most 16 requests in flight), each streamed through sha256 and
/// `zstd -d | tar -x` as it arrives. A chunk whose hash or size is wrong fails the restore and
/// the caller empties the tmpfs before any later step runs, so an unverified byte never
/// reaches the job (measured: buffering each chunk until verified, then extracting, made the
/// 533 MB Next.js-class restore 4.0 s instead of the spike's 1.0-1.5 s).
async fn fetch_and_extract(
    client: &DepsClient,
    manifest: &Manifest,
    install: &Path,
) -> Result<u64> {
    let requests = Arc::new(Semaphore::new(MAX_IN_FLIGHT));
    let zstd = memory::zstd();
    let mut tasks = JoinSet::new();
    for chunk in manifest.chunks.clone() {
        let (client, requests, install, zstd) = (
            client.clone(),
            Arc::clone(&requests),
            install.to_path_buf(),
            zstd.clone(),
        );
        tasks.spawn(async move {
            let _request = requests
                .acquire_owned()
                .await
                .map_err(|_| Error::Config("restore cancelled".into()))?;
            let mut extractor = archive::Extractor::start(&install, &zstd)?;
            client
                .chunk_into(&chunk.sha256, chunk.bytes, &mut extractor)
                .await?;
            extractor.finish().await?;
            Ok::<u64, Error>(chunk.bytes)
        });
    }
    let mut downloaded = 0;
    while let Some(joined) = tasks.join_next().await {
        let bytes = joined.map_err(|error| Error::Config(format!("restore task: {error}")))??;
        downloaded += bytes;
    }
    Ok(downloaded)
}

/// Package managers trust their record of the installed tree only when it is newer than every
/// package directory (npm: `node_modules/.package-lock.json`; pnpm: `.modules.yaml`). Chunks
/// extract in parallel, so directories end up with the time of the last write into them;
/// without this, npm ignores its record, rereads every `package.json` and reinstalls a third
/// of the tree (measured: 26 s for fastify instead of about 1 s).
fn freshen_hidden_lockfiles(node_modules: &Path) {
    let now = std::time::SystemTime::now();
    for name in [
        ".package-lock.json",
        ".modules.yaml",
        ".yarn-integrity",
        ".yarn-state.yml",
    ] {
        if let Ok(file) = std::fs::File::options()
            .write(true)
            .open(node_modules.join(name))
        {
            let _ = file.set_modified(now);
        }
    }
}

fn finish(
    env: &StepEnv,
    mut state: RestoreState,
    lockfile: &Lockfile,
    outcome: Outcome,
    timing: Timing,
) -> Result<()> {
    let ms = elapsed_ms(timing.started);
    let in_use = memory::memory_in_use().unwrap_or(0);
    let mounted = timing.placement == Placement::Mounted;
    match outcome {
        Outcome::Restored {
            manifest,
            downloaded,
        } => {
            state.restored_chunks = manifest
                .chunks
                .iter()
                .map(|chunk| chunk.sha256.clone())
                .collect();
            let exact = state.matched == Match::Exact;
            say(&format!(
                "Restored node_modules ({} hit): {} files, {} in {} chunks ({} downloaded) in {:.1} s",
                if exact { "exact" } else { "partial" },
                manifest.files,
                human(manifest.extracted_bytes),
                manifest.chunks.len(),
                human(downloaded),
                f64::from(u32::try_from(ms).unwrap_or(u32::MAX)) / 1000.0,
            ));
            if exact && lockfile.package_manager == "npm" {
                shim::install_npm_shim(env)?;
                say(
                    "The tree is exactly what this lockfile installs: `npm ci` keeps it and only runs the root package's scripts.",
                );
            }
            if !exact {
                say(
                    "The install step reconciles the tree with the lockfile; the save step uploads only the chunks that changed.",
                );
            }
            env.set_output("cache-hit", if exact { "true" } else { "false" });
            env.set_output("cache-matched-key", &manifest.snapshot_key);
            report(&json!({
                "event": "restore", "result": if exact { "exact" } else { "partial" },
                "ms": ms, "downloadedBytes": downloaded, "extractedBytes": manifest.extracted_bytes,
                "files": manifest.files, "chunks": manifest.chunks.len(), "memoryInUse": in_use,
                "mounted": mounted, "mountMs": timing.mounted_ms, "lookupMs": timing.looked_up_ms,
            }));
        }
        Outcome::Miss => {
            say("No snapshot for this lockfile yet: the install fills the in-memory node_modules.");
            env.set_output("cache-hit", "false");
            report(&json!({ "event": "restore", "result": "miss", "ms": ms, "mounted": mounted }));
        }
        Outcome::Skipped(reason) => {
            say(&format!("Dependency snapshot not restored: {reason}."));
            state.matched = Match::None;
            env.set_output("cache-hit", "false");
            report(&json!({ "event": "restore", "result": "skipped", "reason": reason, "ms": ms }));
        }
        Outcome::Failed(error) => {
            say(&format!(
                "Dependency snapshot not restored ({error}); the install runs as usual."
            ));
            state.matched = Match::None;
            env.set_output("cache-hit", "false");
            report(&json!({ "event": "restore", "result": "failed", "ms": ms }));
        }
    }
    state.store(env)
}
