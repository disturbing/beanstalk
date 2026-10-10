//! `/v1/check` and `/healthz` through the HTTP API. Arena expectations are the harness's own
//! `CI.run` results on the same commits and extra files (`research/race/harness/ci.py`).

#![allow(clippy::unwrap_used, clippy::expect_used)] // tests fail loudly by design

mod common;

use axum::http::StatusCode;
use common::{ARENA_BASE, Remote, TOKEN, World, has_node};
use serde_json::{Map, Value, json};

/// `CIResult.read_depths["src/billing/coupon-limits.test.ts"]` for t001's acceptance test on
/// the arena base, in the harness's breadth-first order.
const T001_READ_DEPTHS: [(&str, u64); 47] = [
    ("src/billing/coupon-limits.test.ts", 0),
    ("src/lib/testing.ts", 1),
    ("src/app.ts", 2),
    ("src/config.ts", 2),
    ("src/auth/sessions.ts", 2),
    ("src/inventory/stock.ts", 2),
    ("src/catalog/service.ts", 2),
    ("src/notifications/queue.ts", 2),
    ("src/users/service.ts", 2),
    ("src/lib/clock.ts", 2),
    ("src/types.ts", 2),
    ("src/router.ts", 2),
    ("src/db/migrate.ts", 3),
    ("src/routes.ts", 3),
    ("src/lib/errors.ts", 3),
    ("src/catalog/search.ts", 3),
    ("src/notifications/templates.ts", 3),
    ("src/auth/password.ts", 3),
    ("src/db/store.ts", 3),
    ("src/auth/guard.ts", 3),
    ("src/db/migrations/index.ts", 4),
    ("src/auth/handlers.ts", 4),
    ("src/billing/handlers.ts", 4),
    ("src/cart/handlers.ts", 4),
    ("src/catalog/handlers.ts", 4),
    ("src/inventory/handlers.ts", 4),
    ("src/notifications/handlers.ts", 4),
    ("src/orders/handlers.ts", 4),
    ("src/shipping/handlers.ts", 4),
    ("src/users/handlers.ts", 4),
    ("src/lib/money.ts", 4),
    ("src/db/migrations/0001_create_tables.ts", 5),
    ("src/db/migrations/0002_seed_coupons.ts", 5),
    ("src/db/migrations/0003_product_weight.ts", 5),
    ("src/db/migrations/0004_order_shipping.ts", 5),
    ("src/db/migrations/0005_user_roles.ts", 5),
    ("src/lib/validate.ts", 5),
    ("src/billing/service.ts", 5),
    ("src/cart/service.ts", 5),
    ("src/lib/pagination.ts", 5),
    ("src/orders/checkout.ts", 5),
    ("src/orders/service.ts", 5),
    ("src/shipping/service.ts", 5),
    ("src/billing/invoice.ts", 6),
    ("src/shipping/rates.ts", 6),
    ("src/billing/discounts.ts", 7),
    ("src/billing/tax.ts", 7),
];

const ADD_TS: &str = "import { ZERO } from './numbers.ts';\n\
                      export function add(a: number, b: number): number {\n  return ZERO + a + b;\n}\n";
const BROKEN_ADD_TS: &str = "import { ZERO } from './numbers.ts';\n\
                             export function add(a: number, b: number): number {\n  return ZERO + a - b;\n}\n";
const NUMBERS_TS: &str = "export const ZERO = 0;\n";
const ADD_TEST_TS: &str = "import assert from 'node:assert/strict';\n\
                           import { test } from 'node:test';\n\
                           import { add } from './add.ts';\n\n\
                           test('adds two numbers', () => {\n  assert.equal(add(2, 3), 5);\n});\n\n\
                           test('adds zero', () => {\n  assert.equal(add(2, 0), 2);\n});\n";

