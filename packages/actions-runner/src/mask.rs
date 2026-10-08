//! Masking: every secret value, the job token and every `::add-mask::` value is replaced by
//! `***` in each line before it leaves the container. act masks single-line secrets itself;
//! this covers what it misses (multi-line secrets line by line, base64 and URL-encoded forms,
//! act's own messages and annotations).

use base64::Engine;
use base64::engine::general_purpose::{STANDARD, STANDARD_NO_PAD, URL_SAFE_NO_PAD};
use percent_encoding::{NON_ALPHANUMERIC, utf8_percent_encode};

/// The replacement GitHub shows for a masked value.
pub const MASK: &str = "***";
/// Values shorter than this are not masked: masking `a` or `1` would wreck every line, and
/// GitHub's own runner skips such values too.
const MIN_MASKED_CHARS: usize = 4;

/// The set of values to hide, longest first so a value that contains another is hidden whole.
#[derive(Debug, Default, Clone)]
pub struct Masker {
    values: Vec<String>,
}

impl Masker {
    pub fn new() -> Self {
        Self::default()
    }

    /// Adds a secret: the value, each of its lines, and its base64 and URL-encoded forms.
    pub fn add(&mut self, secret: &str) {
        for form in forms_of(secret) {
            self.insert(form);
        }
    }

    /// Hides every known value in `text`.
    pub fn apply(&self, text: &str) -> String {
        let mut masked = text.to_owned();
        for value in &self.values {
            if masked.contains(value.as_str()) {
                masked = masked.replace(value.as_str(), MASK);
            }
        }
        masked
    }

    /// Whether `text` contains any known value (a job output that does is withheld).
    pub fn reveals_secret(&self, text: &str) -> bool {
        self.values
            .iter()
            .any(|value| text.contains(value.as_str()))
    }

    fn insert(&mut self, value: String) {
        if value.chars().count() < MIN_MASKED_CHARS || self.values.contains(&value) {
            return;
        }
        let at = self
            .values
            .iter()
            .position(|known| known.len() < value.len())
            .unwrap_or(self.values.len());
        self.values.insert(at, value);
    }
}

fn forms_of(secret: &str) -> Vec<String> {
    let trimmed = secret.trim_end_matches(['\r', '\n']);
    let mut forms = vec![trimmed.to_owned()];
    forms.extend(
        trimmed
            .lines()
            .map(|line| line.trim_end_matches('\r').to_owned()),
    );
    forms.push(STANDARD.encode(trimmed));
    forms.push(STANDARD_NO_PAD.encode(trimmed));
    forms.push(URL_SAFE_NO_PAD.encode(trimmed));
    forms.push(utf8_percent_encode(trimmed, NON_ALPHANUMERIC).to_string());
    forms
}

#[cfg(test)]
mod tests {
    use proptest::prelude::*;

    use super::*;

    #[test]
    fn hides_a_secret_and_its_encodings() {
        let mut masker = Masker::new();
        masker.add("s3cr3t/value+1");
        let text = format!(
            "plain s3cr3t/value+1 b64 {} url {}",
            STANDARD.encode("s3cr3t/value+1"),
            utf8_percent_encode("s3cr3t/value+1", NON_ALPHANUMERIC)
        );
        assert_eq!(masker.apply(&text), "plain *** b64 *** url ***");
    }

    #[test]
    fn hides_each_line_of_a_multi_line_secret() {
        let mut masker = Masker::new();
        masker.add("-----BEGIN KEY-----\nabcdefgh\n-----END KEY-----\n");
        assert_eq!(masker.apply("line: abcdefgh"), "line: ***");
        assert_eq!(masker.apply("-----END KEY-----"), "***");
    }

    #[test]
    fn leaves_very_short_values_alone() {
        let mut masker = Masker::new();
        masker.add("ab");
        assert_eq!(masker.apply("about"), "about");
    }

    #[test]
    fn hides_the_longer_of_two_overlapping_values_whole() {
        let mut masker = Masker::new();
        masker.add("token");
        masker.add("token-and-more");
        assert_eq!(masker.apply("x token-and-more y"), "x *** y");
    }

    #[test]
    fn tells_whether_a_text_reveals_a_secret() {
        let mut masker = Masker::new();
        masker.add("deploy-key-1");
        assert!(masker.reveals_secret("prefix deploy-key-1"));
        assert!(!masker.reveals_secret("nothing here"));
    }

    proptest! {
        #[test]
        fn no_masked_line_contains_a_secret(
            secret in "[A-Za-z0-9+/=_-]{4,40}",
            before in "[ -~]{0,30}",
            after in "[ -~]{0,30}",
        ) {
            let mut masker = Masker::new();
            masker.add(&secret);
            let masked = masker.apply(&format!("{before}{secret}{after}"));
            prop_assert!(!masked.contains(&secret));
        }

        #[test]
        fn text_without_secrets_is_unchanged(text in "[a-z ]{0,60}") {
            let mut masker = Masker::new();
            masker.add("ZZZZ-9999");
            prop_assert_eq!(masker.apply(&text), text);
        }
    }
}
