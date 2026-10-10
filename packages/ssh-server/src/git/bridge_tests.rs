#![allow(clippy::unwrap_used, clippy::expect_used)] // tests fail loudly by design

use std::sync::{Arc, Mutex};
use std::time::Duration;

use super::*;
use crate::gateway::{KeyCheck, KeyOwner, PublicKeyLine};
use crate::git::command::RepoPath;

/// One scripted answer: a status and a body.
type Scripted = (u16, Vec<u8>);

/// A gateway that answers from a script and records what it was sent.
#[derive(Clone, Default)]
struct ScriptedGateway {
    advertisement: Arc<Mutex<Option<Scripted>>>,
    replies: Arc<Mutex<Vec<Scripted>>>,
    bodies: Arc<Mutex<Vec<Vec<u8>>>>,
    advertised: Arc<Mutex<usize>>,
}

impl ScriptedGateway {
    fn new(advertisement: (u16, &[u8]), replies: &[(u16, &[u8])]) -> Self {
        let gateway = Self::default();
        *lock(&gateway.advertisement) = Some((advertisement.0, advertisement.1.to_vec()));
        *lock(&gateway.replies) = replies.iter().map(|(s, b)| (*s, b.to_vec())).collect();
        gateway
    }

    fn bodies(&self) -> Vec<Vec<u8>> {
        lock(&self.bodies).clone()
    }

    fn advertised(&self) -> usize {
        *lock(&self.advertised)
    }
}

fn lock<T>(mutex: &Mutex<T>) -> std::sync::MutexGuard<'_, T> {
    mutex
        .lock()
        .unwrap_or_else(std::sync::PoisonError::into_inner)
}

fn reply(status: u16, body: Vec<u8>) -> GitReply {
    GitReply {
        status,
        body: Box::pin(std::io::Cursor::new(body)),
    }
}

impl Gateway for ScriptedGateway {
    async fn key_owner(&self, _: &PublicKeyLine, _: KeyCheck) -> Result<Option<KeyOwner>, Error> {
        Ok(None)
    }

    async fn advertise(&self, _: &GitCall) -> Result<GitReply, Error> {
        *lock(&self.advertised) += 1;
        let (status, body) = lock(&self.advertisement)
            .clone()
            .unwrap_or((500, Vec::new()));
        Ok(reply(status, body))
    }

    async fn service(&self, _: &GitCall, mut body: RequestBody) -> Result<GitReply, Error> {
        let mut received = Vec::new();
        while let Some(chunk) = body.recv().await {
            received.extend_from_slice(&chunk?);
        }
        lock(&self.bodies).push(received);
        let mut replies = lock(&self.replies);
        let (status, bytes) = if replies.is_empty() {
            (500, Vec::new())
        } else {
            replies.remove(0)
        };
        Ok(reply(status, bytes))
    }
}

fn call(service: Service, protocol: Option<&str>) -> GitCall {
    let path = RepoPath::parse("/acme/greeter.git").unwrap();
    GitCall {
        key: PublicKeyLine::new("ssh-ed25519 AAAA"),
        path,
        service,
        protocol: protocol.map(str::to_owned),
    }
}

const LIMITS: BridgeLimits = BridgeLimits {
    max_push_bytes: 1 << 20,
    max_request_bytes: 1 << 16,
};

struct Run {
    outcome: Outcome,
    stdout: Vec<u8>,
    stderr: String,
}

async fn run(gateway: &ScriptedGateway, call: &GitCall, stdin: &[u8], limits: BridgeLimits) -> Run {
    let mut io = ChannelIo {
        stdin,
        stdout: Vec::new(),
        stderr: Vec::new(),
    };
    let outcome = serve(gateway, call, &mut io, limits).await;
    Run {
        outcome,
        stdout: io.stdout,
        stderr: String::from_utf8_lossy(&io.stderr).into_owned(),
    }
}

fn pkt(text: &str) -> Vec<u8> {
    format!("{:04x}{text}", text.len() + 4).into_bytes()
}

const OLD: &str = "1111111111111111111111111111111111111111";
const NEW: &str = "2222222222222222222222222222222222222222";
const ZERO: &str = "0000000000000000000000000000000000000000";

