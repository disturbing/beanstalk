//! The structural tier: a conflict from git's line merge is retried with Mergiraf on the
//! conflicted paths, and the result is kept only when it is clean. Mergiraf is a separate binary
//! (GPL-3.0) in the image; without it on `PATH` these tests return early and say so.

#![allow(clippy::unwrap_used, clippy::expect_used)] // tests fail loudly by design

mod common;

use std::process::Command;

use axum::http::StatusCode;
use common::{Remote, TOKEN, World};
use serde_json::{Value, json};

const BASE_TS: &str = "import { a, b } from './x';\n\nexport const f = () => a + b;\n";
const ONTO_TS: &str = "import { a, b, c } from './x';\n\nexport const f = () => a + b;\n";
const CHANGE_TS: &str = "import { a, b, d } from './x';\n\nexport const f = () => a + b;\n";
const MERGED_TS: &str = "import { a, b, c, d } from './x';\n\nexport const f = () => a + b;\n";

fn has_mergiraf() -> bool {
    let available = Command::new("mergiraf")
        .arg("--version")
        .output()
        .is_ok_and(|output| output.status.success());
    if !available {
        #[allow(clippy::print_stderr)] // the only way to say why a test did nothing
        {
            eprintln!("mergiraf not found on PATH: skipping structural-tier tests");
        }
    }
    available
}

/// Both sides edit the same line of `path`: the trunk's `main` gets `onto`, the fork's
/// `refs/heads/bean` gets `change`. Returns the trunk, the fork and the trunk head.
fn same_line_edits(world: &World, path: &str, sides: [&str; 3]) -> (Remote, Remote, String) {
    let [base, onto, change] = sides;
    let trunk = world.bare("trunk");
    let fork = world.bare("fork");
    let work = world.work("w");
    let base_sha = work.commit(&[(path, base)], "base");
    let onto_sha = work.commit(&[(path, onto)], "onto");
    work.push(&trunk, "HEAD:refs/heads/main");
    work.checkout(&["-b", "bean", &base_sha]);
    work.commit(&[(path, change)], "bean");
    work.push(&fork, "HEAD:refs/heads/bean");
    (trunk, fork, onto_sha)
}

fn squash(trunk: &Remote, fork: &Remote, onto: &str) -> Value {
    json!({
        "repo": trunk.url(), "token": TOKEN, "onto": onto, "message": "Bean\n",
        "change": {"repo": fork.url(), "token": TOKEN, "ref": "refs/heads/bean"},
    })
}

#[tokio::test]
async fn a_line_conflict_mergiraf_can_solve_lands_as_structural() {
    if !has_mergiraf() {
        return;
    }
    let world = World::new().await;
    let (trunk, fork, onto) = same_line_edits(&world, "src/a.ts", [BASE_TS, ONTO_TS, CHANGE_TS]);

    let (status, body) = world
        .post("/v1/squash", &squash(&trunk, &fork, &onto))
        .await;

    assert_eq!(status, StatusCode::OK, "{body}");
    assert_eq!(body["result"], "clean", "{body}");
    assert_eq!(body["resolved"], "structural");
    assert!(body.get("hunks").is_none());
    let sha = body["sha"].as_str().unwrap();
    assert_eq!(trunk.show(sha, "src/a.ts"), MERGED_TS);
    assert_eq!(trunk.git(&["rev-parse", &format!("{sha}^@")]), onto);
}

#[tokio::test]
async fn the_tier_can_be_turned_off_and_the_conflict_carries_its_hunks() {
    let world = World::new().await;
    let (trunk, fork, onto) = same_line_edits(&world, "src/a.ts", [BASE_TS, ONTO_TS, CHANGE_TS]);
    let mut body = squash(&trunk, &fork, &onto);
    body["structural_merge"] = json!(false);

    let (status, body) = world.post("/v1/squash", &body).await;

    assert_eq!(status, StatusCode::OK, "{body}");
    assert_eq!(body["result"], "conflict");
    assert_eq!(
        body["hunks"],
        json!([{
            "path": "src/a.ts",
            "onto": "import { a, b, c } from './x';\n",
            "change": "import { a, b, d } from './x';\n",
        }])
    );
}

#[tokio::test]
async fn unsupported_files_stay_with_the_agent() {
    let world = World::new().await;
    let (trunk, fork, onto) = same_line_edits(&world, "README.md", ["a\n", "b\n", "c\n"]);

    let (_, body) = world
        .post("/v1/squash", &squash(&trunk, &fork, &onto))
        .await;

    assert_eq!(body["result"], "conflict");
    assert_eq!(body["files"], json!(["README.md"]));
}

#[tokio::test]
async fn a_conflict_mergiraf_cannot_solve_stays_textual() {
    if !has_mergiraf() {
        return;
    }
    let world = World::new().await;
    let sides = [
        "export const limit = 1;\n",
        "export const limit = 2;\n",
        "export const limit = 3;\n",
    ];
    let (trunk, fork, onto) = same_line_edits(&world, "src/limit.ts", sides);

    let (_, body) = world
        .post("/v1/squash", &squash(&trunk, &fork, &onto))
        .await;

    assert_eq!(body["result"], "conflict");
    assert_eq!(body["hunks"][0]["onto"], "export const limit = 2;\n");
    assert_eq!(body["hunks"][0]["change"], "export const limit = 3;\n");
}

#[tokio::test]
async fn a_clean_merge_is_textual() {
    let world = World::new().await;
    let (trunk, fork, onto) = same_line_edits(&world, "src/a.ts", [BASE_TS, ONTO_TS, ONTO_TS]);

    let (_, body) = world
        .post("/v1/squash", &squash(&trunk, &fork, &onto))
        .await;

    assert_eq!(body["result"], "clean");
    assert_eq!(body["resolved"], "textual");
}
