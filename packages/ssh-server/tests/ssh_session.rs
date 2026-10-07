//! The SSH surface end to end: a real russh client against the server on a loopback port, with a
//! fake gateway that knows one key. Covers who gets in (registered keys only, no passwords), what
//! runs (git services only), and that a push and a v2 fetch reach the gateway as sent.
#![allow(clippy::unwrap_used, clippy::expect_used)] // tests fail loudly by design

use std::sync::{Arc, Mutex};
use std::time::Duration;

use russh::client::{self, Handle};

use russh::keys::{Algorithm, PrivateKey, PrivateKeyWithHashAlg, PublicKeyOrCertificate};
use russh::{ChannelMsg, Error as SshError};
use ssh_server::config::Limits;
use ssh_server::error::Error;
use ssh_server::gateway::{
    Gateway, GitCall, GitReply, KeyCheck, KeyOwner, PublicKeyLine, RequestBody,
};
use ssh_server::git::bridge::BridgeLimits;
use ssh_server::ssh::{Shared, SshServer, russh_config};

#[derive(Clone, Default)]
struct FakeGateway {
    known_key: Arc<Mutex<String>>,
    lookups: Arc<Mutex<Vec<KeyCheck>>>,
    calls: Arc<Mutex<Vec<RecordedCall>>>,
}

/// One request the fake gateway saw.
#[derive(Clone, Debug)]
struct RecordedCall {
    what: &'static str,
    target: String,
    protocol: Option<String>,
    body: Vec<u8>,
}

impl Gateway for FakeGateway {
    async fn key_owner(
        &self,
        key: &PublicKeyLine,
        check: KeyCheck,
    ) -> Result<Option<KeyOwner>, Error> {
        self.lookups.lock().unwrap().push(check);
        let known = self.known_key.lock().unwrap().clone();
        Ok((key.as_str() == known).then(|| KeyOwner {
            handle: "acme".into(),
        }))
    }

    async fn advertise(&self, call: &GitCall) -> Result<GitReply, Error> {
        self.record(call, "advertise", Vec::new());
        let body = match call.service.as_str() {
            "git-receive-pack" => [
                pkt("# service=git-receive-pack\n"),
                b"0000".to_vec(),
                pkt(SPROUT_REF),
                b"0000".to_vec(),
            ]
            .concat(),
            _ => b"000eversion 2\n0000".to_vec(),
        };
        Ok(reply(200, body))
    }

    async fn service(&self, call: &GitCall, mut body: RequestBody) -> Result<GitReply, Error> {
        let mut received = Vec::new();
        while let Some(chunk) = body.recv().await {
            received.extend_from_slice(&chunk.unwrap());
        }
        self.record(call, "service", received);
        Ok(reply(200, [pkt("unpack ok\n"), b"0000".to_vec()].concat()))
    }
}

impl FakeGateway {
    fn record(&self, call: &GitCall, what: &'static str, body: Vec<u8>) {
        self.calls.lock().unwrap().push(RecordedCall {
            what,
            target: format!("{} {}", call.service.as_str(), call.path),
            protocol: call.protocol.clone(),
            body,
        });
    }
}

const SPROUT_REF: &str =
    "1111111111111111111111111111111111111111 refs/heads/sprout\0report-status\n";

fn pkt(text: &str) -> Vec<u8> {
    format!("{:04x}{text}", text.len() + 4).into_bytes()
}

fn reply(status: u16, body: Vec<u8>) -> GitReply {
    GitReply {
        status,
        body: Box::pin(std::io::Cursor::new(body)),
    }
}

struct Client;

impl client::Handler for Client {
    type Error = SshError;

    async fn check_server_key(&mut self, _key: &PublicKeyOrCertificate) -> Result<bool, SshError> {
        Ok(true)
    }
}

fn new_key() -> PrivateKey {
    PrivateKey::random(&mut rand::rng(), Algorithm::Ed25519).unwrap()
}

async fn start(gateway: FakeGateway) -> std::net::SocketAddr {
    let limits = Limits {
        max_sessions: 4,
        idle_timeout: Duration::from_secs(30),
        max_session: Duration::from_mins(1),
        max_push_bytes: 1 << 20,
        max_auth_attempts: 3,
    };
    let shared = Shared {
        gateway,
        bridge: BridgeLimits {
            max_push_bytes: limits.max_push_bytes,
            max_request_bytes: 1 << 16,
        },
    };
    let server = SshServer::new(russh_config(new_key(), &limits), shared, &limits);
    let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
    let address = listener.local_addr().unwrap();
    tokio::spawn(async move { server.run(listener).await });
    address
}

async fn connect(address: std::net::SocketAddr) -> Handle<Client> {
    let config = Arc::new(client::Config::default());
    client::connect(config, address, Client).await.unwrap()
}

async fn sign_in(session: &mut Handle<Client>, key: &PrivateKey) -> bool {
    let key = PrivateKeyWithHashAlg::new(Arc::new(key.clone()), None);
    session
        .authenticate_publickey("git", key)
        .await
        .unwrap()
        .success()
}

fn key_line(key: &PrivateKey) -> String {
    key.public_key().to_openssh().unwrap()
}

