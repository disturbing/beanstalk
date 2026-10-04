//! Squash, compose and revert through the HTTP API against local bare repositories. Expected
//! values on arena tasks are what the harness's `Git.squash_onto` returns on the same commits.

#![allow(clippy::unwrap_used, clippy::expect_used)] // tests fail loudly by design

mod common;

use std::os::unix::fs::PermissionsExt;

use axum::http::StatusCode;
use common::{ARENA_BASE, Remote, TOKEN, World, arena_pair, change, squash_body};
use serde_json::{Value, json};

const UNION_PATHS: [&str; 3] = ["CHANGELOG.md", "CHANGELOG*.md", "**/CHANGELOG.md"];

fn strings(value: &Value) -> Vec<&str> {
    value
        .as_array()
        .unwrap()
        .iter()
        .map(|item| item.as_str().unwrap())
        .collect()
}

#[tokio::test]
async fn squash_lands_a_clean_change_as_one_commit_on_the_target() {
    let world = World::new().await;
    let (trunk, fork) = arena_pair(&world);
    let mut source = change(&fork, "t001");
    source["base"] = json!(ARENA_BASE);

    let (status, body) = world
        .post("/v1/squash", &squash_body(&trunk, ARENA_BASE, &source))
        .await;

    assert_eq!(status, StatusCode::OK, "{body}");
    assert_eq!(body["result"], "clean");
    assert_eq!(
        strings(&body["files"]),
        [
            "src/billing/coupon-limits.test.ts",
            "src/billing/service.ts"
        ]
    );
    assert_eq!(body["change_files"], body["files"]);
    assert_eq!(body["merge_base"], ARENA_BASE);
    assert_eq!(
        body["change_head"].as_str(),
        fork.ref_sha("refs/heads/ref/t001").as_deref()
    );
    let sha = body["sha"].as_str().unwrap();
    assert_eq!(
        trunk
            .ref_sha(&format!("refs/beanstalk/candidates/{sha}"))
            .as_deref(),
        Some(sha)
    );
    assert_eq!(trunk.git(&["rev-parse", &format!("{sha}^@")]), ARENA_BASE);
    assert_eq!(
        trunk.git(&["log", "-1", "--format=%B", sha]),
        "Squash\n\nTask: test"
    );
}

#[tokio::test]
async fn concurrent_identical_squashes_all_succeed() {
    // Identical requests within one second build the same commit, so they race to create the
    // same candidate ref; the losers must still report the clean result. The hook makes the
    // trunk slow to apply a push, as a remote under load is, so that the pushes overlap.
    let world = World::new().await;
    let (trunk, fork) = arena_pair(&world);
    let hook = trunk.dir.join("hooks/pre-receive");
    std::fs::write(&hook, "#!/bin/sh\nsleep 0.2\n").unwrap();
    std::fs::set_permissions(&hook, std::fs::Permissions::from_mode(0o755)).unwrap();
    let body = squash_body(&trunk, ARENA_BASE, &change(&fork, "t001"));

    let responses = tokio::join!(
        world.post("/v1/squash", &body),
        world.post("/v1/squash", &body),
        world.post("/v1/squash", &body),
        world.post("/v1/squash", &body),
        world.post("/v1/squash", &body),
        world.post("/v1/squash", &body),
    );

    let responses = [
        responses.0,
        responses.1,
        responses.2,
        responses.3,
        responses.4,
        responses.5,
    ];
    for (status, body) in &responses {
        assert_eq!(*status, StatusCode::OK, "{body}");
        assert_eq!(body["result"], "clean");
        let sha = body["sha"].as_str().unwrap();
        assert_eq!(
            trunk
                .ref_sha(&format!("refs/beanstalk/candidates/{sha}"))
                .as_deref(),
            Some(sha)
        );
    }
}

