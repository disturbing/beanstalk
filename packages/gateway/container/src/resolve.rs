//! Conflict tiers of a squash. git's line merge runs first; when it conflicts, the structural
//! tier retries the merge with Mergiraf on exactly the conflicted paths and keeps the result only
//! when it is clean and free of conflict markers. A conflict that remains goes back to the agent
//! with its hunks: both sides of each conflict block from git's merge.

use std::path::Path;

use crate::error::Result;
use crate::git::{MergeRules, MergeSetup, Repo, ThreeWay, TreeId, TreeMerge};

/// Conflict blocks returned with a conflict; the agent's prompt shows fewer still.
const MAX_HUNKS: usize = 8;
/// Characters kept of each side of a hunk.
const MAX_SIDE_CHARS: usize = 2000;
const TRUNCATED: &str = "\n[truncated]";
const MARKER_LEN: usize = 7;

/// Which tier produced a clean merge.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(crate) enum Resolution {
    /// git's line merge (with union paths and any requested driver).
    Textual,
    /// Mergiraf, on paths git's merge left conflicted.
    Structural,
}

/// One conflict block: the target's side (`onto`, the landed line) and the change's side.
#[derive(Debug, Clone, PartialEq, Eq)]
pub(crate) struct ConflictHunk {
    pub(crate) path: String,
    pub(crate) onto: String,
    pub(crate) change: String,
}

/// What a merge needs to run its tiers.
#[derive(Debug, Clone, Copy)]
pub(crate) struct MergeTiers<'a> {
    pub(crate) rules: &'a MergeRules,
    pub(crate) setup: &'a MergeSetup,
    /// The request's scratch directory, for the retry's attributes file.
    pub(crate) scratch: &'a Path,
}

/// A merge and the tier that decided it.
#[derive(Debug)]
pub(crate) struct TieredMerge {
    pub(crate) merged: TreeMerge,
    pub(crate) resolution: Resolution,
}

/// Merges with git, then, on a conflict, retries the conflicted paths structurally.
///
/// # Errors
///
/// git failures, and [`Error::Io`](crate::error::Error::Io) when the retry's attributes file
/// cannot be written.
pub(crate) async fn merge(
    repo: &Repo<'_>,
    three_way: ThreeWay<'_>,
    tiers: MergeTiers<'_>,
) -> Result<TieredMerge> {
    let merged = repo.merge_tree(three_way, tiers.setup).await?;
    let textual = |merged| TieredMerge {
        merged,
        resolution: Resolution::Textual,
    };
    let TreeMerge::Conflicted { files, .. } = &merged else {
        return Ok(textual(merged));
    };
    let Some(retry) = tiers.rules.structural_retry(files) else {
        tracing::info!(
            tier = "agent",
            ?files,
            "conflict outside the structural tier"
        );
        return Ok(textual(merged));
    };
    let structural = repo
        .merge_tree(three_way, &retry.prepare(tiers.scratch).await?)
        .await?;
    if let TreeMerge::Clean(tree) = &structural
        && !has_markers_in(repo, tree, files).await?
    {
        tracing::info!(tier = "structural", ?files, "conflict resolved");
        return Ok(TieredMerge {
            merged: structural,
            resolution: Resolution::Structural,
        });
    }
    tracing::info!(tier = "agent", ?files, "structural merge left a conflict");
    Ok(textual(merged))
}

/// The conflict blocks of `files` in a conflicted merge tree, at most [`MAX_HUNKS`].
///
/// # Errors
///
/// git failures reading the tree.
pub(crate) async fn conflict_hunks(
    repo: &Repo<'_>,
    tree: &TreeId,
    files: &[String],
) -> Result<Vec<ConflictHunk>> {
    let mut hunks = Vec::new();
    for path in files {
        if hunks.len() >= MAX_HUNKS {
            break;
        }
        if let Some(text) = repo.read_file(tree, path).await? {
            hunks.extend(parse_hunks(path, &text));
        }
    }
    hunks.truncate(MAX_HUNKS);
    Ok(hunks)
}

async fn has_markers_in(repo: &Repo<'_>, tree: &TreeId, files: &[String]) -> Result<bool> {
    for path in files {
        if let Some(text) = repo.read_file(tree, path).await?
            && has_markers(&text)
        {
            return Ok(true);
        }
    }
    Ok(false)
}

/// Whether `text` holds a conflict block's opening or closing marker line.
#[must_use]
pub(crate) fn has_markers(text: &str) -> bool {
    text.lines()
        .any(|line| is_marker(line, '<') || is_marker(line, '>'))
}

