//! `node_modules` in memory: the tmpfs mount (never the container disk, doc 27 §3.1), and what
//! the job's machine looks like (platform, tool versions, memory in use).

use std::os::unix::fs::MetadataExt;
use std::path::{Path, PathBuf};
use std::process::Stdio;

use tokio::process::Command;

use super::key::{Toolchain, major};
use super::plan::TOOL_DIR;
use crate::error::{Error, Result};

/// How `node_modules` came to be in memory.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Placement {
    /// It already was a mount (Docker mode: the job container's `--tmpfs`).
    AlreadyMounted,
    /// The tool mounted a tmpfs there (host mode, through the image's `sudo`).
    Mounted,
}

/// Mounts a tmpfs of `size` bytes at `node_modules`, unless one is already there.
///
/// # Errors
///
/// [`Error::Unsupported`] when `node_modules` already holds files on disk, or the mount is not
/// allowed; the caller then restores nothing (it never extracts onto the disk).
pub async fn ensure_tmpfs(node_modules: &Path, size: u64) -> Result<Placement> {
    if is_mountpoint(node_modules) {
        return Ok(Placement::AlreadyMounted);
    }
    if std::fs::read_dir(node_modules).is_ok_and(|mut entries| entries.next().is_some()) {
        return Err(Error::Unsupported(format!(
            "{} already has files on disk; leaving it alone",
            node_modules.display()
        )));
    }
    std::fs::create_dir_all(node_modules).map_err(Error::io("creating node_modules"))?;
    let options = format!(
        "size={size},mode=0755,uid={},gid={},nosuid,nodev",
        uid_of(node_modules.parent().unwrap_or(node_modules)),
        gid_of(node_modules.parent().unwrap_or(node_modules)),
    );
    let mount = privileged(&["mount", "-t", "tmpfs", "-o", &options, "tmpfs"])
        .arg(node_modules)
        .stdin(Stdio::null())
        .output()
        .await
        .map_err(Error::io("running mount"))?;
    if !mount.status.success() {
        let detail = String::from_utf8_lossy(&mount.stderr).trim().to_owned();
        return Err(Error::Unsupported(format!(
            "mounting a tmpfs failed: {detail}"
        )));
    }
    Ok(Placement::Mounted)
}

/// Empties a tmpfs after a failed restore, so a half-written tree never reaches the install.
pub fn empty(node_modules: &Path) {
    if let Ok(entries) = std::fs::read_dir(node_modules) {
        for entry in entries.flatten() {
            let path = entry.path();
            let _ = if path.is_dir() && !path.is_symlink() {
                std::fs::remove_dir_all(&path)
            } else {
                std::fs::remove_file(&path)
            };
        }
    }
}

/// Whether `path` is the root of a mount (its device differs from its parent's).
pub fn is_mountpoint(path: &Path) -> bool {
    let (Ok(own), Some(Ok(parent))) = (
        std::fs::symlink_metadata(path),
        path.parent().map(std::fs::symlink_metadata),
    ) else {
        return false;
    };
    own.is_dir() && own.dev() != parent.dev()
}

/// The platform, Node major and package-manager major the tree is built for.
pub async fn toolchain(package_manager: &str) -> Toolchain {
    let node = version_of("node").await;
    let manager = version_of(package_manager).await;
    Toolchain {
        platform: platform(),
        node_major: major(&node),
        manager_major: major(&manager),
    }
}

/// `MemTotal - MemAvailable` in bytes, from `/proc/meminfo`.
pub fn memory_in_use() -> Option<u64> {
    let text = std::fs::read_to_string("/proc/meminfo").ok()?;
    let field = |name: &str| {
        text.lines()
            .find(|line| line.starts_with(name))
            .and_then(|line| line.split_whitespace().nth(1))
            .and_then(|kb| kb.parse::<u64>().ok())
            .map(|kb| kb * 1024)
    };
    Some(field("MemTotal:")?.saturating_sub(field("MemAvailable:")?))
}

/// The zstd to use: the image's copy in the tool directory (also mounted into Docker-mode job
/// containers), else the one on PATH.
pub fn zstd() -> PathBuf {
    let bundled = Path::new(TOOL_DIR).join("zstd");
    if bundled.is_file() {
        bundled
    } else {
        PathBuf::from("zstd")
    }
}

fn platform() -> String {
    let libc = if Path::new("/etc/alpine-release").exists() {
        "musl"
    } else {
        "glibc"
    };
    format!(
        "{}-{}-{libc}",
        std::env::consts::OS,
        node_arch(std::env::consts::ARCH)
    )
}

fn node_arch(arch: &str) -> &str {
    match arch {
        "x86_64" => "x64",
        "aarch64" => "arm64",
        other => other,
    }
}

async fn version_of(program: &str) -> String {
    Command::new(program)
        .arg("--version")
        .stdin(Stdio::null())
        .stderr(Stdio::null())
        .output()
        .await
        .ok()
        .filter(|output| output.status.success())
        .map(|output| String::from_utf8_lossy(&output.stdout).trim().to_owned())
        .unwrap_or_default()
}

/// `sudo -n <args>` unless already root.
fn privileged(args: &[&str]) -> Command {
    let is_root = std::fs::metadata("/proc/self").is_ok_and(|meta| meta.uid() == 0);
    let (program, rest) = if is_root {
        (args[0], &args[1..])
    } else {
        ("sudo", args)
    };
    let mut command = Command::new(program);
    if !is_root {
        command.arg("-n");
    }
    command.args(rest);
    command
}

fn uid_of(path: &Path) -> u32 {
    std::fs::metadata(path).map_or(0, |meta| meta.uid())
}

fn gid_of(path: &Path) -> u32 {
    std::fs::metadata(path).map_or(0, |meta| meta.gid())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn a_plain_directory_is_not_a_mountpoint() -> anyhow::Result<()> {
        let dir = tempfile::tempdir()?;
        std::fs::create_dir(dir.path().join("node_modules"))?;
        assert!(!is_mountpoint(&dir.path().join("node_modules")));
        assert!(!is_mountpoint(&dir.path().join("missing")));
        Ok(())
    }

    #[test]
    fn names_platforms_as_node_does() {
        assert_eq!(node_arch("x86_64"), "x64");
        assert!(platform().ends_with("glibc") || platform().ends_with("musl"));
    }
}
