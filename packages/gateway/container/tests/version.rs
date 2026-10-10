//! The wire contract's version: `/version` reports it and every response carries it as a header,
//! so a gateway built for another contract can say so instead of dropping work.

#![allow(clippy::unwrap_used, clippy::expect_used)] // tests fail loudly by design

mod common;

use axum::body::Body;
use axum::http::{Request, StatusCode};
use common::{IMAGE_GIT_SHA, TOKEN, World};
use runner::app::{API_VERSION, API_VERSION_HEADER};
use serde_json::json;

fn api_header(response: &axum::response::Response) -> Option<String> {
    response
        .headers()
        .get(API_VERSION_HEADER)
        .map(|value| value.to_str().unwrap().to_owned())
}

#[tokio::test]
async fn version_reports_the_api_version_and_the_image_commit() {
    let world = World::new().await;

    let (status, body) = world.get("/version").await;

    assert_eq!(status, StatusCode::OK);
    assert_eq!(body["api_version"], json!(API_VERSION));
    assert_eq!(body["git_sha"], json!(IMAGE_GIT_SHA));
    assert_eq!(body["version"], json!(env!("CARGO_PKG_VERSION")));
}

#[tokio::test]
async fn every_response_carries_the_api_version_header() {
    let world = World::new().await;
    let expected = Some(API_VERSION.to_string());

    let health = world
        .send_raw(Request::get("/healthz").body(Body::empty()).unwrap())
        .await;
    let missing = world
        .send_raw(Request::get("/nowhere").body(Body::empty()).unwrap())
        .await;

    assert_eq!(api_header(&health), expected);
    assert_eq!(api_header(&missing), expected);
}

#[tokio::test]
async fn a_refused_unknown_field_carries_the_api_version_header() {
    let world = World::new().await;
    let body = json!({
        "repo": "file:///nowhere.git", "token": TOKEN,
        "onto": "a".repeat(40), "commit": "b".repeat(40), "message": "m",
        "field_from_the_future": true
    });
    let request = Request::post("/v1/revert")
        .header("content-type", "application/json")
        .body(Body::from(body.to_string()))
        .unwrap();

    let response = world.send_raw(request).await;

    assert_eq!(response.status(), StatusCode::BAD_REQUEST);
    assert_eq!(api_header(&response), Some(API_VERSION.to_string()));
}
