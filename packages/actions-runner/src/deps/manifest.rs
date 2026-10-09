//! The `deps.internal` contract with the executor Worker (`packages/actions-executor`,
//! `src/deps/wire.ts`). camelCase on the wire. The Worker owns the namespace: the tool names
//! only snapshot keys and chunk hashes; the repository and scope come from the job's token.

use serde::{Deserialize, Serialize};

/// `POST /v1/lookup`.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct LookupRequest {
    pub family_key: String,
    pub snapshot_key: String,
}

/// How the lookup matched.
#[derive(Debug, Clone, Copy, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "lowercase")]
pub enum Match {
    /// The same snapshot key: the tree is exactly what this lockfile installs.
    Exact,
    /// The family's latest snapshot: the install step reconciles it.
    Partial,
    None,
}

/// The answer to a lookup.
#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct LookupResponse {
    #[serde(rename = "match")]
    pub matched: Match,
    pub manifest: Option<Manifest>,
    /// The family's chunk count, kept stable across lockfile changes (null: a new family).
    pub chunk_count: Option<u32>,
    /// Whether this job may save (default-branch pushes only).
    pub can_save: bool,
    pub snapshot_max_bytes: u64,
    pub tmpfs_max_bytes: u64,
}

/// One snapshot: what the saver uploads last and the Worker stores.
#[derive(Debug, Clone, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct Manifest {
    pub version: u32,
    pub snapshot_key: String,
    pub family_key: String,
    pub chunk_count: u32,
    pub install_dir: String,
    pub lockfile: String,
    pub package_manager: String,
    pub platform: String,
    pub node_major: String,
    pub flags: String,
    pub extracted_bytes: u64,
    pub files: u64,
    pub chunks: Vec<ChunkEntry>,
}

impl Manifest {
    /// Compressed bytes of every chunk.
    pub fn compressed_bytes(&self) -> u64 {
        self.chunks.iter().map(|chunk| chunk.bytes).sum()
    }
}

/// One chunk of a snapshot.
#[derive(Debug, Clone, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct ChunkEntry {
    /// sha256 of the compressed bytes (the object's name).
    pub sha256: String,
    pub bytes: u64,
    pub extracted_bytes: u64,
    /// `b07`, `b07.1` for a split bucket, or `layout`.
    pub label: String,
    /// Package paths in it (none for the layout chunk).
    pub packages: Vec<String>,
}

/// `POST /v1/missing`.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct MissingRequest {
    pub chunks: Vec<String>,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct MissingResponse {
    pub missing: Vec<String>,
}

/// `POST /v1/uploads/<sha>`.
#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct UploadStarted {
    pub upload_id: String,
}

/// One uploaded part of a multipart upload.
#[derive(Debug, Clone, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct UploadedPart {
    pub part_number: u32,
    pub etag: String,
}

/// `POST /v1/uploads/<sha>/complete`.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CompleteUpload {
    pub upload_id: String,
    pub parts: Vec<UploadedPart>,
}

/// The answer to `POST /v1/commit`.
#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CommitResponse {
    pub saved: bool,
    pub reason: Option<String>,
}