#[tokio::test]
async fn squash_reports_conflicting_files_and_commits_nothing() {
    let world = World::new().await;
    let (trunk, fork) = arena_pair(&world);
    let t001 = fork.ref_sha("refs/heads/ref/t001").unwrap();
    fork.git(&[
        "push",
        "--quiet",
        &trunk.url(),
        "refs/heads/ref/t001:refs/heads/trunk",
    ]);

    let (status, body) = world
        .post(
            "/v1/squash",
            &squash_body(&trunk, &t001, &change(&fork, "t040")),
        )
        .await;

    assert_eq!(status, StatusCode::OK, "{body}");
    assert_eq!(
        body,
        json!({
            "result": "conflict", "files": ["src/billing/service.ts"],
            "change_head": fork.ref_sha("refs/heads/ref/t040"), "merge_base": ARENA_BASE,
        })
    );
    assert_eq!(
        trunk.git(&["for-each-ref", "refs/beanstalk/candidates"]),
        ""
    );
}

#[tokio::test]
async fn union_paths_dissolve_changelog_conflicts() {
    let world = World::new().await;
    let (trunk, fork) = arena_pair(&world);
    let t002 = fork.ref_sha("refs/heads/ref/t002").unwrap();
    fork.git(&[
        "push",
        "--quiet",
        &trunk.url(),
        "refs/heads/ref/t002:refs/heads/trunk",
    ]);
    let plain = squash_body(&trunk, &t002, &change(&fork, "t005"));
    let mut union = plain.clone();
    union["union_paths"] = json!(UNION_PATHS);

    let (_, without) = world.post("/v1/squash", &plain).await;
    let (_, with) = world.post("/v1/squash", &union).await;

    assert_eq!(without["result"], "conflict");
    assert_eq!(strings(&without["files"]), ["CHANGELOG.md"]);
    assert_eq!(with["result"], "clean", "{with}");
    assert_eq!(
        strings(&with["files"]),
        [
            "CHANGELOG.md",
            "src/lib/money-format.test.ts",
            "src/lib/money.ts",
            "src/orders/confirmation-grouping.test.ts"
        ]
    );
    let changelog = trunk.show(with["sha"].as_str().unwrap(), "CHANGELOG.md");
    let expected = "- Product search ignores letter case.\n\
                    - Product and order lists send an `x-total-count` header.\n\
                    - Amounts of 1,000 or more are shown with thousands separators.\n";
    assert!(changelog.contains(expected), "{changelog}");
}

#[tokio::test]
async fn compose_stacks_clean_items_and_skips_a_conflict() {
    let world = World::new().await;
    let (trunk, fork) = arena_pair(&world);
    let items: Vec<Value> = ["t001", "t040", "t005"]
        .iter()
        .map(|task| {
            let mut item = change(&fork, task);
            item["task"] = json!(task);
            item
        })
        .collect();
    let body = json!({"repo": trunk.url(), "token": TOKEN, "base": ARENA_BASE, "items": items});

    let (status, body) = world.post("/v1/compose", &body).await;

    assert_eq!(status, StatusCode::OK, "{body}");
    let per_item = body["per_item"].as_array().unwrap();
    let results: Vec<(&str, &str)> = per_item
        .iter()
        .map(|item| {
            (
                item["task"].as_str().unwrap(),
                item["result"].as_str().unwrap(),
            )
        })
        .collect();
    assert_eq!(
        results,
        [("t001", "clean"), ("t040", "conflict"), ("t005", "clean")]
    );
    assert_eq!(strings(&per_item[1]["files"]), ["src/billing/service.ts"]);
    assert_eq!(
        strings(&per_item[2]["files"]),
        [
            "CHANGELOG.md",
            "src/lib/money-format.test.ts",
            "src/lib/money.ts",
            "src/orders/confirmation-grouping.test.ts"
        ]
    );
    let (first, head) = (
        per_item[0]["sha"].as_str().unwrap(),
        body["head"].as_str().unwrap(),
    );
    assert_eq!(per_item[2]["sha"].as_str(), Some(head));
    assert_eq!(trunk.git(&["rev-parse", &format!("{head}^")]), first);
    assert_eq!(trunk.git(&["rev-parse", &format!("{first}^")]), ARENA_BASE);
    assert!(
        trunk
            .ref_sha(&format!("refs/beanstalk/candidates/{first}"))
            .is_some()
    );
    assert!(
        trunk
            .ref_sha(&format!("refs/beanstalk/candidates/{head}"))
            .is_some()
    );
    assert_eq!(
        trunk.show(head, "CHANGELOG.md"),
        trunk.show(
            fork.ref_sha("refs/heads/ref/t005").unwrap().as_str(),
            "CHANGELOG.md"
        )
    );
}

