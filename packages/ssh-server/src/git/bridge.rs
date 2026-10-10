//! One git command over SSH, served by the gateway's smart-HTTP proxy.
//!
//! - `git-receive-pack` (push, protocol v0/v1 as git always pushes): the ref advertisement from
//!   `GET info/refs`, then the client's commands, push options and pack streamed as one
//!   `POST git-receive-pack`, whose answer (report-status, `remote:` lines, `-o wait`'s
//!   progress and verdict) streams back as it comes.
//! - `git-upload-pack` (clone, fetch) in protocol v2, which is stateless per command: the
//!   capability advertisement, then each command (`ls-refs`, `fetch`) as one POST.
//!
//! Over HTTP the gateway prefixes advertisements with `# service=…` and may end v2 answers with
//! a response-end packet (`0002`); SSH has neither, so both are removed on the way.

use bytes::{Bytes, BytesMut};
use tokio::io::{AsyncRead, AsyncReadExt, AsyncWrite, AsyncWriteExt};
use tokio::sync::mpsc;

use super::command::Service;
use super::pkt::{self, Pkt, PktKind};
use crate::error::Error;
use crate::gateway::{Gateway, GitCall, GitReply, RequestBody};

/// The SSH channel's three streams.
#[derive(Debug)]
pub struct ChannelIo<R, W, E> {
    pub stdin: R,
    pub stdout: W,
    pub stderr: E,
}

/// Bounds on what one command may send.
#[derive(Debug, Clone, Copy)]
pub struct BridgeLimits {
    /// A push's commands, options and pack together.
    pub max_push_bytes: u64,
    /// One protocol v2 request (a fetch's wants and haves).
    pub max_request_bytes: usize,
}

/// How a command ended, as the SSH exit status tells git.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum Outcome {
    Done,
    /// Refused or failed; the message was written to stderr.
    Failed(String),
}

impl Outcome {
    pub fn exit_status(&self) -> u32 {
        match self {
            Self::Done => 0,
            Self::Failed(_) => 128,
        }
    }
}

const ZERO_OIDS: [&str; 2] = [
    "0000000000000000000000000000000000000000",
    "0000000000000000000000000000000000000000000000000000000000000000",
];
const BODY_CHUNKS_IN_FLIGHT: usize = 8;
const READ_CHUNK: usize = 64 * 1024;
const ERROR_BODY_LIMIT: u64 = 2048;

/// Serves `call` over `io` and reports how it ended. Failures are written to stderr in words a
/// person can act on; details stay in the logs.
pub async fn serve<G, R, W, E>(
    gateway: &G,
    call: &GitCall,
    io: &mut ChannelIo<R, W, E>,
    limits: BridgeLimits,
) -> Outcome
where
    G: Gateway,
    R: AsyncRead + Unpin + Send,
    W: AsyncWrite + Unpin + Send,
    E: AsyncWrite + Unpin + Send,
{
    let result = match call.service {
        Service::UploadPack => upload_pack(gateway, call, io, limits).await,
        Service::ReceivePack => receive_pack(gateway, call, io, limits).await,
    };
    let flushed = io.stdout.flush().await;
    let outcome = match (result, flushed) {
        (Ok(()), Ok(())) => Outcome::Done,
        (Err(failure), _) => failure.into_outcome(),
        (Ok(()), Err(error)) => Failure::from(Error::Io(error)).into_outcome(),
    };
    if let Outcome::Failed(message) = &outcome {
        let line = format!("gitstalk: {message}\n");
        // The client may be gone already; nothing is left to tell it.
        let _ = io.stderr.write_all(line.as_bytes()).await;
        let _ = io.stderr.flush().await;
    }
    outcome
}

/// Why a command stopped, in two parts: what the person sees, and the error behind it.
#[derive(Debug)]
struct Failure {
    shown: String,
}

impl Failure {
    fn shown(message: impl Into<String>) -> Self {
        Self {
            shown: message.into(),
        }
    }

    fn into_outcome(self) -> Outcome {
        Outcome::Failed(self.shown)
    }
}

impl From<Error> for Failure {
    fn from(error: Error) -> Self {
        match error {
            Error::Protocol(reason) => Self::shown(format!("git protocol error: {reason}")),
            Error::Limit(reason) => Self::shown(reason),
            other => {
                tracing::warn!(error = %other, "git command failed");
                Self::shown("the server could not finish this command; try again")
            }
        }
    }
}

impl From<std::io::Error> for Failure {
    fn from(error: std::io::Error) -> Self {
        Self::from(Error::Io(error))
    }
}

