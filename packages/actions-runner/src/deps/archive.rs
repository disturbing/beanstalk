//! Chunk archives: deterministic GNU tar through zstd, both as child processes (one per chunk,
//! so chunks pack and extract on every core). Packing lists paths explicitly (`--no-recursion`,
//! already sorted) with mtime 0 and owner 0, so the same files always give the same bytes and
//! therefore the same content address.

use std::path::Path;
use std::process::Stdio;

use sha2::{Digest, Sha256};
use tokio::io::{AsyncReadExt, AsyncWriteExt};
use tokio::process::{Child, ChildStdin, Command};

use super::key::hex;
use crate::error::{Error, Result};

/// zstd level for chunks (the spike's choice: 3.7:1 on real trees, fast on one core each).
const ZSTD_LEVEL: &str = "-3";

/// A packed chunk.
#[derive(Debug, Clone)]
pub struct Packed {
    pub sha256: String,
    pub body: Vec<u8>,
}

/// Packs `entries` (relative to `root`) into one `tar | zstd` archive held in memory.
///
/// # Errors
///
/// [`Error::Io`] when tar or zstd cannot run or fails.
pub async fn pack(root: &Path, entries: &[String], zstd: &Path) -> Result<Packed> {
    let mut tar = Command::new("tar")
        .args([
            "--create",
            "--file=-",
            "--format=gnu",
            "--no-recursion",
            "--null",
            "--files-from=-",
            "--mtime=@0",
            "--owner=0",
            "--group=0",
            "--numeric-owner",
        ])
        .current_dir(root)
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .kill_on_drop(true)
        .spawn()
        .map_err(Error::io("starting tar"))?;
    let tar_out: Stdio = tar
        .stdout
        .take()
        .ok_or_else(|| Error::Config("tar has no stdout".into()))?
        .try_into()
        .map_err(Error::io("piping tar into zstd"))?;
    let mut compress = Command::new(zstd)
        .args([ZSTD_LEVEL, "-T1", "-q", "-c"])
        .stdin(tar_out)
        .stdout(Stdio::piped())
        .stderr(Stdio::null())
        .kill_on_drop(true)
        .spawn()
        .map_err(Error::io("starting zstd"))?;
    let list: Vec<u8> = entries
        .iter()
        .flat_map(|entry| entry.bytes().chain([0]))
        .collect();
    let mut stdin = tar
        .stdin
        .take()
        .ok_or_else(|| Error::Config("tar has no stdin".into()))?;
    let feed = async move {
        stdin.write_all(&list).await?;
        stdin.shutdown().await
    };
    let mut stdout = compress
        .stdout
        .take()
        .ok_or_else(|| Error::Config("zstd has no stdout".into()))?;
    let mut body = Vec::new();
    let (listed, read) = tokio::join!(feed, stdout.read_to_end(&mut body));
    listed.map_err(Error::io("listing files for tar"))?;
    read.map_err(Error::io("reading zstd"))?;
    finished(tar, "tar").await?;
    finished(compress, "zstd").await?;
    let sha256 = hex(&Sha256::digest(&body));
    Ok(Packed { sha256, body })
}

/// A running `zstd -d | tar -x` into `root`, fed as a chunk streams in.
#[derive(Debug)]
pub struct Extractor {
    stdin: ChildStdin,
    decompress: Child,
    tar: Child,
}

