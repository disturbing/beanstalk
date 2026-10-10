//! A `node_modules` tree split into packages and the layout around them (doc 27 §4.1).
//!
//! A package is a real directory directly under a `node_modules` (or an `@scope` there) whose
//! name does not start with a dot, holding its own files but not its nested `node_modules`,
//! which is scanned as more packages; pnpm's `node_modules/.pnpm/<id>` directories are packages
//! whole. Everything else (the `node_modules` and scope directories, `.bin` links, hidden
//! lockfiles, pnpm's top-level symlinks) is the layout. `node_modules/.cache` (build caches,
//! not dependencies) is left out. Paths are relative to the install directory, sorted, so the
//! same tree always lists the same way.

use std::fs;
use std::os::unix::fs::MetadataExt;
use std::path::Path;

use crate::error::{Error, Result};

/// One package and every path it owns.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Package {
    /// `node_modules/@scope/name`, relative to the install directory.
    pub path: String,
    /// The name chunks are assigned by (`@scope/name`, or the `.pnpm` id).
    pub name: String,
    pub entries: Vec<String>,
    pub bytes: u64,
}

/// The whole tree.
#[derive(Debug, Clone, Default, PartialEq, Eq)]
pub struct Tree {
    pub packages: Vec<Package>,
    pub layout: Vec<String>,
    pub layout_bytes: u64,
    pub files: u64,
}

impl Tree {
    /// Bytes of every regular file.
    pub fn bytes(&self) -> u64 {
        self.layout_bytes
            + self
                .packages
                .iter()
                .map(|package| package.bytes)
                .sum::<u64>()
    }
}

/// Scans `<install_dir>/node_modules`.
///
/// # Errors
///
/// [`Error::Io`] when a directory cannot be read.
pub fn scan(install_dir: &Path) -> Result<Tree> {
    let mut tree = Tree::default();
    if fs::symlink_metadata(install_dir.join("node_modules")).is_err() {
        return Ok(tree);
    }
    scan_modules(install_dir, "node_modules", &mut tree)?;
    tree.packages.sort_by(|a, b| a.path.cmp(&b.path));
    tree.layout.sort();
    Ok(tree)
}

fn scan_modules(root: &Path, modules: &str, tree: &mut Tree) -> Result<()> {
    tree.layout.push(modules.to_owned());
    for name in sorted_names(&root.join(modules))? {
        let path = format!("{modules}/{name}");
        let meta = metadata(root, &path)?;
        if !meta.is_dir() {
            add_layout(&path, &meta, tree);
        } else if modules == "node_modules" && name == ".cache" {
            // Build caches (babel, webpack, ...) are not dependencies.
        } else if name == ".pnpm" {
            scan_pnpm_store(root, &path, tree)?;
        } else if name.starts_with('.') {
            walk_into_layout(root, &path, tree)?;
        } else if name.starts_with('@') {
            tree.layout.push(path.clone());
            for scoped in sorted_names(&root.join(&path))? {
                let package_path = format!("{path}/{scoped}");
                add_candidate(root, &package_path, &format!("{name}/{scoped}"), tree)?;
            }
        } else {
            add_candidate(root, &path, &name, tree)?;
        }
    }
    Ok(())
}

fn add_candidate(root: &Path, path: &str, name: &str, tree: &mut Tree) -> Result<()> {
    let meta = metadata(root, path)?;
    if !meta.is_dir() {
        add_layout(path, &meta, tree);
        return Ok(());
    }
    let mut package = Package {
        path: path.to_owned(),
        name: name.to_owned(),
        entries: vec![path.to_owned()],
        bytes: 0,
    };
    let nested = format!("{path}/node_modules");
    collect(root, path, Some(&nested), &mut package, &mut tree.files)?;
    tree.packages.push(package);
    if metadata(root, &nested).is_ok_and(|meta| meta.is_dir()) {
        scan_modules(root, &nested, tree)?;
    }
    Ok(())
}

fn scan_pnpm_store(root: &Path, path: &str, tree: &mut Tree) -> Result<()> {
    tree.layout.push(path.to_owned());
    for id in sorted_names(&root.join(path))? {
        let entry = format!("{path}/{id}");
        let meta = metadata(root, &entry)?;
        if !meta.is_dir() || id == "node_modules" {
            if meta.is_dir() {
                walk_into_layout(root, &entry, tree)?;
            } else {
                add_layout(&entry, &meta, tree);
            }
            continue;
        }
        let mut package = Package {
            path: entry.clone(),
            name: id,
            entries: vec![entry.clone()],
            bytes: 0,
        };
        collect(root, &entry, None, &mut package, &mut tree.files)?;
        tree.packages.push(package);
    }
    Ok(())
}

