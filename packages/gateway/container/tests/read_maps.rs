//! Traced checks (`trace`), affected-test runs (`only_files`) and tree manifests through the
//! HTTP API. Where strace cannot trace (macOS, a locked-down container), a traced check runs
//! untraced and says why; the traced expectations run where it can (Linux with strace).

#![allow(clippy::unwrap_used, clippy::expect_used)] // tests fail loudly by design

mod common;

use std::collections::BTreeSet;

use axum::http::StatusCode;
use common::{Remote, TOKEN, World, has_node};
use serde_json::{Value, json};

const NUMBERS_TS: &str = "export const ZERO = 0;\n";
const ADD_TS: &str = "import { ZERO } from './numbers.ts';\n\
                      export function add(a: number, b: number): number {\n  return ZERO + a + b;\n}\n";
const ADD_TEST_TS: &str = "import assert from 'node:assert/strict';\n\
                           import { test } from 'node:test';\n\
                           import { add } from './add.ts';\n\n\
                           test('adds', () => {\n  assert.equal(add(2, 3), 5);\n});\n";
/// Reads a data file at run time and imports only `numbers.ts`.
const RATES_TEST_TS: &str = "import assert from 'node:assert/strict';\n\
                             import { readFileSync } from 'node:fs';\n\
                             import { test } from 'node:test';\n\
                             import { ZERO } from './numbers.ts';\n\n\
                             test('rates', () => {\n  \
                               const rates = JSON.parse(readFileSync('data/rates.json', 'utf8'));\n  \
                               assert.equal(rates.eur + ZERO, 2);\n});\n";
const RATES_JSON: &str = "{\"eur\": 2}\n";

fn project(world: &World, rates: &str) -> (Remote, String, common::Work) {
    let trunk = world.bare("maps");
    let work = world.work("maps");
    let sha = work.commit(
        &[
            ("package.json", "{\"type\": \"module\"}\n"),
            ("data/rates.json", rates),
            ("src/numbers.ts", NUMBERS_TS),
            ("src/add.ts", ADD_TS),
            ("src/add.test.ts", ADD_TEST_TS),
            ("src/rates.test.ts", RATES_TEST_TS),
        ],
        "maps project",
    );
    work.push(&trunk, "HEAD:refs/heads/main");
    (trunk, sha, work)
}

fn body(trunk: &Remote, sha: &str, extra: &Value) -> Value {
    let mut body = json!({"repo": trunk.url(), "token": TOKEN, "sha": sha});
    if let (Some(target), Some(fields)) = (body.as_object_mut(), extra.as_object()) {
        target.extend(fields.clone());
    }
    body
}

fn strings(value: &Value) -> BTreeSet<String> {
    value
        .as_array()
        .unwrap()
        .iter()
        .map(|item| item.as_str().unwrap().to_owned())
        .collect()
}

fn file_map<'a>(response: &'a Value, file: &str) -> &'a Value {
    response["read_maps"]["files"]
        .as_array()
        .unwrap()
        .iter()
        .find(|map| map["file"] == file)
        .unwrap()
}

async fn can_trace(world: &World) -> bool {
    let (_, health) = world.get("/healthz").await;
    health["tracing"].as_bool().unwrap()
}

#[tokio::test]
async fn a_traced_check_maps_each_test_file_or_says_why_not() {
    if !has_node() {
        return;
    }
    let world = World::new().await;
    let (trunk, sha, work) = project(&world, RATES_JSON);

    let (status, response) = world
        .post("/v1/check", &body(&trunk, &sha, &json!({"trace": true})))
        .await;

    assert_eq!(status, StatusCode::OK, "{response}");
    assert_eq!(response["green"], true);
    assert_eq!(response["tests"], 2);
    assert_eq!(
        response["tree"]["blobs"]["src/add.ts"],
        common::git(&work.dir, &["rev-parse", "HEAD:src/add.ts"]).trim()
    );
    if !can_trace(&world).await {
        assert_eq!(response["read_maps"]["status"], "unavailable");
        assert!(
            response["read_maps"]["reason"]
                .as_str()
                .unwrap()
                .contains("strace")
        );
        return;
    }
    assert_eq!(response["read_maps"]["status"], "traced");
    let add = file_map(&response, "src/add.test.ts");
    let rates = file_map(&response, "src/rates.test.ts");
    assert_eq!(
        (add["passed"].clone(), add["tests"].clone()),
        (json!(true), json!(1))
    );
    let add_reads = strings(&add["reads"]);
    let rates_reads = strings(&rates["reads"]);
    for read in [
        "src/add.test.ts",
        "src/add.ts",
        "src/numbers.ts",
        "package.json",
    ] {
        assert!(add_reads.contains(read), "{read} in {add_reads:?}");
    }
    assert!(rates_reads.contains("data/rates.json"), "{rates_reads:?}");
    assert!(!rates_reads.contains("src/add.ts"), "{rates_reads:?}");
    assert!(!add_reads.contains("data/rates.json"), "{add_reads:?}");
    assert!(strings(&add["probes"]).contains("src/package.json"));
    assert_eq!(
        add["hashes"]["src/add.ts"],
        response["tree"]["blobs"]["src/add.ts"]
    );
    assert!(add["hashes"].get("src").is_none());
}

