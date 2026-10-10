//! `/v1/update-ref` through the HTTP API: leases, creation, idempotent retries, and candidates
//! found by a second runner.

#![allow(clippy::unwrap_used, clippy::expect_used)] // tests fail loudly by design

mod common;

use axum::http::StatusCode;
use common::{ARENA_BASE, Remote, TOKEN, World, arena_pair, change, squash_body};
use serde_json::{Value, json};

const NULL_SHA: &str = "0000000000000000000000000000000000000000";

fn update_ref_body(trunk: &Remote, new: &str, old: &Value) -> Value {
    json!({"repo": trunk.url(), "token": TOKEN, "ref": "refs/heads/trunk", "new": new, "old": old})
}

/// A trunk whose `refs/heads/trunk` is the arena base, and t001 squashed onto it as a candidate.
async fn trunk_with_candidate(world: &World) -> (Remote, String) {
    let (trunk, fork) = arena_pair(world);
    trunk.git(&["update-ref", "refs/heads/trunk", ARENA_BASE]);
    let (_, body) = world
        .post(
            "/v1/squash",
            &squash_body(&trunk, ARENA_BASE, &change(&fork, "t001")),
        )
        .await;
    (trunk, body["sha"].as_str().unwrap().to_owned())
}

#[tokio::test]
async fn update_ref_moves_the_ref_when_the_lease_holds() {
    let world = World::new().await;
    let (trunk, candidate) = trunk_with_candidate(&world).await;

    let (status, body) = world
        .post(
            "/v1/update-ref",
            &update_ref_body(&trunk, &candidate, &json!(ARENA_BASE)),
        )
        .await;

    assert_eq!(status, StatusCode::OK, "{body}");
    assert_eq!(body, json!({"ok": true, "actual": candidate}));
    assert_eq!(trunk.ref_sha("refs/heads/trunk"), Some(candidate));
}

#[tokio::test]
async fn update_ref_reports_the_actual_value_when_the_lease_is_stale() {
    let world = World::new().await;
    let (trunk, candidate) = trunk_with_candidate(&world).await;
    let stale = trunk.git(&["rev-parse", "refs/heads/main"]);
    trunk.git(&["update-ref", "refs/heads/trunk", &candidate]);

    let (status, body) = world
        .post(
            "/v1/update-ref",
            &update_ref_body(&trunk, ARENA_BASE, &json!(stale)),
        )
        .await;

    assert_eq!(status, StatusCode::OK);
    assert_eq!(body, json!({"ok": false, "actual": candidate}));
    assert_eq!(trunk.ref_sha("refs/heads/trunk"), Some(candidate));
}

#[tokio::test]
async fn update_ref_with_the_null_sha_creates_only() {
    let world = World::new().await;
    let (trunk, candidate) = trunk_with_candidate(&world).await;
    let mut create = update_ref_body(&trunk, &candidate, &json!(NULL_SHA));
    create["ref"] = json!("refs/heads/green");
    let mut overwrite = update_ref_body(&trunk, ARENA_BASE, &json!(NULL_SHA));
    overwrite["ref"] = json!("refs/heads/green");

    let (_, created) = world.post("/v1/update-ref", &create).await;
    let (_, refused) = world.post("/v1/update-ref", &overwrite).await;

    assert_eq!(created, json!({"ok": true, "actual": candidate}));
    assert_eq!(refused, json!({"ok": false, "actual": candidate}));
}

#[tokio::test]
async fn update_ref_is_idempotent_once_the_ref_points_at_new() {
    let world = World::new().await;
    let (trunk, candidate) = trunk_with_candidate(&world).await;
    let body = update_ref_body(&trunk, &candidate, &json!(ARENA_BASE));

    let (_, first) = world.post("/v1/update-ref", &body).await;
    let (_, retry) = world.post("/v1/update-ref", &body).await;

    assert_eq!(first, json!({"ok": true, "actual": candidate}));
    assert_eq!(retry, json!({"ok": true, "actual": candidate}));
}

#[tokio::test]
async fn update_ref_without_old_moves_unconditionally() {
    let world = World::new().await;
    let (trunk, candidate) = trunk_with_candidate(&world).await;

    let (_, body) = world
        .post(
            "/v1/update-ref",
            &update_ref_body(&trunk, &candidate, &Value::Null),
        )
        .await;

    assert_eq!(body["ok"], true);
    assert_eq!(trunk.ref_sha("refs/heads/trunk"), Some(candidate));
}

#[tokio::test]
async fn a_second_runner_finds_candidates_by_name() {
    let world = World::new().await;
    let (trunk, candidate) = trunk_with_candidate(&world).await;
    let other = world.second_runner().await;

    let (status, body) = common::post(
        &other,
        "/v1/update-ref",
        &update_ref_body(&trunk, &candidate, &json!(ARENA_BASE)),
    )
    .await;

    assert_eq!(status, StatusCode::OK, "{body}");
    assert_eq!(body["ok"], true);
}

#[tokio::test]
async fn update_ref_of_an_unknown_commit_is_refused() {
    let world = World::new().await;
    let (trunk, _) = arena_pair(&world);

    let (status, body) = world
        .post(
            "/v1/update-ref",
            &update_ref_body(&trunk, &"e".repeat(40), &Value::Null),
        )
        .await;

    assert_eq!(status, StatusCode::UNPROCESSABLE_ENTITY);
    assert_eq!(body["code"], "unknown_commit");
}