/// A tiny zero-dependency TypeScript project, as the arena is.
fn tiny_project(world: &World, add_ts: &str) -> (Remote, String) {
    let trunk = world.bare("tiny");
    let work = world.work("tiny");
    let sha = work.commit(
        &[
            ("package.json", "{\"type\": \"module\"}\n"),
            ("src/numbers.ts", NUMBERS_TS),
            ("src/add.ts", add_ts),
            ("src/add.test.ts", ADD_TEST_TS),
        ],
        "tiny project",
    );
    work.push(&trunk, "HEAD:refs/heads/main");
    (trunk, sha)
}

fn check_body(trunk: &Remote, sha: &str) -> Value {
    json!({"repo": trunk.url(), "token": TOKEN, "sha": sha})
}

fn arena_trunk(world: &World) -> Remote {
    world.arena("arena")
}

fn depth_map(entries: &[(&str, u64)]) -> Value {
    let map: Map<String, Value> = entries
        .iter()
        .map(|(path, hops)| ((*path).to_owned(), json!(hops)))
        .collect();
    Value::Object(map)
}

fn sorted_paths<'a>(entries: &[(&'a str, u64)]) -> Vec<&'a str> {
    let mut paths: Vec<&str> = entries.iter().map(|(path, _)| *path).collect();
    paths.sort_unstable();
    paths
}

#[tokio::test]
async fn healthz_reports_git_and_node() {
    let world = World::new().await;

    let (status, body) = world.get("/healthz").await;

    assert!(body["git"].is_string(), "{body}");
    if has_node() {
        assert_eq!(status, StatusCode::OK);
        assert_eq!(body["ok"], true);
        assert!(body["node"].as_str().unwrap().starts_with(char::is_numeric));
    }
}

#[tokio::test]
async fn check_is_green_on_a_passing_suite() {
    if !has_node() {
        return;
    }
    let world = World::new().await;
    let (trunk, sha) = tiny_project(&world, ADD_TS);

    let (status, body) = world.post("/v1/check", &check_body(&trunk, &sha)).await;

    assert_eq!(status, StatusCode::OK, "{body}");
    assert_eq!(body["green"], true, "{body}");
    assert_eq!(body["tests"], 2);
    assert_eq!(body["failures"], 0);
    assert_eq!(body["failing_files"], json!([]));
    assert_eq!(body["passing_files"], json!(["src/add.test.ts"]));
    assert_eq!(body["read_sets"], json!({}));
    assert_eq!(body["timed_out"], false);
    assert!(body["suite_seconds"].as_f64().unwrap() > 0.0);
    assert!(body["ci_seconds"].as_f64().unwrap() >= body["suite_seconds"].as_f64().unwrap());
    assert_eq!(body["passing_read_sets"], json!({}));
}

#[tokio::test]
async fn check_reports_passing_read_sets_and_runs_only_the_named_tests_when_asked() {
    if !has_node() {
        return;
    }
    let world = World::new().await;
    let (trunk, sha) = tiny_project(&world, ADD_TS);
    let mut request = check_body(&trunk, &sha);
    request["all_read_sets"] = json!(true);
    request["cmd"] = json!(["node", "--test", "src/add.test.ts"]);

    let (status, body) = world.post("/v1/check", &request).await;

    assert_eq!(status, StatusCode::OK, "{body}");
    assert_eq!(body["green"], true, "{body}");
    assert_eq!(
        body["passing_read_sets"],
        json!({"src/add.test.ts": ["src/add.test.ts", "src/add.ts", "src/numbers.ts"]})
    );
    assert_eq!(body["read_sets"], json!({}));
}

