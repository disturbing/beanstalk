//! Remotes a request names: an Artifacts URL plus the per-job token minted for it.

use std::fmt;
use std::fmt::Write as _;

use serde::Deserialize;
use sha2::{Digest, Sha256};

use crate::config::RemoteSchemes;

const REDACTED: &str = "<redacted>";
/// Bytes of SHA-256 kept in cache keys and local ref names: 128 bits, collision-free in practice.
const DIGEST_BYTES: usize = 16;
/// The secret part of a token (before `?expires=`) is redacted on its own only when this long, so
/// a short token cannot garble ordinary text.
const MIN_SECRET_CHARS: usize = 8;

/// A remote URL with an allowed scheme and no embedded credentials.
#[derive(Debug, Clone, PartialEq, Eq)]
pub(crate) struct RemoteUrl(String);

impl RemoteUrl {
    /// # Errors
    ///
    /// A reason when `raw` is not a URL, uses a scheme the config does not allow, or carries
    /// credentials (they belong in `token`, which is never logged).
    pub(crate) fn parse(raw: &str, schemes: &RemoteSchemes) -> Result<Self, String> {
        let Some((scheme, rest)) = raw.split_once("://") else {
            return Err(format!("{raw:?} is not a URL"));
        };
        if !schemes.allows(scheme) {
            return Err(format!(
                "scheme {scheme:?} is not allowed (allowed: {schemes})"
            ));
        }
        if raw.chars().any(|c| c.is_whitespace() || c.is_control()) {
            return Err("the URL contains whitespace or control characters".to_owned());
        }
        let authority = rest.split('/').next().unwrap_or_default();
        if authority.contains('@') {
            return Err("credentials belong in token, not in the URL".to_owned());
        }
        if scheme == "file" && !rest.starts_with('/') {
            return Err("a file URL must name an absolute path (file:///...)".to_owned());
        }
        if scheme != "file" && authority.is_empty() {
            return Err(format!("{raw:?} has no host"));
        }
        Ok(Self(raw.to_owned()))
    }

    pub(crate) fn as_str(&self) -> &str {
        &self.0
    }

    /// A stable, filesystem-safe key for this URL.
    pub(crate) fn cache_key(&self) -> String {
        digest_hex(&[self.as_str()])
    }
}

impl fmt::Display for RemoteUrl {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        f.write_str(&self.0)
    }
}

/// Hex of the first bytes of SHA-256 over `parts`, each followed by a newline.
pub(crate) fn digest_hex(parts: &[&str]) -> String {
    let mut hasher = Sha256::new();
    for part in parts {
        hasher.update(part.as_bytes());
        hasher.update(b"\n");
    }
    let digest = hasher.finalize();
    digest
        .iter()
        .take(DIGEST_BYTES)
        .fold(String::new(), |mut hex, byte| {
            // Writing to a String cannot fail.
            let _ = write!(hex, "{byte:02x}");
            hex
        })
}

/// A per-request Artifacts token (`art_v1_<hex>?expires=<unix>`). `Debug` prints a placeholder
/// and there is no `Display`, so it cannot reach a log line by accident.
#[derive(Clone, PartialEq, Eq, Deserialize)]
#[serde(try_from = "String")]
pub(crate) struct Token(String);

impl TryFrom<String> for Token {
    type Error = String;

    fn try_from(raw: String) -> Result<Self, String> {
        // Printable ASCII only: the token goes into an HTTP header, so CR or LF would inject one.
        if !raw.is_empty() && raw.bytes().all(|byte| byte.is_ascii_graphic()) {
            Ok(Self(raw))
        } else {
            Err("token must be non-empty printable ASCII without spaces".to_owned())
        }
    }
}

impl Token {
    /// The header git sends with every request to the remote (`http.extraHeader`).
    pub(crate) fn authorization_header(&self) -> String {
        format!("Authorization: Bearer {}", self.0)
    }

