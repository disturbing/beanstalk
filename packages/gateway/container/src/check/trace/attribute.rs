//! Which traced paths belong to the repo: absolute paths become checkout-relative, everything
//! outside the checkout is dropped (system libraries, node itself, `/tmp`), and installed
//! dependencies collapse to their package.
//!
//! **Dependencies.** A `node_modules` tree is not in git, so a test's reads inside it are never
//! compared file by file: what matters is *that* the test loads a package (a lockfile or
//! `package.json` change can change every installed file) and which one. A path below
//! `<dir>/node_modules/<pkg>` (or `@scope/pkg`) becomes the package `<dir>/node_modules/<pkg>`
//! inside the checkout, or `node_modules/<pkg>` for a snapshot linked above it. A failed lookup
//! of `node_modules/<pkg>` itself stays a probe inside the checkout: a bean that adds a nearer
//! `node_modules/<pkg>` shadows the installed one, and the probe is the evidence.

use std::collections::BTreeSet;

use super::parse::Accesses;

const NODE_MODULES: &str = "node_modules";

/// A test file's accesses relative to the checkout.
#[derive(Debug, Clone, Default, PartialEq, Eq)]
pub(crate) struct RepoAccesses {
    pub(crate) reads: BTreeSet<String>,
    pub(crate) probes: BTreeSet<String>,
    pub(crate) dirs: BTreeSet<String>,
    /// Installed packages the test loaded (`node_modules/<pkg>`, or a nested `node_modules`
    /// inside the checkout as `<dir>/node_modules/<pkg>`).
    pub(crate) packages: BTreeSet<String>,
}

/// Where the checkout lives: as the test saw it and through symlinks resolved.
#[derive(Debug, Clone)]
pub(crate) struct CheckoutRoots {
    roots: Vec<String>,
}

impl CheckoutRoots {
    /// `written` is the checkout path the runner created, `real` its `realpath`.
    pub(crate) fn new(written: &str, real: &str) -> Self {
        let mut roots = vec![trim_slash(written)];
        if trim_slash(real) != roots[0] {
            roots.push(trim_slash(real));
        }
        Self { roots }
    }

    /// `path` relative to the checkout; `None` outside it or for the checkout itself.
    fn relative<'p>(&self, path: &'p str) -> Option<&'p str> {
        self.roots.iter().find_map(|root| {
            path.strip_prefix(root.as_str())
                .and_then(|rest| rest.strip_prefix('/'))
                .filter(|rest| !rest.is_empty())
        })
    }
}

fn trim_slash(path: &str) -> String {
    let trimmed = path.trim_end_matches('/');
    if trimmed.is_empty() {
        "/".to_owned()
    } else {
        trimmed.to_owned()
    }
}