/// A real-task arena in miniature: a test that needs a dependency from the snapshot, an
/// environment variable from the run's suite and a local port, and a flaky file the suite's
/// extglob leaves out.
const ARENA_TEST_MJS: &str = "import assert from 'node:assert/strict';\n\
                              import net from 'node:net';\n\
                              import { test } from 'node:test';\n\
                              import pad from 'leftpad';\n\n\
                              test('pads from the snapshot', () => assert.equal(pad('7'), '07'));\n\
                              test('sees the run environment', () => assert.equal(process.env.ARENA_FLAG, 'on'));\n\
                              test('listens and connects on loopback', async () => {\n\
                              \x20 const server = net.createServer((socket) => socket.end('hi'));\n\
                              \x20 await new Promise((done) => server.listen(0, '127.0.0.1', done));\n\
                              \x20 const socket = net.connect(server.address().port, '127.0.0.1');\n\
                              \x20 const reply = await new Promise((done) => socket.on('data', (data) => done(String(data))));\n\
                              \x20 server.close();\n\
                              \x20 assert.equal(reply, 'hi');\n\
                              });\n";
const FLAKY_TEST_MJS: &str = "import { test } from 'node:test';\n\
                              test('always fails', () => { throw new Error('flaky'); });\n";

fn arena_project(world: &World) -> (Remote, String) {
    let trunk = world.bare("real");
    let work = world.work("real");
    let sha = work.commit(
        &[
            ("package.json", "{\"type\": \"module\"}\n"),
            ("test/arena.test.mjs", ARENA_TEST_MJS),
            ("test/flaky.test.mjs", FLAKY_TEST_MJS),
        ],
        "real-task arena",
    );
    work.push(&trunk, "HEAD:refs/heads/main");
    let leftpad = world.deps_dir().join("arena/node_modules/leftpad");
    std::fs::create_dir_all(&leftpad).unwrap();
    std::fs::write(
        leftpad.join("package.json"),
        "{\"name\": \"leftpad\", \"type\": \"module\", \"main\": \"index.js\"}\n",
    )
    .unwrap();
    std::fs::write(
        leftpad.join("index.js"),
        "export default (text) => text.padStart(2, '0');\n",
    )
    .unwrap();
    (trunk, sha)
}

#[tokio::test]
async fn check_runs_an_arena_suite_with_its_env_snapshot_and_loopback() {
    if !has_node() {
        return;
    }
    let world = World::new().await;
    let (trunk, sha) = arena_project(&world);
    let mut request = check_body(&trunk, &sha);
    request["cmd"] = json!([
        "node",
        "--no-use-env-proxy",
        "--test",
        "test/!(flaky).test.mjs"
    ]);
    request["env"] = json!({"ARENA_FLAG": "on"});
    request["deps"] = json!("arena");

    let (status, body) = world.post("/v1/check", &request).await;

    assert_eq!(status, StatusCode::OK, "{body}");
    assert_eq!(body["green"], true, "{body}");
    assert_eq!(body["tests"], 3, "{body}");
    assert_eq!(body["passing_files"], json!(["test/arena.test.mjs"]));
    assert!(
        ["loopback", "host"].contains(&body["network"].as_str().unwrap()),
        "{body}"
    );
}

#[tokio::test]
async fn check_without_the_snapshot_cannot_resolve_the_dependency() {
    if !has_node() {
        return;
    }
    let world = World::new().await;
    let (trunk, sha) = arena_project(&world);
    let mut request = check_body(&trunk, &sha);
    request["cmd"] = json!(["node", "--test", "test/!(flaky).test.mjs"]);
    request["env"] = json!({"ARENA_FLAG": "on"});

    let (status, body) = world.post("/v1/check", &request).await;

    assert_eq!(status, StatusCode::OK, "{body}");
    assert_eq!(body["green"], false, "{body}");
}

#[tokio::test]
async fn check_refuses_a_snapshot_the_image_does_not_have() {
    let world = World::new().await;
    let (trunk, sha) = arena_project(&world);
    let mut request = check_body(&trunk, &sha);
    request["deps"] = json!("express");

    let (status, body) = world.post("/v1/check", &request).await;

    assert_eq!(status, StatusCode::BAD_REQUEST, "{body}");
    assert!(body["message"].as_str().unwrap().contains("deps"), "{body}");
}