impl Extractor {
    /// Starts the pipeline.
    ///
    /// # Errors
    ///
    /// [`Error::Io`] when zstd or tar cannot start.
    pub fn start(root: &Path, zstd: &Path) -> Result<Self> {
        let mut decompress = Command::new(zstd)
            .args(["-d", "-q", "-c"])
            .stdin(Stdio::piped())
            .stdout(Stdio::piped())
            .stderr(Stdio::null())
            .kill_on_drop(true)
            .spawn()
            .map_err(Error::io("starting zstd"))?;
        let plain: Stdio = decompress
            .stdout
            .take()
            .ok_or_else(|| Error::Config("zstd has no stdout".into()))?
            .try_into()
            .map_err(Error::io("piping zstd into tar"))?;
        let tar = Command::new("tar")
            .args([
                "--extract",
                "--file=-",
                "--no-same-owner",
                "--delay-directory-restore",
            ])
            .current_dir(root)
            .stdin(plain)
            .stdout(Stdio::null())
            .stderr(Stdio::piped())
            .kill_on_drop(true)
            .spawn()
            .map_err(Error::io("starting tar"))?;
        let stdin = decompress
            .stdin
            .take()
            .ok_or_else(|| Error::Config("zstd has no stdin".into()))?;
        Ok(Self {
            stdin,
            decompress,
            tar,
        })
    }

    /// Feeds the next bytes of the chunk.
    ///
    /// # Errors
    ///
    /// [`Error::Io`] when zstd stopped reading (it failed).
    pub async fn feed(&mut self, bytes: &[u8]) -> Result<()> {
        self.stdin
            .write_all(bytes)
            .await
            .map_err(Error::io("feeding zstd"))
    }

    /// Ends the input and waits for both processes.
    ///
    /// # Errors
    ///
    /// [`Error::Io`] when zstd or tar failed.
    pub async fn finish(mut self) -> Result<()> {
        self.stdin
            .shutdown()
            .await
            .map_err(Error::io("closing zstd"))?;
        drop(self.stdin);
        finished(self.decompress, "zstd -d").await?;
        finished(self.tar, "tar -x").await
    }
}

/// Extracts a whole chunk held in memory into `root` (`zstd -d | tar -x`).
///
/// # Errors
///
/// [`Error::Io`] when zstd or tar cannot run or fails.
pub async fn extract(root: &Path, body: Vec<u8>, zstd: &Path) -> Result<()> {
    let mut extractor = Extractor::start(root, zstd)?;
    extractor.feed(&body).await?;
    drop(body);
    extractor.finish().await
}

async fn finished(child: Child, what: &str) -> Result<()> {
    let output = child
        .wait_with_output()
        .await
        .map_err(Error::io(format!("waiting for {what}")))?;
    if output.status.success() {
        return Ok(());
    }
    let detail: String = String::from_utf8_lossy(&output.stderr)
        .chars()
        .take(400)
        .collect();
    Err(Error::Io {
        context: format!("{what} failed ({}): {detail}", output.status),
        source: std::io::Error::other(what.to_owned()),
    })
}

#[cfg(test)]
mod tests {
    use std::fs;
    use std::path::PathBuf;

    use super::*;

    fn zstd() -> PathBuf {
        PathBuf::from("zstd")
    }

    fn tools_present() -> bool {
        std::process::Command::new("zstd")
            .arg("--version")
            .output()
            .is_ok()
            && std::process::Command::new("tar")
                .arg("--version")
                .output()
                .is_ok_and(|out| String::from_utf8_lossy(&out.stdout).contains("GNU"))
    }

    #[tokio::test]
    async fn packing_is_deterministic_and_extracts_the_same_files() -> anyhow::Result<()> {
        if !tools_present() {
            return Ok(()); // GNU tar and zstd are in the job image, not on every dev machine
        }
        let source = tempfile::tempdir()?;
        fs::create_dir_all(source.path().join("node_modules/a"))?;
        fs::write(
            source.path().join("node_modules/a/index.js"),
            "module.exports = 1\n",
        )?;
        let entries = vec![
            "node_modules".to_owned(),
            "node_modules/a".to_owned(),
            "node_modules/a/index.js".to_owned(),
        ];
        let one = pack(source.path(), &entries, &zstd()).await?;
        let two = pack(source.path(), &entries, &zstd()).await?;
        assert_eq!(one.sha256, two.sha256);
        let target = tempfile::tempdir()?;
        extract(target.path(), one.body, &zstd()).await?;
        let copied = fs::read_to_string(target.path().join("node_modules/a/index.js"))?;
        assert_eq!(copied, "module.exports = 1\n");
        Ok(())
    }
}