#[tokio::test]
async fn compose_of_only_conflicts_keeps_the_base_as_head() {
    let world = World::new().await;
    let (trunk, fork) = arena_pair(&world);
    let t001 = fork.ref_sha("refs/heads/ref/t001").unwrap();
    fork.git(&[
        "push",
        "--quiet",
        &trunk.url(),
        "refs/heads/ref/t001:refs/heads/trunk",
    ]);
    let mut item = change(&fork, "t040");
    item["task"] = json!("t040");

    let (_, body) = world
        .post(
            "/v1/compose",
            &json!({"repo": trunk.url(), "token": TOKEN, "base": t001, "items": [item]}),
        )
        .await;

    assert_eq!(body["head"].as_str(), Some(t001.as_str()));
    assert_eq!(body["per_item"][0]["result"], "conflict");
}

/// Lands t001 then t005 on the trunk and returns (t001's squash, t005's squash).
async fn land_two(world: &World, trunk: &Remote, fork: &Remote) -> (String, String) {
    let (_, first) = world
        .post(
            "/v1/squash",
            &squash_body(trunk, ARENA_BASE, &change(fork, "t001")),
        )
        .await;
    let first = first["sha"].as_str().unwrap().to_owned();
    let (_, second) = world
        .post(
            "/v1/squash",
            &squash_body(trunk, &first, &change(fork, "t005")),
        )
        .await;
    (first, second["sha"].as_str().unwrap().to_owned())
}

#[tokio::test]
async fn revert_removes_a_landed_change_from_the_head() {
    let world = World::new().await;
    let (trunk, fork) = arena_pair(&world);
    let (first, second) = land_two(&world, &trunk, &fork).await;
    let body = json!({
        "repo": trunk.url(), "token": TOKEN, "onto": second, "commit": first,
        "message": "Revert t001\n",
    });

    let (status, body) = world.post("/v1/revert", &body).await;

    assert_eq!(status, StatusCode::OK, "{body}");
    assert_eq!(body["result"], "clean");
    assert_eq!(
        strings(&body["files"]),
        [
            "src/billing/coupon-limits.test.ts",
            "src/billing/service.ts"
        ]
    );
    let sha = body["sha"].as_str().unwrap();
    assert_eq!(trunk.git(&["rev-parse", &format!("{sha}^")]), second);
    assert_eq!(
        trunk.show(sha, "src/billing/service.ts"),
        trunk.show(ARENA_BASE, "src/billing/service.ts")
    );
    assert_eq!(
        trunk.show(sha, "src/lib/money.ts"),
        trunk.show(&second, "src/lib/money.ts")
    );
    assert!(
        trunk
            .ref_sha(&format!("refs/beanstalk/candidates/{sha}"))
            .is_some()
    );
}

#[tokio::test]
async fn revert_reports_conflicting_files() {
    let world = World::new().await;
    let trunk = world.bare("trunk");
    let work = world.work("w");
    work.commit(&[("f.txt", "a\n")], "base");
    let changed = work.commit(&[("f.txt", "b\n")], "change");
    let rewritten = work.commit(&[("f.txt", "c\n")], "rewrite");
    work.push(&trunk, "HEAD:refs/heads/main");

    let (_, body) = world
        .post("/v1/revert", &json!({
            "repo": trunk.url(), "token": TOKEN, "onto": rewritten, "commit": changed, "message": "Revert\n",
        }))
        .await;

    assert_eq!(body, json!({"result": "conflict", "files": ["f.txt"]}));
}