#[tokio::test]
async fn check_reports_failures_with_read_sets_and_stack_files() {
    if !has_node() {
        return;
    }
    let world = World::new().await;
    let (trunk, sha) = tiny_project(&world, BROKEN_ADD_TS);

    let (_, body) = world.post("/v1/check", &check_body(&trunk, &sha)).await;

    assert_eq!(body["green"], false, "{body}");
    assert_eq!(body["tests"], 2);
    assert_eq!(body["failures"], 1);
    assert_eq!(body["failing_files"], json!(["src/add.test.ts"]));
    assert_eq!(body["failing_tests"][0]["file"], "src/add.test.ts");
    assert_eq!(body["failing_tests"][0]["name"], "adds two numbers");
    assert_eq!(
        body["failing_tests"][0]["message"],
        "Expected values to be strictly equal:\n\n-1 !== 5"
    );
    assert_eq!(
        body["read_sets"],
        json!({"src/add.test.ts": ["src/add.test.ts", "src/add.ts", "src/numbers.ts"]})
    );
    assert_eq!(
        body["read_depths"],
        json!({"src/add.test.ts": {"src/add.test.ts": 0, "src/add.ts": 1, "src/numbers.ts": 2}})
    );
    assert_eq!(
        body["read_set"],
        json!(["src/add.test.ts", "src/add.ts", "src/numbers.ts"])
    );
    assert_eq!(body["stack_files"], json!(["src/add.test.ts"]));
    assert!(
        body["output_excerpt"]
            .as_str()
            .unwrap()
            .starts_with("failing tests:")
    );
}

#[tokio::test]
async fn check_matches_the_harness_on_an_acceptance_test_against_base() {
    if !has_node() {
        return;
    }
    let world = World::new().await;
    let trunk = arena_trunk(&world);
    let test_path = "src/billing/coupon-limits.test.ts";
    let mut body = check_body(&trunk, ARENA_BASE);
    body["extra_files"] = json!({test_path: trunk.show("refs/heads/ref/t001", test_path)});

    let (status, body) = world.post("/v1/check", &body).await;

    assert_eq!(status, StatusCode::OK, "{body}");
    assert_eq!(body["green"], false);
    assert_eq!(body["tests"], 82);
    assert_eq!(body["failures"], 1);
    assert_eq!(body["failing_files"], json!([test_path]));
    assert_eq!(
        body["failing_tests"],
        json!([{
            "file": test_path,
            "name": "stops accepting a coupon once its limit is reached",
            "message": "Expected values to be strictly equal:\n\n201 !== 409",
        }])
    );
    assert_eq!(body["passing_files"].as_array().unwrap().len(), 21);
    assert_eq!(
        body["read_depths"],
        json!({test_path: depth_map(&T001_READ_DEPTHS)})
    );
    assert_eq!(
        body["read_sets"],
        json!({test_path: sorted_paths(&T001_READ_DEPTHS)})
    );
    assert_eq!(body["read_set"], json!(sorted_paths(&T001_READ_DEPTHS)));
    assert_eq!(body["stack_files"], json!([test_path]));
}

#[tokio::test]
async fn check_matches_the_harness_on_two_failing_files() {
    if !has_node() {
        return;
    }
    let world = World::new().await;
    let trunk = arena_trunk(&world);
    let tests = [
        "src/lib/money-format.test.ts",
        "src/orders/confirmation-grouping.test.ts",
    ];
    let extra: Map<String, Value> = tests
        .iter()
        .map(|path| {
            (
                (*path).to_owned(),
                json!(trunk.show("refs/heads/ref/t005", path)),
            )
        })
        .collect();
    let mut body = check_body(&trunk, ARENA_BASE);
    body["extra_files"] = Value::Object(extra);

    let (_, body) = world.post("/v1/check", &body).await;

    assert_eq!(body["tests"], 84, "{body}");
    assert_eq!(body["failures"], 3);
    assert_eq!(body["failing_files"], json!(tests));
    assert_eq!(body["stack_files"], json!(tests));
    assert_eq!(
        body["read_depths"][tests[0]],
        json!({
            "src/lib/money-format.test.ts": 0, "src/lib/money.ts": 1, "src/types.ts": 2,
            "src/config.ts": 3, "src/db/store.ts": 3, "src/lib/clock.ts": 3, "src/lib/errors.ts": 4,
        })
    );
    assert_eq!(body["read_sets"][tests[1]].as_array().unwrap().len(), 47);
    assert_eq!(body["read_set"].as_array().unwrap().len(), 48);
    assert_eq!(
        body["failing_tests"][2]["message"],
        "The input did not match the regular expression /2 x Product \\d+ - \\$3,000\\.00/. Input:\n\n\
         'Thanks for your order!\\n2 x Product 1 - $3000.00\\nTotal: $3195.00'"
    );
}