/// The conflict blocks of one file, in order. A `|||||||` base section is skipped; an
/// unterminated block is dropped.
#[must_use]
pub(crate) fn parse_hunks(path: &str, text: &str) -> Vec<ConflictHunk> {
    enum Section {
        Outside,
        Onto,
        Base,
        Change,
    }
    let mut hunks = Vec::new();
    let mut section = Section::Outside;
    let (mut onto, mut change) = (String::new(), String::new());
    for line in text.split_inclusive('\n') {
        let bare = line.trim_end_matches(['\n', '\r']);
        section = match section {
            Section::Outside if is_marker(bare, '<') => Section::Onto,
            Section::Outside => Section::Outside,
            Section::Onto | Section::Base if is_marker(bare, '|') => Section::Base,
            Section::Onto | Section::Base if bare == "=======" => Section::Change,
            Section::Onto => {
                onto.push_str(line);
                Section::Onto
            }
            Section::Base => Section::Base,
            Section::Change if is_marker(bare, '>') => {
                hunks.push(ConflictHunk {
                    path: path.to_owned(),
                    onto: truncated(&std::mem::take(&mut onto)),
                    change: truncated(&std::mem::take(&mut change)),
                });
                Section::Outside
            }
            Section::Change => {
                change.push_str(line);
                Section::Change
            }
        };
    }
    hunks
}

/// A marker line: seven `mark` characters, then the end of the line or a space and a label.
fn is_marker(line: &str, mark: char) -> bool {
    let mut chars = line.chars();
    chars
        .by_ref()
        .take(MARKER_LEN)
        .filter(|c| *c == mark)
        .count()
        == MARKER_LEN
        && matches!(chars.next(), None | Some(' '))
}

fn truncated(side: &str) -> String {
    if side.chars().count() <= MAX_SIDE_CHARS {
        return side.to_owned();
    }
    side.chars().take(MAX_SIDE_CHARS).collect::<String>() + TRUNCATED
}

#[cfg(test)]
mod tests {
    #![allow(clippy::unwrap_used, clippy::expect_used)] // tests fail loudly by design

    use proptest::prelude::*;

    use super::*;

    const CONFLICTED: &str =
        "a\n<<<<<<< ours\nx\n||||||| base\nb\n=======\ny\nz\n>>>>>>> theirs\nc\n";

    #[test]
    fn parses_both_sides_and_skips_the_base() {
        assert_eq!(
            parse_hunks("f.ts", CONFLICTED),
            [ConflictHunk {
                path: "f.ts".to_owned(),
                onto: "x\n".to_owned(),
                change: "y\nz\n".to_owned(),
            }]
        );
    }

    #[test]
    fn markers_need_seven_characters_and_a_label_or_nothing() {
        assert!(has_markers("<<<<<<< HEAD\n"));
        assert!(has_markers("a\n>>>>>>>\n"));
        assert!(!has_markers("<<<<<<<< eight\n"));
        assert!(!has_markers("=======\n"));
        assert!(!has_markers("x <<<<<<< y\n"));
    }

    #[test]
    fn unterminated_blocks_are_dropped() {
        assert!(parse_hunks("f", "<<<<<<< a\nx\n=======\ny\n").is_empty());
    }

    #[test]
    fn long_sides_are_truncated() {
        let long = "x".repeat(MAX_SIDE_CHARS + 10);
        let text = format!("<<<<<<< a\n{long}\n=======\n>>>>>>> b\n");

        let hunk = &parse_hunks("f", &text)[0];

        assert_eq!(hunk.onto.chars().count(), MAX_SIDE_CHARS + TRUNCATED.len());
        assert!(hunk.onto.ends_with(TRUNCATED));
    }

    fn plain_lines() -> impl Strategy<Value = Vec<String>> {
        prop::collection::vec("[a-z(){}; ]{0,12}", 0..4)
            .prop_map(|lines| lines.into_iter().map(|line| line + "\n").collect())
    }

    proptest! {
        #[test]
        fn recovers_every_block_between_plain_lines(
            blocks in prop::collection::vec((plain_lines(), plain_lines(), plain_lines()), 0..5),
        ) {
            let mut text = String::new();
            for (before, onto, change) in &blocks {
                text.push_str(&before.concat());
                text.push_str("<<<<<<< ours\n");
                text.push_str(&onto.concat());
                text.push_str("=======\n");
                text.push_str(&change.concat());
                text.push_str(">>>>>>> theirs\n");
            }

            let hunks = parse_hunks("p", &text);

            prop_assert_eq!(hunks.len(), blocks.len());
            for (hunk, (_, onto, change)) in hunks.iter().zip(&blocks) {
                prop_assert_eq!(&hunk.onto, &onto.concat());
                prop_assert_eq!(&hunk.change, &change.concat());
            }
            prop_assert_eq!(has_markers(&text), !blocks.is_empty());
        }
    }
}