fn receive_pack_advertisement() -> Vec<u8> {
    let mut http = pkt("# service=git-receive-pack\n");
    http.extend_from_slice(b"0000");
    http.extend(pkt(&format!(
        "{OLD} refs/heads/sprout\0report-status side-band-64k push-options\n"
    )));
    http.extend_from_slice(b"0000");
    http
}

#[tokio::test]
async fn a_push_streams_commands_options_and_pack_and_returns_the_report() {
    let report = [pkt("\u{1}000eunpack ok\n"), b"0000".to_vec()].concat();
    let gateway = ScriptedGateway::new((200, &receive_pack_advertisement()), &[(200, &report)]);
    let mut stdin = pkt(&format!(
        "{ZERO} {NEW} refs/heads/bean/add-total\0report-status side-band-64k push-options\n"
    ));
    stdin.extend_from_slice(b"0000");
    stdin.extend(pkt("wait"));
    stdin.extend_from_slice(b"0000");
    stdin.extend_from_slice(b"PACK\0\0\0\x02\0\0\0\0fake-pack-bytes");
    let run = run(&gateway, &call(Service::ReceivePack, None), &stdin, LIMITS).await;

    assert_eq!(run.outcome, Outcome::Done, "{}", run.stderr);
    let advertised = [
        pkt(&format!(
            "{OLD} refs/heads/sprout\0report-status side-band-64k push-options\n"
        )),
        b"0000".to_vec(),
    ]
    .concat();
    assert_eq!(run.stdout, [advertised, report].concat());
    assert_eq!(gateway.bodies(), vec![stdin]);
}

#[tokio::test]
async fn an_up_to_date_push_posts_nothing() {
    let gateway = ScriptedGateway::new((200, &receive_pack_advertisement()), &[]);
    let run = run(&gateway, &call(Service::ReceivePack, None), b"0000", LIMITS).await;
    assert_eq!(run.outcome, Outcome::Done);
    assert!(gateway.bodies().is_empty());
}

#[tokio::test]
async fn a_deletion_is_posted_without_waiting_for_a_pack() {
    let gateway = ScriptedGateway::new(
        (200, &receive_pack_advertisement()),
        &[(200, &pkt("unpack ok\n"))],
    );
    let (mut client, server) = tokio::io::duplex(1 << 16);
    let mut head = pkt(&format!("{OLD} {ZERO} refs/heads/bean/x\0report-status\n"));
    head.extend_from_slice(b"0000");
    client.write_all(&head).await.unwrap();
    // The client keeps its side open, as git does while it waits for the report.
    let mut io = ChannelIo {
        stdin: server,
        stdout: Vec::new(),
        stderr: Vec::new(),
    };
    let outcome = tokio::time::timeout(
        Duration::from_secs(5),
        serve(&gateway, &call(Service::ReceivePack, None), &mut io, LIMITS),
    )
    .await;
    assert_eq!(outcome.ok(), Some(Outcome::Done));
    assert_eq!(gateway.bodies(), vec![head]);
    drop(client);
}

#[tokio::test]
async fn a_push_over_the_limit_is_refused() {
    let gateway = ScriptedGateway::new((200, &receive_pack_advertisement()), &[(200, b"")]);
    let mut stdin = pkt(&format!(
        "{ZERO} {NEW} refs/heads/bean/big\0report-status\n"
    ));
    stdin.extend_from_slice(b"0000");
    stdin.extend(vec![7_u8; 4096]);
    let limits = BridgeLimits {
        max_push_bytes: 1024,
        ..LIMITS
    };
    let run = run(&gateway, &call(Service::ReceivePack, None), &stdin, limits).await;
    assert_eq!(run.outcome.exit_status(), 128);
    assert!(
        run.stderr.contains("larger than 1024 bytes"),
        "{}",
        run.stderr
    );
}