/// Keeps the repo's paths of `accesses`, relative to `roots`.
#[must_use]
pub(crate) fn attribute(accesses: &Accesses, roots: &CheckoutRoots) -> RepoAccesses {
    let mut repo = RepoAccesses::default();
    for path in &accesses.reads {
        place(&mut repo, roots, path, Slot::Read);
    }
    for path in &accesses.dirs {
        place(&mut repo, roots, path, Slot::Dir);
    }
    for path in &accesses.probes {
        place(&mut repo, roots, path, Slot::Probe);
    }
    repo
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum Slot {
    Read,
    Probe,
    Dir,
}

fn place(repo: &mut RepoAccesses, roots: &CheckoutRoots, path: &str, slot: Slot) {
    let relative = roots.relative(path);
    if let Some(package) = package_of(relative.unwrap_or(path), relative.is_some(), slot) {
        repo.packages.insert(package);
        return;
    }
    let Some(relative) = relative else {
        return;
    };
    let set = match slot {
        Slot::Read => &mut repo.reads,
        Slot::Probe => &mut repo.probes,
        Slot::Dir => &mut repo.dirs,
    };
    set.insert(relative.to_owned());
}

/// The package a path belongs to, when it lies inside an installed package (or is the
/// package's own directory, found). A probe of the package directory itself, or of a
/// `node_modules` directory, is not a package: it is a negative dependency.
fn package_of(path: &str, inside_checkout: bool, slot: Slot) -> Option<String> {
    let parts: Vec<&str> = path.split('/').collect();
    let at = parts.iter().position(|part| *part == NODE_MODULES)?;
    let name_len = match parts.get(at + 1) {
        Some(scope) if scope.starts_with('@') => 2,
        Some(_) => 1,
        None => return None,
    };
    let package_end = at + 1 + name_len;
    if parts.len() < package_end {
        return None;
    }
    let is_package_dir = parts.len() == package_end;
    if is_package_dir && slot == Slot::Probe {
        return None;
    }
    if !inside_checkout && slot == Slot::Probe {
        // A miss inside an installed package outside the repo: the snapshot is fixed per image,
        // so it only matters as a sign the test loads the package.
        return Some(parts[at..package_end].join("/"));
    }
    let start = if inside_checkout { 0 } else { at };
    Some(parts[start..package_end].join("/"))
}

#[cfg(test)]
mod tests {
    use super::*;

    fn accesses(reads: &[&str], probes: &[&str], dirs: &[&str]) -> Accesses {
        let set = |paths: &[&str]| paths.iter().map(|path| (*path).to_owned()).collect();
        Accesses {
            reads: set(reads),
            probes: set(probes),
            dirs: set(dirs),
        }
    }

    fn roots() -> CheckoutRoots {
        CheckoutRoots::new("/work/jobs/3/checkout", "/data/jobs/3/checkout")
    }

    fn strings(paths: &[&str]) -> BTreeSet<String> {
        paths.iter().map(|path| (*path).to_owned()).collect()
    }

    #[test]
    fn keeps_checkout_paths_relative_and_drops_the_rest() {
        let traced = accesses(
            &[
                "/work/jobs/3/checkout/src/a.ts",
                "/data/jobs/3/checkout/src/b.ts",
                "/usr/local/bin/node",
                "/work/jobs/3/checkout",
            ],
            &[
                "/work/jobs/3/checkout/src/package.json",
                "/etc/ssl/openssl.cnf",
            ],
            &["/work/jobs/3/checkout/src"],
        );

        let repo = attribute(&traced, &roots());

        assert_eq!(repo.reads, strings(&["src/a.ts", "src/b.ts"]));
        assert_eq!(repo.probes, strings(&["src/package.json"]));
        assert_eq!(repo.dirs, strings(&["src"]));
        assert!(repo.packages.is_empty());
    }

    #[test]
    fn a_sibling_directory_with_the_same_prefix_is_outside() {
        let traced = accesses(&["/work/jobs/3/checkout-old/src/a.ts"], &[], &[]);

        assert_eq!(attribute(&traced, &roots()), RepoAccesses::default());
    }

    #[test]
    fn installed_files_collapse_to_their_package() {
        let traced = accesses(
            &[
                "/work/jobs/3/node_modules/fastify-plugin/lib/index.js",
                "/work/jobs/3/node_modules/@fastify/ajv-compiler/index.js",
                "/work/jobs/3/checkout/node_modules/pino/package.json",
                "/work/jobs/3/checkout/src/node_modules/@shop/utils/x.js",
            ],
            &["/work/jobs/3/node_modules/fastify-plugin/lib/missing.json"],
            &["/work/jobs/3/node_modules/fastify-plugin/lib"],
        );

        let repo = attribute(&traced, &roots());

        assert_eq!(
            repo.packages,
            strings(&[
                "node_modules/@fastify/ajv-compiler",
                "node_modules/fastify-plugin",
                "node_modules/pino",
                "src/node_modules/@shop/utils",
            ])
        );
        assert!(repo.reads.is_empty() && repo.probes.is_empty() && repo.dirs.is_empty());
    }

    #[test]
    fn a_missed_lookup_of_a_package_directory_stays_a_probe() {
        let traced = accesses(
            &[],
            &[
                "/work/jobs/3/checkout/test/node_modules/fastify-plugin",
                "/work/jobs/3/checkout/node_modules",
                "/work/jobs/3/node_modules/absent",
            ],
            &[],
        );

        let repo = attribute(&traced, &roots());

        assert_eq!(
            repo.probes,
            strings(&["node_modules", "test/node_modules/fastify-plugin"])
        );
        assert!(repo.packages.is_empty());
    }

    #[test]
    fn listing_a_node_modules_directory_is_a_listing() {
        let traced = accesses(&[], &[], &["/work/jobs/3/checkout/node_modules"]);

        assert_eq!(
            attribute(&traced, &roots()).dirs,
            strings(&["node_modules"])
        );
    }
}
