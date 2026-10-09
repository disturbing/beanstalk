//! The save step (doc 27 §4.4): only after a miss or a partial hit, only on a run allowed to
//! save, pack the tree into chunks (deterministic, so unchanged buckets hash to the keys they
//! already have), ask the Worker in one request which are missing, upload only those, and
//! commit the manifest last. Over the snapshot cap nothing is uploaded and the previous
//! snapshot stays.

use std::sync::Arc;
use std::time::Instant;

use bytes::Bytes;
use serde_json::json;
use tokio::sync::Semaphore;
use tokio::task::JoinSet;

use super::archive::{self, Packed};
use super::chunks::{self, ChunkPlan, MAX_CHUNK_BYTES};
use super::client::DepsClient;
use super::manifest::{ChunkEntry, Manifest, Match};
use super::memory;
use super::step::{RestoreState, StepEnv, elapsed_ms, human, report, say};
use super::tree::{self, Tree};
use crate::error::{Error, Result};

/// Chunks packed at once (one `tar | zstd` pair each; the instance has 4 vCPU).
const PACKERS: usize = 4;
/// Uploads at once.
const UPLOADERS: usize = 8;
/// One request carries at most this much (the Worker's request body limit is 100 MB); bigger
/// chunks go up as R2 multipart parts of this size.
const PART_BYTES: usize = 64 * 1024 * 1024;

/// Runs the save step. Never fails the job for a cache problem.
///
/// # Errors
///
/// None today: every cache problem is reported in the log instead.
pub async fn run(env: &StepEnv) -> Result<()> {
    let Some(state) = RestoreState::load(env) else {
        say("Nothing to save: the restore step did not run or found no lockfile.");
        return Ok(());
    };
    if state.matched == Match::Exact {
        say("Exact hit: the snapshot is already saved.");
        report(
            &json!({ "event": "save", "result": "exact-hit", "memoryInUse": memory::memory_in_use() }),
        );
        return Ok(());
    }
    if !state.can_save {
        say(
            "This run reads the cache but does not save it (only pushes to the default branch save).",
        );
        report(
            &json!({ "event": "save", "result": "read-only", "memoryInUse": memory::memory_in_use() }),
        );
        return Ok(());
    }
    match save(env, &state).await {
        Ok(()) => Ok(()),
        Err(error) => {
            say(&format!("Dependency snapshot not saved: {error}"));
            report(&json!({ "event": "save", "result": "failed" }));
            Ok(())
        }
    }
}

async fn save(env: &StepEnv, state: &RestoreState) -> Result<()> {
    let started = Instant::now();
    let install = env.install_path();
    let scan_root = install.clone();
    let tree = tokio::task::spawn_blocking(move || tree::scan(&scan_root))
        .await
        .map_err(|error| Error::Config(format!("scan task: {error}")))??;
    if tree.packages.is_empty() {
        say("node_modules is empty: nothing to save.");
        return Ok(());
    }
    let count = state
        .chunk_count
        .unwrap_or_else(|| chunks::chunk_count_for(tree.bytes()));
    let plans = chunks::plan(&tree, count);
    let packed = pack_all(&install, plans).await?;
    let pack_ms = elapsed_ms(started);
    let compressed: u64 = packed.iter().map(|(_, packed)| len(packed)).sum();
    let client = DepsClient::new(&env.url, &env.token)?;
    let manifest = manifest_of(state, &tree, count, &packed);
    if compressed > state.snapshot_max_bytes {
        // Uploads nothing; the commit only records the refusal on the family (the Worker
        // checks the cap before anything else).
        let _ = client.commit(&manifest).await;
        say(&format!(
            "Dependency snapshot {} is over the {} limit; nothing uploaded, restores keep the previous snapshot. Consider filtered installs.",
            human(compressed),
            human(state.snapshot_max_bytes)
        ));
        report(&json!({ "event": "save", "result": "over-cap", "compressedBytes": compressed }));
        return Ok(());
    }
    if let Some((plan, chunk)) = packed
        .iter()
        .find(|(_, packed)| len(packed) > MAX_CHUNK_BYTES)
    {
        return Err(Error::Unsupported(format!(
            "chunk {} is {} (over 256 MB)",
            plan.label,
            human(len(chunk))
        )));
    }
    let asked: Vec<String> = packed
        .iter()
        .map(|(_, packed)| packed.sha256.clone())
        .filter(|sha| !state.restored_chunks.contains(sha))
        .collect();
    let missing = if asked.is_empty() {
        Vec::new()
    } else {
        client.missing(asked).await?
    };
    let upload_started = Instant::now();
    let uploaded = upload_missing(&client, packed, &missing).await?;
    let upload_ms = elapsed_ms(upload_started);
    let committed = client.commit(&manifest).await?;
    let total_ms = elapsed_ms(started);
    if committed.saved {
        say(&format!(
            "Saved node_modules: {} chunks, {} uploaded of {} ({} new chunks) in {:.1} s",
            manifest.chunks.len(),
            human(uploaded),
            human(compressed),
            missing.len(),
            f64::from(u32::try_from(total_ms).unwrap_or(u32::MAX)) / 1000.0
        ));
    } else {
        say(&format!(
            "The cache refused the snapshot: {}",
            committed.reason.as_deref().unwrap_or("no reason given")
        ));
    }
    report(&json!({
        "event": "save", "result": if committed.saved { "saved" } else { "refused" },
        "ms": total_ms, "packMs": pack_ms, "uploadMs": upload_ms,
        "uploadedBytes": uploaded, "compressedBytes": compressed,
        "extractedBytes": manifest.extracted_bytes, "chunks": manifest.chunks.len(),
        "newChunks": missing.len(), "memoryInUse": memory::memory_in_use(),
    }));
    Ok(())
}