    /// `text` with every occurrence of the token, or of its secret part, replaced.
    pub(crate) fn redact(&self, text: &str) -> String {
        let redacted = text.replace(&self.0, REDACTED);
        match self.0.split_once('?') {
            Some((secret, _)) if secret.len() >= MIN_SECRET_CHARS => {
                redacted.replace(secret, REDACTED)
            }
            _ => redacted,
        }
    }
}

impl fmt::Debug for Token {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        f.write_str("Token(<redacted>)")
    }
}

/// A remote and the token that opens it for this request.
#[derive(Debug, Clone)]
pub(crate) struct Remote {
    pub(crate) url: RemoteUrl,
    pub(crate) token: Token,
}

#[cfg(test)]
mod tests {
    #![allow(clippy::unwrap_used, clippy::expect_used)] // tests fail loudly by design

    use proptest::prelude::*;

    use super::*;
    use crate::config::Config;

    fn schemes(list: &str) -> RemoteSchemes {
        let list = list.to_owned();
        Config::from_lookup(|name| (name == "REMOTE_SCHEMES").then(|| list.clone()))
            .unwrap()
            .remote_schemes()
            .clone()
    }

    #[test]
    fn accepts_an_artifacts_remote() {
        let url = "https://0123abcd.artifacts.cloudflare.net/git/beanstalk-race/race-r1-trunk.git";

        assert!(RemoteUrl::parse(url, &schemes("https")).is_ok());
    }

    #[test]
    fn refuses_file_remotes_unless_configured() {
        let url = "file:///tmp/trunk.git";

        assert!(RemoteUrl::parse(url, &schemes("https")).is_err());
        assert!(RemoteUrl::parse(url, &schemes("https,file")).is_ok());
    }

    #[test]
    fn refuses_credentials_in_the_url() {
        let error =
            RemoteUrl::parse("https://x:art_v1_abc@host/r.git", &schemes("https")).unwrap_err();

        assert!(error.contains("credentials"));
        assert!(!error.contains("art_v1_abc"));
    }

    #[test]
    fn refuses_plain_http_and_non_urls() {
        assert!(RemoteUrl::parse("http://host/r.git", &schemes("https")).is_err());
        assert!(RemoteUrl::parse("--upload-pack=sh", &schemes("https,file")).is_err());
        assert!(RemoteUrl::parse("https:///r.git", &schemes("https")).is_err());
    }

    #[test]
    fn token_debug_never_shows_the_secret() {
        let token = Token::try_from("art_v1_0123456789abcdef?expires=1".to_owned()).unwrap();

        assert_eq!(format!("{token:?}"), "Token(<redacted>)");
    }

    #[test]
    fn refuses_tokens_that_could_inject_a_header() {
        assert!(Token::try_from("abc\r\nX-Evil: 1".to_owned()).is_err());
        assert!(Token::try_from(String::new()).is_err());
    }

    #[test]
    fn cache_keys_are_stable_and_distinct() {
        let a = RemoteUrl::parse("https://h/a.git", &schemes("https")).unwrap();
        let b = RemoteUrl::parse("https://h/b.git", &schemes("https")).unwrap();

        assert_eq!(a.cache_key(), a.cache_key());
        assert_ne!(a.cache_key(), b.cache_key());
        assert_eq!(a.cache_key().len(), 32);
    }

    proptest! {
        #[test]
        fn redaction_removes_every_copy_of_the_token(
            secret in "[a-f0-9]{40}",
            expires in 0_u64..u64::MAX,
            before in "[ -~]{0,30}",
            after in "[ -~]{0,30}",
        ) {
            let raw = format!("art_v1_{secret}?expires={expires}");
            let token = Token::try_from(raw.clone()).unwrap();
            let text = format!("{before}{raw}{after} Authorization: Bearer {raw} x:art_v1_{secret}@h");

            let redacted = token.redact(&text);

            prop_assert!(!redacted.contains(&raw));
            prop_assert!(!redacted.contains(&secret));
        }
    }
}