async fn upload_pack<G, R, W, E>(
    gateway: &G,
    call: &GitCall,
    io: &mut ChannelIo<R, W, E>,
    limits: BridgeLimits,
) -> Result<(), Failure>
where
    G: Gateway,
    R: AsyncRead + Unpin + Send,
    W: AsyncWrite + Unpin + Send,
    E: AsyncWrite + Unpin + Send,
{
    if !is_protocol_v2(call.protocol.as_deref()) {
        return Err(Failure::shown(
            "fetching over SSH needs git protocol v2 (git 2.26 or newer does it by default; \
             otherwise run: git config --global protocol.version 2)",
        ));
    }
    let advertisement = accepted(gateway.advertise(call).await?).await?;
    forward_pkts(advertisement.body, &mut io.stdout, Header::Strip).await?;
    while let Some(request) = read_v2_request(&mut io.stdin, limits.max_request_bytes).await? {
        let reply = accepted(gateway.service(call, single_chunk(request)).await?).await?;
        forward_pkts(reply.body, &mut io.stdout, Header::Keep).await?;
    }
    Ok(())
}

async fn receive_pack<G, R, W, E>(
    gateway: &G,
    call: &GitCall,
    io: &mut ChannelIo<R, W, E>,
    limits: BridgeLimits,
) -> Result<(), Failure>
where
    G: Gateway,
    R: AsyncRead + Unpin + Send,
    W: AsyncWrite + Unpin + Send,
    E: AsyncWrite + Unpin + Send,
{
    let advertisement = accepted(gateway.advertise(call).await?).await?;
    forward_pkts(advertisement.body, &mut io.stdout, Header::Strip).await?;
    io.stdout.flush().await?;
    let Some(head) = read_push_head(&mut io.stdin).await? else {
        // Up to date: the client sent no commands, so there is nothing to forward.
        return Ok(());
    };
    let (sender, body) = mpsc::channel(BODY_CHUNKS_IN_FLIGHT);
    let head_len = u64::try_from(head.bytes.len()).unwrap_or(u64::MAX);
    sender
        .send(Ok(head.bytes))
        .await
        .map_err(|_| Error::Gateway("request body closed".into()))?;
    let budget = PushBudget {
        remaining: limits.max_push_bytes.saturating_sub(head_len),
        total: limits.max_push_bytes,
    };
    let stdin = &mut io.stdin;
    let pump = async move {
        // The sender is moved in, so the body ends when the pump does.
        if head.has_pack {
            pump_body(stdin, &sender, budget).await
        } else {
            Ok(())
        }
    };
    let (pumped, reply) = tokio::join!(pump, gateway.service(call, body));
    pumped?;
    let reply = accepted(reply?).await?;
    let mut body = reply.body;
    tokio::io::copy(&mut body, &mut io.stdout).await?;
    Ok(())
}

fn is_protocol_v2(protocol: Option<&str>) -> bool {
    protocol.is_some_and(|value| value.split(':').any(|part| part.trim() == "version=2"))
}