#[tokio::test]
async fn check_of_a_reference_solution_is_green() {
    if !has_node() {
        return;
    }
    let world = World::new().await;
    let trunk = arena_trunk(&world);
    let sha = trunk.ref_sha("refs/heads/ref/t005").unwrap();

    let (_, body) = world.post("/v1/check", &check_body(&trunk, &sha)).await;

    assert_eq!(body["green"], true, "{body}");
    assert_eq!(body["tests"], 84);
    assert_eq!(body["failing_files"], json!([]));
}

#[tokio::test]
async fn a_test_file_that_cannot_load_fails_under_its_own_name() {
    if !has_node() {
        return;
    }
    let world = World::new().await;
    let (trunk, sha) = tiny_project(&world, ADD_TS);
    let mut body = check_body(&trunk, &sha);
    body["extra_files"] = json!({"src/broken.test.ts": "import { gone } from './gone.ts';\n"});

    let (_, body) = world.post("/v1/check", &body).await;

    assert_eq!(body["green"], false);
    assert_eq!(body["failing_files"], json!(["src/broken.test.ts"]));
    assert_eq!(body["failing_tests"][0]["name"], "src/broken.test.ts");
    assert_eq!(body["failing_tests"][0]["message"], "test failed");
    assert_eq!(
        body["read_sets"],
        json!({"src/broken.test.ts": ["src/broken.test.ts"]})
    );
}

#[tokio::test]
async fn a_suite_that_outlives_its_timeout_is_killed_and_reads_as_a_crash() {
    if !has_node() {
        return;
    }
    let world = World::new().await;
    let (trunk, sha) = tiny_project(&world, ADD_TS);
    let mut body = check_body(&trunk, &sha);
    body["suite_timeout_seconds"] = json!(1);
    body["extra_files"] = json!({
        "src/hang.test.ts": "import { test } from 'node:test';\n\
                             test('hangs', () => new Promise(() => { setInterval(() => {}, 1000); }));\n",
    });

    let (_, body) = world.post("/v1/check", &body).await;

    assert_eq!(body["timed_out"], true, "{body}");
    assert_eq!(body["green"], false);
    assert_eq!(body["failing_files"], Value::Null);
    assert!(body["suite_seconds"].as_f64().unwrap() < 10.0);
}

#[tokio::test]
async fn check_refuses_commands_other_than_node() {
    let world = World::new().await;
    let (trunk, sha) = tiny_project(&world, ADD_TS);
    let mut body = check_body(&trunk, &sha);
    body["cmd"] = json!(["sh", "-c", "true"]);

    let (status, body) = world.post("/v1/check", &body).await;

    assert_eq!(status, StatusCode::BAD_REQUEST);
    assert!(body["message"].as_str().unwrap().contains("cmd"), "{body}");
}

#[tokio::test]
async fn check_refuses_extra_files_outside_the_checkout() {
    let world = World::new().await;
    let (trunk, sha) = tiny_project(&world, ADD_TS);
    let mut body = check_body(&trunk, &sha);
    body["extra_files"] = json!({"../escape.ts": "x"});

    let (status, _) = world.post("/v1/check", &body).await;

    assert_eq!(status, StatusCode::BAD_REQUEST);
}