async fn pack_all(
    install: &std::path::Path,
    plans: Vec<ChunkPlan>,
) -> Result<Vec<(ChunkPlan, Packed)>> {
    let gate = Arc::new(Semaphore::new(PACKERS));
    let zstd = memory::zstd();
    let mut tasks = JoinSet::new();
    for (index, plan) in plans.into_iter().enumerate() {
        let (gate, root, zstd) = (Arc::clone(&gate), install.to_path_buf(), zstd.clone());
        tasks.spawn(async move {
            let _permit = gate
                .acquire_owned()
                .await
                .map_err(|_| Error::Config("save cancelled".into()))?;
            let packed = archive::pack(&root, &plan.entries, &zstd).await?;
            Ok::<_, Error>((index, plan, packed))
        });
    }
    let mut done = Vec::new();
    while let Some(joined) = tasks.join_next().await {
        done.push(joined.map_err(|error| Error::Config(format!("pack task: {error}")))??);
    }
    done.sort_by_key(|(index, _, _)| *index);
    Ok(done
        .into_iter()
        .map(|(_, plan, packed)| (plan, packed))
        .collect())
}

async fn upload_missing(
    client: &DepsClient,
    packed: Vec<(ChunkPlan, Packed)>,
    missing: &[String],
) -> Result<u64> {
    let gate = Arc::new(Semaphore::new(UPLOADERS));
    let mut tasks = JoinSet::new();
    let mut seen = std::collections::BTreeSet::new();
    for (_, chunk) in packed {
        if !missing.contains(&chunk.sha256) || !seen.insert(chunk.sha256.clone()) {
            continue;
        }
        let (gate, client) = (Arc::clone(&gate), client.clone());
        tasks.spawn(async move {
            let _permit = gate
                .acquire_owned()
                .await
                .map_err(|_| Error::Config("save cancelled".into()))?;
            let bytes = len(&chunk);
            client
                .upload(&chunk.sha256, Bytes::from(chunk.body), PART_BYTES)
                .await?;
            Ok::<u64, Error>(bytes)
        });
    }
    let mut uploaded = 0;
    while let Some(joined) = tasks.join_next().await {
        uploaded += joined.map_err(|error| Error::Config(format!("upload task: {error}")))??;
    }
    Ok(uploaded)
}

fn manifest_of(
    state: &RestoreState,
    tree: &Tree,
    count: u32,
    packed: &[(ChunkPlan, Packed)],
) -> Manifest {
    Manifest {
        version: 1,
        snapshot_key: state.snapshot_key.clone(),
        family_key: state.family_key.clone(),
        chunk_count: count,
        install_dir: state.install_dir.clone(),
        lockfile: state.lockfile.clone(),
        package_manager: state.package_manager.clone(),
        platform: state.platform.clone(),
        node_major: state.node_major.clone(),
        flags: state.flags.clone(),
        extracted_bytes: tree.bytes(),
        files: tree.files,
        chunks: packed
            .iter()
            .map(|(plan, packed)| ChunkEntry {
                sha256: packed.sha256.clone(),
                bytes: len(packed),
                extracted_bytes: plan.raw_bytes,
                label: plan.label.clone(),
                packages: plan.packages.clone(),
            })
            .collect(),
    }
}

fn len(packed: &Packed) -> u64 {
    u64::try_from(packed.body.len()).unwrap_or(u64::MAX)
}