#[tokio::test]
async fn a_traced_red_check_reports_which_file_failed() {
    if !has_node() {
        return;
    }
    let world = World::new().await;
    let (trunk, sha, _) = project(&world, "{\"eur\": 3}\n");

    let (status, response) = world
        .post("/v1/check", &body(&trunk, &sha, &json!({"trace": true})))
        .await;

    assert_eq!(status, StatusCode::OK, "{response}");
    assert_eq!(response["green"], false);
    assert_eq!(response["failing_files"], json!(["src/rates.test.ts"]));
    assert_eq!(response["passing_files"], json!(["src/add.test.ts"]));
    if can_trace(&world).await {
        assert_eq!(file_map(&response, "src/rates.test.ts")["passed"], false);
        assert_eq!(file_map(&response, "src/add.test.ts")["passed"], true);
    }
}

#[tokio::test]
async fn only_files_runs_just_those_test_files_and_skips_missing_ones() {
    if !has_node() {
        return;
    }
    let world = World::new().await;
    let (trunk, sha, _) = project(&world, "{\"eur\": 3}\n");
    let only = json!({"only_files": ["src/add.test.ts", "src/gone.test.ts"]});

    let (status, response) = world.post("/v1/check", &body(&trunk, &sha, &only)).await;

    assert_eq!(status, StatusCode::OK, "{response}");
    assert_eq!(response["green"], true);
    assert_eq!(response["tests"], 1);
    assert_eq!(response["passing_files"], json!(["src/add.test.ts"]));
    assert!(response.get("read_maps").is_none());
    assert!(response.get("tree").is_none());
}

#[tokio::test]
async fn no_files_to_run_is_green_and_runs_nothing() {
    let world = World::new().await;
    let (trunk, sha, _) = project(&world, RATES_JSON);
    let only = json!({"only_files": [], "tree_manifest": true});

    let (status, response) = world.post("/v1/check", &body(&trunk, &sha, &only)).await;

    assert_eq!(status, StatusCode::OK, "{response}");
    assert_eq!(response["green"], true);
    assert_eq!(response["tests"], 0);
    assert_eq!(response["tree"]["commit"], sha);
    assert_eq!(response["tree"]["extra_files"], false);
    assert!(response["tree"]["blobs"]["data/rates.json"].is_string());
}

#[tokio::test]
async fn extra_files_are_hashed_into_the_tree() {
    let world = World::new().await;
    let (trunk, sha, work) = project(&world, RATES_JSON);
    let extra = json!({
        "only_files": [],
        "tree_manifest": true,
        "extra_files": {"data/rates.json": RATES_JSON, "src/new.test.ts": "x\n"},
    });

    let (status, response) = world.post("/v1/check", &body(&trunk, &sha, &extra)).await;

    assert_eq!(status, StatusCode::OK, "{response}");
    assert_eq!(response["tree"]["extra_files"], true);
    assert_eq!(
        response["tree"]["blobs"]["data/rates.json"],
        common::git(&work.dir, &["rev-parse", "HEAD:data/rates.json"]).trim()
    );
    assert_eq!(
        response["tree"]["blobs"]["src/new.test.ts"],
        "587be6b4c3f93f93c489c0111bba5596147a26cb" // git hash-object of "x\n"
    );
}

#[tokio::test]
async fn trace_and_only_files_need_a_node_test_command() {
    let world = World::new().await;
    let (trunk, sha, _) = project(&world, RATES_JSON);

    for extra in [
        json!({"trace": true, "cmd": ["node", "src/add.ts"]}),
        json!({"only_files": ["src/add.test.ts"], "cmd": ["node", "src/add.ts"]}),
        json!({"only_files": ["../x.test.ts"]}),
    ] {
        let (status, response) = world.post("/v1/check", &body(&trunk, &sha, &extra)).await;

        assert_eq!(status, StatusCode::BAD_REQUEST, "{extra}: {response}");
    }
}

#[tokio::test]
async fn traced_read_sets_are_what_each_test_observed_and_say_so() {
    if !has_node() {
        return;
    }
    let world = World::new().await;
    let (trunk, sha, _) = project(&world, RATES_JSON);
    let traced = json!({"trace": true, "all_read_sets": true});

    let (status, response) = world.post("/v1/check", &body(&trunk, &sha, &traced)).await;
    let (_, untraced) = world
        .post(
            "/v1/check",
            &body(&trunk, &sha, &json!({"all_read_sets": true})),
        )
        .await;

    assert_eq!(status, StatusCode::OK, "{response}");
    assert_eq!(untraced["read_sets_complete"], false);
    if !can_trace(&world).await {
        assert_eq!(response["read_sets_complete"], false);
        return;
    }
    assert_eq!(response["read_sets_complete"], true);
    assert_eq!(
        response["passing_files"],
        json!(["src/add.test.ts", "src/rates.test.ts"])
    );
    let rates = strings(&response["passing_read_sets"]["src/rates.test.ts"]);
    assert!(rates.contains("data/rates.json"), "{rates:?}");
    assert!(rates.contains("src/rates.test.ts") && rates.contains("src/numbers.ts"));
    assert!(!rates.contains("src/add.ts"), "{rates:?}");
}
