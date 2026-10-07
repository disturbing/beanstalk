//! The test files a suite command would run, found by node itself: `fs.globSync` over the
//! command's patterns, or over node's default test patterns when it names none, skipping
//! `node_modules` and sorted, as node's test runner (`createTestFileList`) does. Asking node keeps
//! glob semantics identical to the suite's, extglobs such as `test/!(listen.5).test.js` included.

use std::ffi::{OsStr, OsString};
use std::path::Path;
use std::time::Duration;

use super::suite::SuiteCommand;
use crate::error::{Error, Result};
use crate::process::{self, ChildEnv, ProcessSpec};

/// Node's default patterns (`kDefaultPattern`), with the TypeScript extensions when node strips
/// types; given patterns arrive as JSON in `argv[1]`.
const DISCOVER_SCRIPT: &str = r"
import { globSync } from 'node:fs';
const given = JSON.parse(process.argv[1]);
const extensions = ['js', 'mjs', 'cjs'];
if (process.features.typescript) extensions.push('ts', 'mts', 'cts');
const patterns = given.length > 0
  ? given
  : [`**/{test,test/**/*,test-*,*[._-]test}.{${extensions.join(',')}}`];
const skip = (entry) => (typeof entry === 'string' ? entry.split('/').pop() : entry.name) === 'node_modules';
const files = globSync(patterns, { exclude: skip });
process.stdout.write(JSON.stringify([...new Set(files)].sort()));
";
/// Globbing a checkout takes milliseconds; this bounds a pathological pattern.
const DISCOVER_TIMEOUT: Duration = Duration::from_mins(1);

/// The files `command` runs in `checkout`, relative to it and sorted.
///
/// # Errors
///
/// [`Error::Io`] when node cannot start, [`Error::Config`] when it fails or answers something
/// other than a list of relative paths.
pub(crate) async fn test_files(
    command: &SuiteCommand,
    checkout: &Path,
    env: &ChildEnv,
) -> Result<Vec<String>> {
    let patterns = serde_json::to_string(&command.patterns())
        .map_err(|error| Error::Config(format!("encoding test patterns: {error}")))?;
    let mut args: Vec<OsString> = command
        .options()
        .into_iter()
        .filter(|option| option != "--test")
        .map(OsString::from)
        .collect();
    args.extend(
        [
            "--input-type=module",
            "-e",
            DISCOVER_SCRIPT,
            "--",
            &patterns,
        ]
        .map(OsString::from),
    );
    let spec = ProcessSpec {
        program: OsStr::new(command.program()),
        args: &args,
        cwd: checkout,
        env,
        extra_env: &[],
        stdin: None,
        timeout: DISCOVER_TIMEOUT,
    };
    let finished = process::run(&spec)
        .await
        .map_err(Error::io("starting node to list the test files"))?;
    if !finished.succeeded() {
        return Err(Error::Config(format!(
            "listing the test files failed: {}",
            String::from_utf8_lossy(&finished.stderr).trim()
        )));
    }
    parse_listing(&finished.stdout)
}

fn parse_listing(stdout: &[u8]) -> Result<Vec<String>> {
    let files: Vec<String> = serde_json::from_slice(stdout)
        .map_err(|error| Error::Config(format!("node listed the test files oddly: {error}")))?;
    if let Some(odd) = files
        .iter()
        .find(|file| file.starts_with('/') || file.split('/').any(|part| part == ".."))
    {
        return Err(Error::Config(format!(
            "a test file outside the checkout: {odd:?}"
        )));
    }
    Ok(files)
}

#[cfg(test)]
mod tests {
    #![allow(clippy::unwrap_used, clippy::expect_used)] // tests fail loudly by design

    use super::*;

    #[test]
    fn a_listing_is_a_json_array_of_relative_paths() {
        assert_eq!(
            parse_listing(br#"["src/a.test.ts","test/b.test.js"]"#).unwrap(),
            ["src/a.test.ts", "test/b.test.js"]
        );
        assert!(parse_listing(br#"["/etc/passwd"]"#).is_err());
        assert!(parse_listing(br#"["../x.test.js"]"#).is_err());
        assert!(parse_listing(b"oops").is_err());
    }

    async fn listed(files: &[&str], argv: &[&str]) -> Option<Vec<String>> {
        let root = tempfile::tempdir().unwrap();
        for file in files {
            let path = root.path().join(file);
            std::fs::create_dir_all(path.parent().unwrap()).unwrap();
            std::fs::write(path, "").unwrap();
        }
        let command =
            SuiteCommand::parse(argv.iter().map(|arg| (*arg).to_owned()).collect()).unwrap();
        let found = test_files(&command, root.path(), &ChildEnv::inherit()).await;
        if matches!(found, Err(Error::Io { .. })) {
            #[allow(clippy::print_stderr)] // the only way to say why a test did nothing
            {
                eprintln!("node not found on PATH: skipping discovery");
            }
            return None;
        }
        Some(found.unwrap())
    }

    #[tokio::test]
    async fn finds_node_default_test_files_outside_node_modules() {
        let files = [
            "src/a.test.ts",
            "src/b.ts",
            "test/helper.js",
            "test-x.mjs",
            "lib/c_test.cjs",
            "node_modules/dep/d.test.js",
        ];
        let Some(found) = listed(&files, &["node", "--test"]).await else {
            return;
        };

        assert_eq!(
            found,
            [
                "lib/c_test.cjs",
                "src/a.test.ts",
                "test-x.mjs",
                "test/helper.js"
            ]
        );
    }

    #[tokio::test]
    async fn uses_the_commands_globs_extglobs_included() {
        let files = [
            "test/a.test.js",
            "test/listen.5.test.js",
            "test/sub/b.test.js",
        ];
        let argv = [
            "node",
            "--no-warnings",
            "--test",
            "test/!(listen.5).test.js",
            "test/*/**/*.test.js",
        ];
        let Some(found) = listed(&files, &argv).await else {
            return;
        };

        assert_eq!(found, ["test/a.test.js", "test/sub/b.test.js"]);
    }
}