/// A reply the gateway accepted (200). A refusal (4xx) becomes the gateway's own words; a
/// server failure (5xx) is logged and shown as a retryable failure, never with its details.
async fn accepted(reply: GitReply) -> Result<GitReply, Failure> {
    if reply.status == 200 {
        return Ok(reply);
    }
    let mut text = String::new();
    let mut limited = reply.body.take(ERROR_BODY_LIMIT);
    // An unreadable error body still leaves the status to report.
    let _ = limited.read_to_string(&mut text).await;
    let message = text.trim();
    if reply.status >= 500 {
        return Err(Error::Gateway(format!("answered {}: {message}", reply.status)).into());
    }
    Err(Failure::shown(if message.is_empty() {
        format!("the server answered {}", reply.status)
    } else {
        message.to_owned()
    }))
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum Header {
    /// The first packet may be smart HTTP's `# service=…` line and its flush: drop them.
    Strip,
    Keep,
}

/// Copies pkt-lines from `reader` to `writer`, dropping response-end packets (and the HTTP
/// service header when asked).
async fn forward_pkts<R, W>(mut reader: R, writer: &mut W, header: Header) -> Result<(), Failure>
where
    R: AsyncRead + Unpin,
    W: AsyncWrite + Unpin,
{
    let mut first = true;
    let mut skip_flush = false;
    while let Some(packet) = pkt::read_pkt(&mut reader).await? {
        if first && header == Header::Strip && packet.payload().starts_with(b"# service=") {
            first = false;
            skip_flush = true;
            continue;
        }
        first = false;
        if skip_flush && packet.is_flush() {
            skip_flush = false;
            continue;
        }
        skip_flush = false;
        if packet.kind() != PktKind::ResponseEnd {
            writer.write_all(packet.raw()).await?;
        }
    }
    writer.flush().await?;
    Ok(())
}

/// One protocol v2 request: packets up to and including a flush. `None` when the client ends
/// the session (a lone flush, or the end of input).
async fn read_v2_request<R: AsyncRead + Unpin>(
    reader: &mut R,
    max_bytes: usize,
) -> Result<Option<Bytes>, Failure> {
    let mut request = BytesMut::new();
    loop {
        let Some(packet) = pkt::read_pkt(reader).await? else {
            return if request.is_empty() {
                Ok(None)
            } else {
                Err(Error::Protocol("the request ended before its flush".into()).into())
            };
        };
        if packet.is_flush() && request.is_empty() {
            return Ok(None);
        }
        request.extend_from_slice(packet.raw());
        if request.len() > max_bytes {
            return Err(Failure::shown("the fetch request is too large"));
        }
        if packet.is_flush() {
            return Ok(Some(request.freeze()));
        }
    }
}

/// The start of a push: the commands (and push options) as read, and whether a pack follows.
#[derive(Debug)]
struct PushHead {
    bytes: Bytes,
    has_pack: bool,
}

/// Reads the commands and the push options. `None` when the client has nothing to push.
async fn read_push_head<R: AsyncRead + Unpin>(reader: &mut R) -> Result<Option<PushHead>, Failure> {
    let mut bytes = BytesMut::new();
    let mut updates_anything = false;
    let mut push_options = false;
    let mut commands = 0_usize;
    loop {
        let Some(packet) = pkt::read_pkt(reader).await? else {
            return if commands == 0 {
                Ok(None)
            } else {
                Err(Error::Protocol("the push ended inside its commands".into()).into())
            };
        };
        if packet.is_flush() {
            if commands == 0 {
                return Ok(None);
            }
            bytes.extend_from_slice(packet.raw());
            break;
        }
        bytes.extend_from_slice(packet.raw());
        let (command, capabilities) = split_capabilities(&packet);
        if command.starts_with(b"shallow ") {
            continue;
        }
        if commands == 0 {
            push_options = capabilities
                .split(|b| *b == b' ')
                .any(|c| c == b"push-options");
        }
        commands += 1;
        updates_anything |= !is_deletion(command);
    }
    if push_options {
        read_until_flush(reader, &mut bytes).await?;
    }
    Ok(Some(PushHead {
        bytes: bytes.freeze(),
        has_pack: updates_anything,
    }))
}

/// A command line and its capabilities (after a NUL, on the first command only).
fn split_capabilities(packet: &Pkt) -> (&[u8], &[u8]) {
    let payload = packet.payload();
    let payload = payload.strip_suffix(b"\n").unwrap_or(payload);
    match payload.iter().position(|b| *b == 0) {
        Some(nul) => (
            payload.get(..nul).unwrap_or_default(),
            payload.get(nul + 1..).unwrap_or_default(),
        ),
        None => (payload, &[]),
    }
}

/// `<old> <new> <ref>` whose new id is all zeros: no pack data is sent for it.
fn is_deletion(command: &[u8]) -> bool {
    let mut fields = command.split(|b| *b == b' ');
    let new = fields.nth(1).unwrap_or_default();
    ZERO_OIDS.iter().any(|zero| new == zero.as_bytes())
}

async fn read_until_flush<R: AsyncRead + Unpin>(
    reader: &mut R,
    out: &mut BytesMut,
) -> Result<(), Failure> {
    loop {
        let packet = pkt::read_pkt(reader)
            .await?
            .ok_or_else(|| Error::Protocol("the push options ended early".into()))?;
        out.extend_from_slice(packet.raw());
        if packet.is_flush() {
            return Ok(());
        }
    }
}

/// How much of a push is left to read, and the whole limit (for the message).
#[derive(Debug, Clone, Copy)]
struct PushBudget {
    remaining: u64,
    total: u64,
}

/// Streams the rest of the client's input (the pack) into the request body.
async fn pump_body<R: AsyncRead + Unpin>(
    reader: &mut R,
    sender: &mpsc::Sender<Result<Bytes, std::io::Error>>,
    budget: PushBudget,
) -> Result<(), Failure> {
    let max_bytes = budget.remaining;
    let mut sent = 0_u64;
    loop {
        let mut chunk = BytesMut::with_capacity(READ_CHUNK);
        let read = reader.read_buf(&mut chunk).await?;
        if read == 0 {
            return Ok(());
        }
        sent = sent.saturating_add(u64::try_from(read).unwrap_or(u64::MAX));
        if sent > max_bytes {
            let reason = format!("the push is larger than {} bytes", budget.total);
            let _ = sender
                .send(Err(std::io::Error::other(reason.clone())))
                .await;
            return Err(Failure::shown(reason));
        }
        if sender.send(Ok(chunk.freeze())).await.is_err() {
            // The gateway answered early (a refusal) and stopped reading. git reads the answer
            // only after it has written the whole pack, so the rest is read and dropped.
            let rest = max_bytes.saturating_sub(sent);
            let mut rest_of_pack = (&mut *reader).take(rest);
            tokio::io::copy(&mut rest_of_pack, &mut tokio::io::sink()).await?;
            return Ok(());
        }
    }
}

fn single_chunk(bytes: Bytes) -> RequestBody {
    let (sender, body) = mpsc::channel(1);
    // A fresh channel with room for one chunk: the send cannot fail.
    let _ = sender.try_send(Ok(bytes));
    body
}

#[cfg(test)]
#[path = "bridge_tests.rs"]
mod tests;
