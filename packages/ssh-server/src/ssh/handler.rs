//! One SSH connection: public-key authentication against the keys people registered (the
//! gateway decides), then `git-upload-pack` or `git-receive-pack` on a session channel.
//! Passwords, keyboard-interactive, shells, ptys, subsystems and forwarding are refused.

use std::collections::HashMap;
use std::sync::Arc;
use std::time::Instant;

use russh::keys::{HashAlg, PublicKey};
use russh::server::{Auth, ChannelOpenHandle, Msg, Session};
use russh::{Channel, ChannelId, MethodKind, MethodSet};
use tokio::io::AsyncWriteExt;

use crate::error::Error;
use crate::gateway::{Gateway, GitCall, KeyCheck, KeyOwner, PublicKeyLine};
use crate::git::bridge::{self, BridgeLimits, ChannelIo};
use crate::git::command::{GitCommand, parse_command};

/// Session channels one connection may hold at once (git opens one).
const MAX_CHANNELS: usize = 2;
const MAX_ENV_VALUE: usize = 256;

/// Public keys only: what a client is told when it asks.
pub fn public_key_only() -> MethodSet {
    MethodSet::from(&[MethodKind::PublicKey][..])
}

/// What every connection of a server shares.
#[derive(Debug)]
pub struct Shared<G> {
    pub gateway: G,
    pub bridge: BridgeLimits,
}

/// The authenticated person behind a connection.
#[derive(Debug, Clone)]
struct Authenticated {
    key: PublicKeyLine,
    fingerprint: String,
    handle: String,
}

/// The state of one SSH connection.
#[derive(Debug)]
pub struct Connection<G> {
    shared: Arc<Shared<G>>,
    id: u64,
    user: Option<Authenticated>,
    /// Owners found while keys were offered, so a signed attempt is not looked up twice.
    offered: HashMap<String, Option<KeyOwner>>,
    channels: HashMap<ChannelId, Channel<Msg>>,
    protocols: HashMap<ChannelId, String>,
    opened: usize,
}

impl<G: Gateway> Connection<G> {
    pub fn new(shared: Arc<Shared<G>>, id: u64) -> Self {
        Self {
            shared,
            id,
            user: None,
            offered: HashMap::new(),
            channels: HashMap::new(),
            protocols: HashMap::new(),
            opened: 0,
        }
    }

    async fn owner_of(&mut self, key: &PublicKey, check: KeyCheck) -> Option<KeyOwner> {
        let line = key_line(key)?;
        if check == KeyCheck::Probe
            && let Some(known) = self.offered.get(line.as_str())
        {
            return known.clone();
        }
        match self.shared.gateway.key_owner(&line, check).await {
            Ok(owner) => {
                self.offered.insert(line.as_str().to_owned(), owner.clone());
                owner
            }
            Err(error) => {
                tracing::warn!(connection = self.id, %error, "key lookup failed");
                None
            }
        }
    }

    fn reject() -> Auth {
        Auth::Reject {
            proceed_with_methods: Some(public_key_only()),
            partial_success: false,
        }
    }

    fn take_channel(&mut self, channel: ChannelId) -> Option<Channel<Msg>> {
        self.channels.remove(&channel)
    }
}

impl<G: Gateway> russh::server::Handler for Connection<G> {
    type Error = Error;

    async fn auth_none(&mut self, _user: &str) -> Result<Auth, Error> {
        Ok(Self::reject())
    }

    async fn auth_password(&mut self, _user: &str, _password: &str) -> Result<Auth, Error> {
        Ok(Self::reject())
    }

    async fn auth_publickey_offered(
        &mut self,
        _user: &str,
        key: &PublicKey,
    ) -> Result<Auth, Error> {
        Ok(match self.owner_of(key, KeyCheck::Probe).await {
            Some(_) => Auth::Accept,
            None => Self::reject(),
        })
    }

    async fn auth_publickey(&mut self, _user: &str, key: &PublicKey) -> Result<Auth, Error> {
        let fingerprint = key.fingerprint(HashAlg::Sha256).to_string();
        let (Some(owner), Some(line)) =
            (self.owner_of(key, KeyCheck::Confirm).await, key_line(key))
        else {
            tracing::info!(connection = self.id, %fingerprint, "unknown key refused");
            return Ok(Self::reject());
        };
        tracing::info!(connection = self.id, %fingerprint, handle = %owner.handle, "authenticated");
        self.user = Some(Authenticated {
            key: line,
            fingerprint,
            handle: owner.handle,
        });
        Ok(Auth::Accept)
    }

    async fn channel_open_session(
        &mut self,
        channel: Channel<Msg>,
        reply: ChannelOpenHandle,
        _session: &mut Session,
    ) -> Result<(), Error> {
        if self.user.is_none() || self.opened >= MAX_CHANNELS {
            // Dropping the handle refuses the channel.
            return Ok(());
        }
        self.opened += 1;
        self.channels.insert(channel.id(), channel);
        reply.accept().await;
        Ok(())
    }

