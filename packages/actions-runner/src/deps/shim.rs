//! `npm ci` after an exact hit. `npm ci` deletes `node_modules` before installing, which would
//! throw the restored tree away. After an exact hit the restored tree is, file for file, what
//! `npm ci` builds from this lockfile (measured on fastify: `diff -r` against a fresh `npm ci`
//! finds no difference), so the restore step puts an `npm` wrapper first on PATH for the rest of
//! the job: `npm ci` (and its aliases) keeps the tree and only runs the root package's own
//! lifecycle scripts, as `npm ci` would (none with `--ignore-scripts`; the dependencies'
//! install scripts already ran when the snapshot was made). Every other `npm` command passes
//! straight through.
//!
//! `npm install` is not a substitute: on a restored tree it re-resolved part of the tree to
//! newer versions than the lockfile's (measured: 160 packages changed, 26 s), so after a partial
//! hit `npm ci` runs as itself, and the restore step skips downloading a partial snapshot for an
//! `npm ci` job, since `npm ci` would delete it.

use std::os::unix::fs::PermissionsExt;

use super::step::StepEnv;
use crate::error::{Error, Result};

const NPM_SHIM: &str = r#"#!/bin/sh
# Beanstalk dependency cache (docs/claude-opus/27): node_modules was restored, exactly as this
# lockfile installs it, into memory; `npm ci` would delete it and install the same tree again.
shim_dir=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
PATH=$(printf '%s' "$PATH" | tr ':' '\n' | grep -vxF "$shim_dir" | paste -sd: -)
export PATH
case "$1" in
  ci|clean-install|ic|install-clean|isntall-clean)
    echo "beanstalk-deps: node_modules is restored exactly for this lockfile; npm ci keeps it"
    for arg in "$@"; do
      if [ "$arg" = "--ignore-scripts" ]; then exit 0; fi
    done
    for script in preinstall install postinstall prepublish preprepare prepare postprepare; do
      npm run --if-present "$script" || exit $?
    done
    exit 0
    ;;
esac
exec npm "$@"
"#;

/// Writes the wrapper and puts its directory first on PATH for the following steps.
///
/// # Errors
///
/// [`Error::Io`] when the wrapper cannot be written.
pub fn install_npm_shim(env: &StepEnv) -> Result<()> {
    let dir = env.state_dir().join("bin");
    std::fs::create_dir_all(&dir).map_err(Error::io("creating the shim directory"))?;
    let path = dir.join("npm");
    std::fs::write(&path, NPM_SHIM).map_err(Error::io("writing the npm shim"))?;
    std::fs::set_permissions(&path, std::fs::Permissions::from_mode(0o755))
        .map_err(Error::io("making the npm shim executable"))?;
    env.add_path(&dir);
    Ok(())
}