/// Every path under `dir` (not following links), except the `skip` directory.
fn collect(
    root: &Path,
    dir: &str,
    skip: Option<&str>,
    package: &mut Package,
    files: &mut u64,
) -> Result<()> {
    for name in sorted_names(&root.join(dir))? {
        let path = format!("{dir}/{name}");
        if Some(path.as_str()) == skip {
            continue;
        }
        let meta = metadata(root, &path)?;
        package.entries.push(path.clone());
        if meta.is_dir() {
            collect(root, &path, None, package, files)?;
        } else {
            *files += 1;
            if meta.is_file() {
                package.bytes += meta.size();
            }
        }
    }
    Ok(())
}

fn walk_into_layout(root: &Path, dir: &str, tree: &mut Tree) -> Result<()> {
    tree.layout.push(dir.to_owned());
    for name in sorted_names(&root.join(dir))? {
        let path = format!("{dir}/{name}");
        let meta = metadata(root, &path)?;
        if meta.is_dir() {
            walk_into_layout(root, &path, tree)?;
        } else {
            add_layout(&path, &meta, tree);
        }
    }
    Ok(())
}

fn add_layout(path: &str, meta: &fs::Metadata, tree: &mut Tree) {
    tree.layout.push(path.to_owned());
    tree.files += 1;
    if meta.is_file() {
        tree.layout_bytes += meta.size();
    }
}

fn metadata(root: &Path, path: &str) -> Result<fs::Metadata> {
    fs::symlink_metadata(root.join(path)).map_err(Error::io(format!("reading {path}")))
}

fn sorted_names(dir: &Path) -> Result<Vec<String>> {
    let mut names: Vec<String> = fs::read_dir(dir)
        .map_err(Error::io(format!("listing {}", dir.display())))?
        .filter_map(std::result::Result::ok)
        .filter_map(|entry| entry.file_name().into_string().ok())
        .collect();
    names.sort();
    Ok(names)
}

#[cfg(test)]
mod tests {
    use std::os::unix::fs::symlink;

    use super::*;

    fn write(root: &Path, path: &str, body: &str) -> std::io::Result<()> {
        let full = root.join(path);
        if let Some(parent) = full.parent() {
            fs::create_dir_all(parent)?;
        }
        fs::write(full, body)
    }

    #[test]
    fn splits_packages_scopes_nested_trees_and_layout() -> anyhow::Result<()> {
        let dir = tempfile::tempdir()?;
        let root = dir.path();
        write(root, "node_modules/a/package.json", "{}")?;
        write(root, "node_modules/a/node_modules/b/index.js", "b")?;
        write(root, "node_modules/@s/c/package.json", "{}")?;
        write(root, "node_modules/.package-lock.json", "{}")?;
        write(root, "node_modules/.cache/babel/x", "cache")?;
        fs::create_dir_all(root.join("node_modules/.bin"))?;
        symlink("../a/index.js", root.join("node_modules/.bin/a"))?;
        let tree = scan(root)?;
        let paths: Vec<&str> = tree.packages.iter().map(|p| p.path.as_str()).collect();
        assert_eq!(
            paths,
            [
                "node_modules/@s/c",
                "node_modules/a",
                "node_modules/a/node_modules/b"
            ]
        );
        let a = &tree.packages[1];
        assert!(
            a.entries
                .iter()
                .all(|entry| !entry.contains("/node_modules/b"))
        );
        assert_eq!(tree.packages[0].name, "@s/c");
        assert!(tree.layout.contains(&"node_modules/.bin/a".to_owned()));
        assert!(tree.layout.contains(&"node_modules/@s".to_owned()));
        assert!(
            tree.layout
                .contains(&"node_modules/a/node_modules".to_owned())
        );
        assert!(tree.layout.iter().all(|path| !path.contains(".cache")));
        assert_eq!(tree.files, 5);
        Ok(())
    }

    #[test]
    fn pnpm_store_entries_are_whole_packages_and_links_are_layout() -> anyhow::Result<()> {
        let dir = tempfile::tempdir()?;
        let root = dir.path();
        write(
            root,
            "node_modules/.pnpm/a@1.0.0/node_modules/a/index.js",
            "a",
        )?;
        write(root, "node_modules/.pnpm/lock.yaml", "x")?;
        symlink(".pnpm/a@1.0.0/node_modules/a", root.join("node_modules/a"))?;
        let tree = scan(root)?;
        assert_eq!(tree.packages.len(), 1);
        assert_eq!(tree.packages[0].name, "a@1.0.0");
        assert!(tree.layout.contains(&"node_modules/a".to_owned()));
        assert!(
            tree.layout
                .contains(&"node_modules/.pnpm/lock.yaml".to_owned())
        );
        Ok(())
    }

    #[test]
    fn a_missing_tree_is_empty() -> anyhow::Result<()> {
        let dir = tempfile::tempdir()?;
        assert_eq!(scan(dir.path())?, Tree::default());
        Ok(())
    }
}