#[tokio::test]
async fn revert_of_a_root_commit_is_refused() {
    let world = World::new().await;
    let (trunk, _) = arena_pair(&world);

    let (status, body) = world
        .post("/v1/revert", &json!({
            "repo": trunk.url(), "token": TOKEN, "onto": ARENA_BASE, "commit": ARENA_BASE, "message": "x",
        }))
        .await;

    assert_eq!(status, StatusCode::UNPROCESSABLE_ENTITY);
    assert_eq!(body["code"], "root_commit");
}

#[tokio::test]
async fn commits_reachable_only_by_sha_are_never_fetched() {
    let world = World::new().await;
    let (trunk, fork) = arena_pair(&world);
    let hidden = fork.ref_sha("refs/heads/ref/t001").unwrap();
    fork.git(&[
        "push",
        "--quiet",
        &trunk.url(),
        "refs/heads/ref/t001:refs/heads/tmp",
    ]);
    trunk.git(&["update-ref", "-d", "refs/heads/tmp"]);

    let (status, body) = world
        .post(
            "/v1/squash",
            &squash_body(&trunk, &hidden, &change(&fork, "t005")),
        )
        .await;

    assert_eq!(status, StatusCode::UNPROCESSABLE_ENTITY, "{body}");
    assert_eq!(body["code"], "unknown_commit");
}

#[tokio::test]
async fn squash_of_a_missing_change_ref_is_unprocessable() {
    let world = World::new().await;
    let (trunk, fork) = arena_pair(&world);

    let (status, body) = world
        .post(
            "/v1/squash",
            &squash_body(&trunk, ARENA_BASE, &change(&fork, "t999")),
        )
        .await;

    assert_eq!(status, StatusCode::UNPROCESSABLE_ENTITY);
    assert_eq!(body["code"], "unknown_ref");
}

#[tokio::test]
async fn an_unreachable_remote_is_a_bad_gateway_without_the_token() {
    let world = World::new().await;
    let (_, fork) = arena_pair(&world);
    let missing = Remote {
        dir: fork.dir.with_file_name("missing.git"),
    };

    let (status, body) = world
        .post(
            "/v1/squash",
            &squash_body(&missing, ARENA_BASE, &change(&fork, "t001")),
        )
        .await;

    assert_eq!(status, StatusCode::BAD_GATEWAY, "{body}");
    assert_eq!(body["code"], "remote_failed");
}

#[tokio::test]
async fn malformed_requests_name_the_field() {
    let world = World::new().await;
    let (trunk, fork) = arena_pair(&world);

    let (status, body) = world
        .post(
            "/v1/squash",
            &squash_body(&trunk, "abc123", &change(&fork, "t001")),
        )
        .await;

    assert_eq!(status, StatusCode::BAD_REQUEST);
    assert_eq!(body["code"], "invalid_request");
    assert!(body["message"].as_str().unwrap().contains("onto"), "{body}");
}

#[tokio::test]
async fn unknown_fields_are_refused() {
    let world = World::new().await;
    let (trunk, fork) = arena_pair(&world);
    let mut body = squash_body(&trunk, ARENA_BASE, &change(&fork, "t001"));
    body["strategy"] = json!("ours");

    let (status, _) = world.post("/v1/squash", &body).await;

    assert_eq!(status, StatusCode::BAD_REQUEST);
}

#[tokio::test]
async fn file_remotes_are_refused_in_production_config() {
    let world = World::https_only().await;
    let (trunk, fork) = arena_pair(&world);

    let (status, body) = world
        .post(
            "/v1/squash",
            &squash_body(&trunk, ARENA_BASE, &change(&fork, "t001")),
        )
        .await;

    assert_eq!(status, StatusCode::BAD_REQUEST);
    assert!(
        body["message"].as_str().unwrap().contains("scheme"),
        "{body}"
    );
}
