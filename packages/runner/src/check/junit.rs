//! node's junit reporter output, read as the harness's `ci.parse_junit` reads it.

use std::collections::BTreeSet;
use std::path::Path;

use roxmltree::{Document, Node, ParsingOptions};

use super::paths;

/// Characters of a failure message kept (`[:800]` in `ci.py`).
const MAX_MESSAGE_CHARS: usize = 800;
/// Characters of a failure body kept for stack-trace scanning (`[:6000]` in `ci.py`).
const MAX_BODY_CHARS: usize = 6000;

/// One failed test case.
#[derive(Debug, Clone, PartialEq, Eq)]
pub(crate) struct JunitFailure {
    /// The test file relative to the checkout (`""` when the reporter gave none).
    pub(crate) file: String,
    pub(crate) name: String,
    pub(crate) message: String,
    /// The failure text, scanned for stack frames and then dropped.
    pub(crate) body: String,
}

/// Every test case in a report.
#[derive(Debug, Clone, Default, PartialEq, Eq)]
pub(crate) struct JunitSummary {
    pub(crate) failing: Vec<JunitFailure>,
    /// Files with a passing case, sorted.
    pub(crate) passing_files: Vec<String>,
    pub(crate) tests: usize,
}

/// Parses a junit report; `None` when it is not well-formed XML (a crash or a timeout before the
/// reporter finished, which `ci.py` reports as `failing_files: None`).
pub(crate) fn parse_junit(xml: &str, root_real: &Path) -> Option<JunitSummary> {
    // ElementTree accepts a DOCTYPE; so must this parser, or a report would read as a crash.
    let options = ParsingOptions {
        allow_dtd: true,
        ..ParsingOptions::default()
    };
    let document = Document::parse_with_options(xml, options).ok()?;
    let mut failing = Vec::new();
    let mut passing_files = BTreeSet::new();
    let mut tests = 0;
    for case in document
        .descendants()
        .filter(|node| node.has_tag_name("testcase"))
    {
        tests += 1;
        let file = case_file(case.attribute("file").unwrap_or_default(), root_real);
        match child(case, "failure").or_else(|| child(case, "error")) {
            Some(failure) => failing.push(JunitFailure {
                file,
                name: case.attribute("name").unwrap_or_default().to_owned(),
                message: failure_message(failure),
                body: first_chars(failure.text().unwrap_or_default(), MAX_BODY_CHARS),
            }),
            None if !file.is_empty() => {
                passing_files.insert(file);
            }
            None => {}
        }
    }
    Some(JunitSummary {
        failing,
        passing_files: passing_files.into_iter().collect(),
        tests,
    })
}

fn child<'a, 'input>(node: Node<'a, 'input>, tag: &str) -> Option<Node<'a, 'input>> {
    node.children().find(|child| child.has_tag_name(tag))
}

/// The case's file relative to the checkout, both sides through `realpath` as in `ci.py`.
fn case_file(raw: &str, root_real: &Path) -> String {
    let path = raw.strip_prefix("file://").unwrap_or(raw);
    if path.is_empty() {
        return String::new();
    }
    paths::relative_to(&paths::real_path(Path::new(path)), root_real)
}

/// `(fail.get("message") or (fail.text or "")).strip()[:800]`.
fn failure_message(failure: Node<'_, '_>) -> String {
    let message = failure
        .attribute("message")
        .filter(|message| !message.is_empty())
        .or_else(|| failure.text())
        .unwrap_or_default();
    first_chars(
        message.trim_matches(is_python_whitespace),
        MAX_MESSAGE_CHARS,
    )
}

fn first_chars(text: &str, limit: usize) -> String {
    text.chars().take(limit).collect()
}

/// `str.strip()`'s whitespace: Unicode whitespace plus the ASCII separators `\x1c`..`\x1f`.
fn is_python_whitespace(c: char) -> bool {
    c.is_whitespace() || ('\u{1c}'..='\u{1f}').contains(&c)
}

#[cfg(test)]
mod tests {
    #![allow(clippy::unwrap_used, clippy::expect_used)] // tests fail loudly by design

    use proptest::prelude::*;

    use super::*;

    fn summary(xml: &str) -> JunitSummary {
        parse_junit(xml, Path::new("/w")).unwrap()
    }

    #[test]
    fn matches_the_harness_unit_test() {
        let xml = r#"<testsuites><testcase name="a" file="/w/test/a.test.ts"/><testcase name="b" file="/w/test/b.test.ts"><failure message="boom"/></testcase></testsuites>"#;

        let parsed = summary(xml);

        assert_eq!(parsed.tests, 2);
        assert_eq!(parsed.passing_files, ["test/a.test.ts"]);
        assert_eq!(parsed.failing[0].file, "test/b.test.ts");
        assert_eq!(parsed.failing[0].message, "boom");
    }

    #[test]
    fn falls_back_to_the_failure_text_and_strips_it() {
        let xml = "<testsuites><testcase name=\"t\" file=\"file:///w/x.test.ts\"><error message=\"\">\n  [Error: test failed]\n\t\t</error></testcase></testsuites>";

        let failure = &summary(xml).failing[0];

        assert_eq!(failure.message, "[Error: test failed]");
        assert_eq!(failure.body, "\n  [Error: test failed]\n\t\t");
        assert_eq!(failure.file, "x.test.ts");
    }

    #[test]
    fn decodes_escaped_newlines_in_messages() {
        let xml = r#"<testsuites><testcase name="t" file="/w/a.test.ts"><failure message="Expected values to be strictly equal:&#10;&#10;50 !== 100&#10;">body</failure></testcase></testsuites>"#;

        assert_eq!(
            summary(xml).failing[0].message,
            "Expected values to be strictly equal:\n\n50 !== 100"
        );
    }

    #[test]
    fn truncates_messages_by_characters_not_bytes() {
        let long = "é".repeat(900);
        let xml = format!(
            r#"<testsuites><testcase name="t" file="/w/a.ts"><failure message="{long}"/></testcase></testsuites>"#
        );

        assert_eq!(summary(&xml).failing[0].message.chars().count(), 800);
    }

    #[test]
    fn a_case_without_a_file_counts_but_is_not_a_passing_file() {
        let parsed = summary(r#"<testsuites><testcase name="t"/></testsuites>"#);

        assert_eq!(parsed.tests, 1);
        assert!(parsed.passing_files.is_empty());
    }

    #[test]
    fn a_truncated_report_reads_as_a_crash() {
        assert_eq!(
            parse_junit("<testsuites><testcase name=", Path::new("/w")),
            None
        );
        assert_eq!(parse_junit("", Path::new("/w")), None);
    }

    proptest! {
        #[test]
        fn parsing_arbitrary_text_never_panics(text in "\\PC{0,300}") {
            let _parsed = parse_junit(&text, Path::new("/w"));
        }

        #[test]
        fn counts_every_case_and_splits_pass_from_fail(
            cases in proptest::collection::vec(("[a-z]{1,8}", any::<bool>()), 0..20),
        ) {
            let body = cases.iter().map(|(name, fails)| {
                let failure = if *fails { "<failure message=\"x\"/>" } else { "" };
                format!("<testcase name=\"{name}\" file=\"/w/{name}.test.ts\">{failure}</testcase>")
            }).collect::<Vec<_>>().concat();
            let parsed = summary(&format!("<testsuites><testsuite>{body}</testsuite></testsuites>"));

            prop_assert_eq!(parsed.tests, cases.len());
            prop_assert_eq!(parsed.failing.len(), cases.iter().filter(|(_, fails)| *fails).count());
        }
    }
}
