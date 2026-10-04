//! Properties of squash and compose, checked against real git through the HTTP API.

#![allow(clippy::unwrap_used, clippy::expect_used)] // tests fail loudly by design

mod common;

use std::sync::atomic::{AtomicUsize, Ordering};

use axum::http::StatusCode;
use common::{Remote, TOKEN, World};
use proptest::prelude::*;
use proptest::test_runner::{Config, RngSeed, TestCaseError, TestRunner};
use serde_json::{Value, json};

/// Every case runs dozens of git processes: few cases, a fixed seed, so runs are repeatable.
fn test_runner(cases: u32) -> TestRunner {
    TestRunner::new(Config {
        cases,
        rng_seed: RngSeed::Fixed(0x6265_616e_7374),
        failure_persistence: None,
        ..Config::default()
    })
}

static NEXT_CASE: AtomicUsize = AtomicUsize::new(0);

/// One file of a generated repository: who edits it (0 nobody, 1 ours, 2 theirs) and its texts.
#[derive(Debug, Clone)]
struct FileEdit {
    owner: u8,
    base: String,
    edited: String,
}

/// Files edited by at most one side, and a shared file both sides edit far apart.
#[derive(Debug, Clone)]
struct DisjointEdits {
    files: Vec<FileEdit>,
    shared_lines: Vec<String>,
    ours_line: String,
    theirs_line: String,
}

fn disjoint_edits() -> impl Strategy<Value = DisjointEdits> {
    let file = (0_u8..3, "[a-z]{1,8}( [a-z]{1,8}){0,3}", "[A-Z]{1,8}").prop_map(
        |(owner, base, edited)| FileEdit {
            owner,
            base,
            edited,
        },
    );
    let files =
        proptest::collection::vec(file, 2..6).prop_filter("both sides edit a file", |files| {
            files.iter().any(|file| file.owner == 1) && files.iter().any(|file| file.owner == 2)
        });
    (
        files,
        proptest::collection::vec("[a-z]{3,10}", 9),
        "[0-9]{3,6}",
        "[0-9]{7,9}",
    )
        .prop_map(
            |(files, shared_lines, ours_line, theirs_line)| DisjointEdits {
                files,
                shared_lines,
                ours_line,
                theirs_line,
            },
        )
}

impl DisjointEdits {
    fn base_files(&self) -> Vec<(String, String)> {
        let mut files: Vec<(String, String)> = self
            .files
            .iter()
            .enumerate()
            .map(|(index, file)| (format!("f{index}.txt"), format!("{}\n", file.base)))
            .collect();
        files.push(("shared.txt".to_owned(), self.shared(None, None)));
        files
    }

    /// One side's version: its own files edited, and its line of the shared file.
    fn side_files(&self, owner: u8) -> Vec<(String, String)> {
        let mut files: Vec<(String, String)> = self
            .files
            .iter()
            .enumerate()
            .filter(|(_, file)| file.owner == owner)
            .map(|(index, file)| (format!("f{index}.txt"), format!("{}\n", file.edited)))
            .collect();
        let shared = if owner == 1 {
            self.shared(Some(&self.ours_line), None)
        } else {
            self.shared(None, Some(&self.theirs_line))
        };
        files.push(("shared.txt".to_owned(), shared));
        files
    }

    /// The shared file with line 1 and line 7 optionally replaced: hunks five lines apart.
    fn shared(&self, line_1: Option<&str>, line_7: Option<&str>) -> String {
        let mut lines = self.shared_lines.clone();
        if let Some(text) = line_1 {
            text.clone_into(&mut lines[1]);
        }
        if let Some(text) = line_7 {
            text.clone_into(&mut lines[7]);
        }
        lines.join("\n") + "\n"
    }

    fn expected(&self, index: usize) -> String {
        let file = &self.files[index];
        let text = if file.owner == 0 {
            &file.base
        } else {
            &file.edited
        };
        format!("{text}\n")
    }
}

/// A trunk with `base` on main, and a fork with branches `ours` and `theirs` made from it.
struct Repositories {
    trunk: Remote,
    fork: Remote,
    base: String,
}

/// The files of the base commit and of each side's commit on top of it.
struct Sides<'a> {
    base: &'a [(&'a str, &'a str)],
    ours: &'a [(&'a str, &'a str)],
    theirs: &'a [(&'a str, &'a str)],
}

fn repositories(world: &World, sides: &Sides<'_>) -> Repositories {
    let case = NEXT_CASE.fetch_add(1, Ordering::Relaxed);
    let (trunk, fork, work) = (
        world.bare(&format!("trunk-{case}")),
        world.bare(&format!("fork-{case}")),
        world.work(&format!("work-{case}")),
    );
    let base = work.commit(sides.base, "base");
    work.push(&trunk, "HEAD:refs/heads/main");
    work.commit(sides.ours, "ours");
    work.push(&fork, "HEAD:refs/heads/ours");
    work.checkout(&["--detach", &base]);
    work.commit(sides.theirs, "theirs");
    work.push(&fork, "HEAD:refs/heads/theirs");
    Repositories { trunk, fork, base }
}

fn borrowed(files: &[(String, String)]) -> Vec<(&str, &str)> {
    files
        .iter()
        .map(|(path, text)| (path.as_str(), text.as_str()))
        .collect()
}