    async fn env_request(
        &mut self,
        channel: ChannelId,
        name: &str,
        value: &str,
        session: &mut Session,
    ) -> Result<(), Error> {
        if name == "GIT_PROTOCOL" && value.len() <= MAX_ENV_VALUE {
            self.protocols.insert(channel, value.to_owned());
            session.channel_success(channel)?;
        } else {
            session.channel_failure(channel)?;
        }
        Ok(())
    }

    async fn exec_request(
        &mut self,
        channel: ChannelId,
        data: &[u8],
        session: &mut Session,
    ) -> Result<(), Error> {
        let (Some(user), Some(open)) = (self.user.clone(), self.take_channel(channel)) else {
            session.channel_failure(channel)?;
            return Ok(());
        };
        session.channel_success(channel)?;
        let call = match parse_command(data) {
            Ok(command) => git_call(&user, command, self.protocols.remove(&channel)),
            Err(refusal) => {
                tracing::info!(connection = self.id, handle = %user.handle, %refusal, "command refused");
                tokio::spawn(finish(open, format!("beanstalk: {refusal}\n"), 128));
                return Ok(());
            }
        };
        let shared = Arc::clone(&self.shared);
        let connection = self.id;
        tokio::spawn(async move {
            run_git(&shared, call, open, connection, &user).await;
        });
        Ok(())
    }

    async fn shell_request(
        &mut self,
        channel: ChannelId,
        session: &mut Session,
    ) -> Result<(), Error> {
        let (Some(user), Some(open)) = (self.user.clone(), self.take_channel(channel)) else {
            session.channel_failure(channel)?;
            return Ok(());
        };
        session.channel_success(channel)?;
        let greeting = format!(
            "Hi @{}! Your key works ({}). Gitstalk serves git over SSH and has no shell.\n",
            user.handle, user.fingerprint
        );
        tokio::spawn(finish(open, greeting, 1));
        Ok(())
    }

    #[allow(clippy::too_many_arguments)] // russh's signature
    async fn pty_request(
        &mut self,
        channel: ChannelId,
        _term: &str,
        _columns: u32,
        _rows: u32,
        _pixel_width: u32,
        _pixel_height: u32,
        _modes: &[(russh::Pty, u32)],
        session: &mut Session,
    ) -> Result<(), Error> {
        session.channel_failure(channel)?;
        Ok(())
    }

    async fn subsystem_request(
        &mut self,
        channel: ChannelId,
        _name: &str,
        session: &mut Session,
    ) -> Result<(), Error> {
        session.channel_failure(channel)?;
        Ok(())
    }

    async fn channel_close(
        &mut self,
        channel: ChannelId,
        _session: &mut Session,
    ) -> Result<(), Error> {
        self.channels.remove(&channel);
        self.protocols.remove(&channel);
        self.opened = self.opened.saturating_sub(1);
        Ok(())
    }
}

fn git_call(user: &Authenticated, command: GitCommand, protocol: Option<String>) -> GitCall {
    GitCall {
        key: user.key.clone(),
        path: command.path,
        service: command.service,
        protocol,
    }
}

/// Runs one git command on its channel and closes the channel with the command's status.
async fn run_git<G: Gateway>(
    shared: &Shared<G>,
    call: GitCall,
    channel: Channel<Msg>,
    connection: u64,
    user: &Authenticated,
) {
    let started = Instant::now();
    let (mut read_half, write_half) = channel.split();
    let mut io = ChannelIo {
        stdin: read_half.make_reader(),
        stdout: write_half.make_writer(),
        stderr: write_half.make_writer_ext(Some(1)),
    };
    let outcome = bridge::serve(&shared.gateway, &call, &mut io, shared.bridge).await;
    drop(io);
    tracing::info!(
        connection,
        handle = %user.handle,
        service = call.service.as_str(),
        repo = %call.path,
        exit = outcome.exit_status(),
        millis = u64::try_from(started.elapsed().as_millis()).unwrap_or(u64::MAX),
        "git command done"
    );
    close(&write_half, outcome.exit_status()).await;
}

/// Writes `message` on stderr and closes the channel with `status`.
async fn finish(channel: Channel<Msg>, message: String, status: u32) {
    let mut stderr = channel.make_writer_ext(Some(1));
    // The client may have gone; there is nothing more to do then.
    let _ = stderr.write_all(message.as_bytes()).await;
    let _ = stderr.flush().await;
    let _ = channel.exit_status(status).await;
    let _ = channel.eof().await;
    let _ = channel.close().await;
}

async fn close<S>(channel: &russh::ChannelWriteHalf<S>, status: u32)
where
    S: From<(ChannelId, russh::ChannelMsg)> + Send + Sync + 'static,
{
    let _ = channel.exit_status(status).await;
    let _ = channel.eof().await;
    let _ = channel.close().await;
}

/// The key as the gateway looks it up: `<algorithm> <base64>`, no comment.
fn key_line(key: &PublicKey) -> Option<PublicKeyLine> {
    let mut bare = key.clone();
    bare.set_comment("");
    bare.to_openssh().ok().map(PublicKeyLine::new)
}