/// Runs `command` (with `env` set first) and returns stdout, stderr and the exit status.
async fn exec(
    session: &Handle<Client>,
    command: &str,
    env: Option<(&str, &str)>,
    stdin: &[u8],
) -> (Vec<u8>, String, Option<u32>) {
    let mut channel = session.channel_open_session().await.unwrap();
    if let Some((name, value)) = env {
        channel.set_env(false, name, value).await.unwrap();
    }
    channel.exec(true, command).await.unwrap();
    if !stdin.is_empty() {
        channel.data(stdin).await.unwrap();
    }
    channel.eof().await.unwrap();
    let (mut stdout, mut stderr, mut status) = (Vec::new(), Vec::new(), None);
    while let Some(message) = channel.wait().await {
        match message {
            ChannelMsg::Data { data } => stdout.extend_from_slice(&data),
            ChannelMsg::ExtendedData { data, ext: 1 } => stderr.extend_from_slice(&data),
            ChannelMsg::ExitStatus { exit_status } => status = Some(exit_status),
            _ => {}
        }
    }
    (
        stdout,
        String::from_utf8_lossy(&stderr).into_owned(),
        status,
    )
}

#[tokio::test]
async fn an_unregistered_key_is_refused() {
    let gateway = FakeGateway::default();
    *gateway.known_key.lock().unwrap() = key_line(&new_key());
    let mut session = connect(start(gateway).await).await;
    assert!(!sign_in(&mut session, &new_key()).await);
}

#[tokio::test]
async fn passwords_are_refused() {
    let gateway = FakeGateway::default();
    let mut session = connect(start(gateway).await).await;
    let result = session
        .authenticate_password("git", "hunter2")
        .await
        .unwrap();
    assert!(!result.success());
}

#[tokio::test]
async fn a_registered_key_signs_in_and_is_confirmed_once() {
    let key = new_key();
    let gateway = FakeGateway::default();
    *gateway.known_key.lock().unwrap() = key_line(&key);
    let mut session = connect(start(gateway.clone()).await).await;
    assert!(sign_in(&mut session, &key).await);
    let confirms = gateway
        .lookups
        .lock()
        .unwrap()
        .iter()
        .filter(|check| **check == KeyCheck::Confirm)
        .count();
    assert_eq!(confirms, 1);
}

#[tokio::test]
async fn a_shell_greets_and_exits() {
    let key = new_key();
    let gateway = FakeGateway::default();
    *gateway.known_key.lock().unwrap() = key_line(&key);
    let mut session = connect(start(gateway).await).await;
    assert!(sign_in(&mut session, &key).await);
    let mut channel = session.channel_open_session().await.unwrap();
    channel.request_shell(true).await.unwrap();
    let (mut stderr, mut status) = (Vec::new(), None);
    while let Some(message) = channel.wait().await {
        match message {
            ChannelMsg::ExtendedData { data, .. } => stderr.extend_from_slice(&data),
            ChannelMsg::ExitStatus { exit_status } => status = Some(exit_status),
            _ => {}
        }
    }
    let stderr = String::from_utf8_lossy(&stderr);
    assert!(stderr.contains("Hi @acme!"), "{stderr}");
    assert_eq!(status, Some(1));
}

#[tokio::test]
async fn other_commands_are_refused() {
    let key = new_key();
    let gateway = FakeGateway::default();
    *gateway.known_key.lock().unwrap() = key_line(&key);
    let mut session = connect(start(gateway.clone()).await).await;
    assert!(sign_in(&mut session, &key).await);
    let (_, stderr, status) = exec(&session, "cat /etc/passwd", None, b"").await;
    assert_eq!(status, Some(128));
    assert!(stderr.contains("beanstalk serves git only"), "{stderr}");
    assert!(gateway.calls.lock().unwrap().is_empty());
}

#[tokio::test]
async fn a_push_reaches_the_gateway_as_sent() {
    let key = new_key();
    let gateway = FakeGateway::default();
    *gateway.known_key.lock().unwrap() = key_line(&key);
    let mut session = connect(start(gateway.clone()).await).await;
    assert!(sign_in(&mut session, &key).await);
    let push = [
        pkt("0000000000000000000000000000000000000000 2222222222222222222222222222222222222222 refs/heads/bean/add-total\0report-status\n"),
        b"0000PACKdata".to_vec(),
    ]
    .concat();
    let (stdout, stderr, status) = exec(
        &session,
        "git-receive-pack '/acme/greeter.git'",
        None,
        &push,
    )
    .await;
    assert_eq!(status, Some(0), "{stderr}");
    assert!(
        stdout.starts_with(&pkt(SPROUT_REF)),
        "the service header is stripped"
    );
    assert!(stdout.ends_with(&[pkt("unpack ok\n"), b"0000".to_vec()].concat()));
    let calls = gateway.calls.lock().unwrap();
    let posted = calls.iter().find(|call| call.what == "service").unwrap();
    assert_eq!(posted.target, "git-receive-pack acme/greeter");
    assert_eq!(posted.body, push);
}

#[tokio::test]
async fn a_v2_fetch_forwards_git_protocol() {
    let key = new_key();
    let gateway = FakeGateway::default();
    *gateway.known_key.lock().unwrap() = key_line(&key);
    let mut session = connect(start(gateway.clone()).await).await;
    assert!(sign_in(&mut session, &key).await);
    let request = b"0014command=ls-refs\n00010000".to_vec();
    let (stdout, stderr, status) = exec(
        &session,
        "git-upload-pack '/acme/greeter.git'",
        Some(("GIT_PROTOCOL", "version=2")),
        &request,
    )
    .await;
    assert_eq!(status, Some(0), "{stderr}");
    assert!(stdout.starts_with(b"000eversion 2\n0000"));
    let calls = gateway.calls.lock().unwrap();
    let posted = calls.iter().find(|call| call.what == "service").unwrap();
    assert_eq!(posted.protocol.as_deref(), Some("version=2"));
    assert_eq!(posted.body, request);
}
