//! The snapshot key and its family (docs/claude-opus/27 §4.2).
//!
//! The family is everything that decides the shape of a tree except the lockfile's content:
//! install directory, lockfile name, platform, Node major, package manager and major, and the
//! install flags. The snapshot key is the family plus the lockfile's bytes. An exact hit is the
//! same key; a partial hit is the family's latest snapshot (`actions/cache`'s restore-keys).

use std::path::{Path, PathBuf};

use sha2::{Digest, Sha256};

/// Lockfiles in the order they are looked for; the first present names the package manager.
const LOCKFILES: [(&str, &str); 5] = [
    ("package-lock.json", "npm"),
    ("npm-shrinkwrap.json", "npm"),
    ("pnpm-lock.yaml", "pnpm"),
    ("yarn.lock", "yarn"),
    ("bun.lock", "bun"),
];
/// Bump when the chunk format changes, so old snapshots are never restored by a new tool.
const FORMAT: &str = "beanstalk-deps/1";

/// The install directory's lockfile and the package manager it implies.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Lockfile {
    pub path: PathBuf,
    pub name: &'static str,
    pub package_manager: &'static str,
}

/// What, besides the lockfile, decides the tree.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Toolchain {
    pub platform: String,
    pub node_major: String,
    pub manager_major: String,
}

/// The two hashes, hex.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Keys {
    pub family: String,
    pub snapshot: String,
}

/// The first lockfile in `dir`, if any.
pub fn find_lockfile(dir: &Path) -> Option<Lockfile> {
    LOCKFILES.iter().find_map(|(name, manager)| {
        let path = dir.join(name);
        path.is_file().then_some(Lockfile {
            path,
            name,
            package_manager: manager,
        })
    })
}

/// The family and snapshot keys of an install.
pub fn keys(
    install_dir: &str,
    lockfile: &Lockfile,
    lock_bytes: &[u8],
    toolchain: &Toolchain,
    flags: &str,
) -> Keys {
    let family_input = [
        FORMAT,
        install_dir,
        lockfile.name,
        &toolchain.platform,
        &toolchain.node_major,
        lockfile.package_manager,
        &toolchain.manager_major,
        flags,
    ]
    .join("\n");
    let family = hex(&Sha256::digest(family_input.as_bytes()));
    let mut snapshot = Sha256::new();
    snapshot.update(family.as_bytes());
    snapshot.update(b"\n");
    snapshot.update(lock_bytes);
    Keys {
        family,
        snapshot: hex(&snapshot.finalize()),
    }
}

/// The major version in `v24.21.0` or `10.9.2` (`unknown` when there is none).
pub fn major(version: &str) -> String {
    let digits: String = version
        .trim()
        .trim_start_matches('v')
        .chars()
        .take_while(char::is_ascii_digit)
        .collect();
    if digits.is_empty() {
        "unknown".into()
    } else {
        digits
    }
}

/// Lowercase hex of `bytes`.
pub fn hex(bytes: &[u8]) -> String {
    use std::fmt::Write as _;
    bytes
        .iter()
        .fold(String::with_capacity(bytes.len() * 2), |mut out, byte| {
            let _ = write!(out, "{byte:02x}");
            out
        })
}

#[cfg(test)]
mod tests {
    use proptest::prelude::*;

    use super::*;

    fn toolchain() -> Toolchain {
        Toolchain {
            platform: "linux-x64-glibc".into(),
            node_major: "24".into(),
            manager_major: "11".into(),
        }
    }

    fn lockfile() -> Lockfile {
        Lockfile {
            path: PathBuf::from("package-lock.json"),
            name: "package-lock.json",
            package_manager: "npm",
        }
    }

    #[test]
    fn the_same_family_with_another_lockfile_is_another_snapshot() {
        let one = keys(".", &lockfile(), b"a", &toolchain(), "");
        let two = keys(".", &lockfile(), b"b", &toolchain(), "");
        assert_eq!(one.family, two.family);
        assert_ne!(one.snapshot, two.snapshot);
    }

    #[test]
    fn flags_and_node_change_the_family() {
        let base = keys(".", &lockfile(), b"a", &toolchain(), "");
        let flagged = keys(".", &lockfile(), b"a", &toolchain(), "--omit=dev");
        let node = keys(
            ".",
            &lockfile(),
            b"a",
            &Toolchain {
                node_major: "20".into(),
                ..toolchain()
            },
            "",
        );
        assert_ne!(base.family, flagged.family);
        assert_ne!(base.family, node.family);
    }

    #[test]
    fn reads_major_versions() {
        assert_eq!(major("v24.21.0\n"), "24");
        assert_eq!(major("10.9.2"), "10");
        assert_eq!(major(""), "unknown");
    }

    proptest! {
        #[test]
        fn keys_are_64_hex_characters(lock in proptest::collection::vec(any::<u8>(), 0..256)) {
            let keys = keys(".", &lockfile(), &lock, &toolchain(), "");
            prop_assert_eq!(keys.snapshot.len(), 64);
            prop_assert!(keys.snapshot.bytes().all(|b| b.is_ascii_hexdigit()));
        }
    }
}