#[tokio::test]
async fn a_refused_repository_shows_the_gateway_words() {
    let gateway = ScriptedGateway::new((404, b"no repository acme/greeter\n"), &[]);
    let run = run(&gateway, &call(Service::ReceivePack, None), b"", LIMITS).await;
    assert_eq!(
        run.outcome,
        Outcome::Failed("no repository acme/greeter".into())
    );
    assert_eq!(run.stderr, "gitstalk: no repository acme/greeter\n");
    assert!(run.stdout.is_empty());
}

#[tokio::test]
async fn a_v2_fetch_posts_each_command_and_drops_http_framing() {
    let mut advertisement = pkt("version 2\n");
    advertisement.extend(pkt("ls-refs=unborn\n"));
    advertisement.extend(pkt("fetch=shallow\n"));
    advertisement.extend_from_slice(b"0000");
    let ls_refs_reply = [
        pkt(&format!("{OLD} refs/heads/sprout\n")),
        b"0000".to_vec(),
        b"0002".to_vec(),
    ]
    .concat();
    let fetch_reply = [
        pkt("packfile\n"),
        pkt("\u{1}PACK..."),
        b"0000".to_vec(),
        b"0002".to_vec(),
    ]
    .concat();
    let gateway = ScriptedGateway::new(
        (200, &advertisement),
        &[(200, &ls_refs_reply), (200, &fetch_reply)],
    );
    let ls_refs = [
        pkt("command=ls-refs\n"),
        b"0001".to_vec(),
        pkt("peel\n"),
        b"0000".to_vec(),
    ]
    .concat();
    let fetch = [
        pkt("command=fetch\n"),
        b"0001".to_vec(),
        pkt(&format!("want {OLD}\n")),
        pkt("done\n"),
        b"0000".to_vec(),
    ]
    .concat();
    let stdin = [ls_refs.clone(), fetch.clone(), b"0000".to_vec()].concat();
    let run = run(
        &gateway,
        &call(Service::UploadPack, Some("version=2")),
        &stdin,
        LIMITS,
    )
    .await;

    assert_eq!(run.outcome, Outcome::Done, "{}", run.stderr);
    assert_eq!(gateway.bodies(), vec![ls_refs, fetch]);
    let expected = [
        advertisement,
        pkt(&format!("{OLD} refs/heads/sprout\n")),
        b"0000".to_vec(),
        pkt("packfile\n"),
        pkt("\u{1}PACK..."),
        b"0000".to_vec(),
    ]
    .concat();
    assert_eq!(run.stdout, expected);
}

#[tokio::test]
async fn a_fetch_without_protocol_v2_is_refused_before_the_gateway() {
    let gateway = ScriptedGateway::new((200, b"0000"), &[]);
    let run = run(&gateway, &call(Service::UploadPack, None), b"", LIMITS).await;
    assert_eq!(run.outcome.exit_status(), 128);
    assert!(run.stderr.contains("protocol v2"), "{}", run.stderr);
    assert_eq!(gateway.advertised(), 0);
}

#[tokio::test]
async fn a_fetch_request_ending_early_is_a_protocol_error() {
    let gateway = ScriptedGateway::new((200, b"0000"), &[]);
    let stdin = pkt("command=fetch\n");
    let run = run(
        &gateway,
        &call(Service::UploadPack, Some("version=2")),
        &stdin,
        LIMITS,
    )
    .await;
    assert!(run.stderr.contains("git protocol error"), "{}", run.stderr);
}

#[tokio::test]
async fn a_server_failure_is_shown_without_its_details() {
    let gateway = ScriptedGateway::new((500, b"D1_ERROR: no such table: secrets"), &[]);
    let run = run(&gateway, &call(Service::ReceivePack, None), b"", LIMITS).await;
    assert_eq!(run.outcome.exit_status(), 128);
    assert!(run.stderr.contains("try again"), "{}", run.stderr);
    assert!(!run.stderr.contains("D1_ERROR"), "{}", run.stderr);
}

#[test]
fn protocol_v2_is_read_from_the_git_protocol_value() {
    assert!(is_protocol_v2(Some("version=2")));
    assert!(is_protocol_v2(Some("object-format=sha1:version=2")));
    assert!(!is_protocol_v2(Some("version=1")));
    assert!(!is_protocol_v2(None));
}