fn squash_body(trunk: &Remote, fork: &Remote, onto: &str, branch: &str) -> Value {
    json!({
        "repo": trunk.url(), "token": TOKEN, "onto": onto, "message": format!("{branch}\n"),
        "change": {"repo": fork.url(), "token": TOKEN, "ref": format!("refs/heads/{branch}")},
    })
}

async fn squash(world: &World, body: &Value) -> Result<Value, TestCaseError> {
    let (status, response) = world.post("/v1/squash", body).await;
    prop_assert_eq!(status, StatusCode::OK, "{}", response);
    Ok(response)
}

async fn disjoint_edits_land_cleanly(
    world: &World,
    edits: &DisjointEdits,
) -> Result<(), TestCaseError> {
    let (base_files, ours, theirs) = (edits.base_files(), edits.side_files(1), edits.side_files(2));
    let sides = Sides {
        base: &borrowed(&base_files),
        ours: &borrowed(&ours),
        theirs: &borrowed(&theirs),
    };
    let Repositories { trunk, fork, base } = repositories(world, &sides);

    let ours = squash(world, &squash_body(&trunk, &fork, &base, "ours")).await?;
    let ours_sha = ours["sha"].as_str().unwrap_or_default().to_owned();
    let theirs = squash(world, &squash_body(&trunk, &fork, &ours_sha, "theirs")).await?;

    prop_assert_eq!(&theirs["result"], "clean", "{}", theirs);
    let head = theirs["sha"].as_str().unwrap_or_default();
    for index in 0..edits.files.len() {
        prop_assert_eq!(
            trunk.show(head, &format!("f{index}.txt")),
            edits.expected(index)
        );
    }
    let shared = edits.shared(Some(&edits.ours_line), Some(&edits.theirs_line));
    prop_assert_eq!(trunk.show(head, "shared.txt"), shared);
    let items = json!([
        {"repo": fork.url(), "token": TOKEN, "ref": "refs/heads/ours", "task": "ours"},
        {"repo": fork.url(), "token": TOKEN, "ref": "refs/heads/theirs", "task": "theirs"},
    ]);
    let (_, composed) = world
        .post(
            "/v1/compose",
            &json!({"repo": trunk.url(), "token": TOKEN, "base": base, "items": items}),
        )
        .await;
    let composed_head = composed["head"].as_str().unwrap_or_default();
    prop_assert_eq!(
        trunk.git(&["rev-parse", &format!("{composed_head}^{{tree}}")]),
        trunk.git(&["rev-parse", &format!("{head}^{{tree}}")])
    );
    Ok(())
}

#[test]
fn squash_of_disjoint_edits_is_clean_and_keeps_both_sides() {
    let runtime = tokio::runtime::Runtime::new().unwrap();
    let world = runtime.block_on(World::new());

    let result = test_runner(6).run(&disjoint_edits(), |edits| {
        runtime.block_on(disjoint_edits_land_cleanly(&world, &edits))
    });

    result.unwrap();
}

const CHANGELOG: &str =
    "# Changelog\n\n## Unreleased\n\n### Added\n\n- Base entry.\n\n## 0.1.0\n\n- Old entry.\n";

fn changelog_with(entry: &str) -> String {
    CHANGELOG.replace("- Base entry.\n", &format!("- Base entry.\n- {entry}\n"))
}

async fn changelog_entries_survive(
    world: &World,
    ours: &str,
    theirs: &str,
) -> Result<(), TestCaseError> {
    let (ours_log, theirs_log) = (changelog_with(ours), changelog_with(theirs));
    let sides = Sides {
        base: &[("CHANGELOG.md", CHANGELOG)],
        ours: &[("CHANGELOG.md", &ours_log)],
        theirs: &[("CHANGELOG.md", &theirs_log)],
    };
    let Repositories { trunk, fork, base } = repositories(world, &sides);
    let first = squash(world, &squash_body(&trunk, &fork, &base, "ours")).await?;
    let first_sha = first["sha"].as_str().unwrap_or_default().to_owned();
    let plain = squash_body(&trunk, &fork, &first_sha, "theirs");
    let mut union = plain.clone();
    union["union_paths"] = json!(["CHANGELOG.md"]);

    let without = squash(world, &plain).await?;
    let with = squash(world, &union).await?;

    prop_assert_eq!(&without["files"], &json!(["CHANGELOG.md"]), "{}", without);
    prop_assert_eq!(&with["result"], "clean", "{}", with);
    let changelog = trunk.show(with["sha"].as_str().unwrap_or_default(), "CHANGELOG.md");
    prop_assert!(
        changelog.contains(&format!("- Base entry.\n- {ours}\n- {theirs}\n")),
        "{}",
        changelog
    );
    prop_assert_eq!(changelog.matches(ours).count(), 1);
    Ok(())
}

#[test]
fn union_merge_keeps_every_changelog_entry() {
    let runtime = tokio::runtime::Runtime::new().unwrap();
    let world = runtime.block_on(World::new());
    let entries = (
        "[A-Z][a-z]{2,12}( [a-z]{2,8}){0,4}\\.",
        "[A-Z][a-z]{2,12}( [a-z]{2,8}){0,4}!",
    )
        .prop_filter("different entries", |(ours, theirs)| {
            !ours.contains(theirs.as_str()) && !theirs.contains(ours.as_str())
        });

    let result = test_runner(4).run(&entries, |(ours, theirs)| {
        runtime.block_on(changelog_entries_survive(&world, &ours, &theirs))
    });

    result.unwrap();
}
