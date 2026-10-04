//! Integration operations: squash, compose, revert and update-ref (plan §3), with the semantics of
//! the harness's `Git.squash_onto`, the queue's `build_batch` and the beanstalk policy's revert.

use crate::error::{Error, Result};
use crate::git::{
    CommitSha, MergeRules, MergeSetup, RefName, RefUpdate, RefUpdateOutcome, Remote, Repo,
    ThreeWay, TreeMerge, TrunkCache,
};
use crate::workspace::Workspace;

/// A change to land: a named ref on a remote (usually the task's fork).
#[derive(Debug, Clone)]
pub(crate) struct ChangeSource {
    pub(crate) remote: Remote,
    pub(crate) reference: RefName,
    /// The commit the task started from. Optional: when given, the response carries the
    /// change's own write set (`base..head`), as the harness logs on `task.commit`. The merge
    /// itself always uses `git merge-base head onto`, as every harness policy does.
    pub(crate) base: Option<CommitSha>,
}

#[derive(Debug, Clone)]
pub(crate) struct SquashRequest {
    pub(crate) trunk: Remote,
    pub(crate) onto: CommitSha,
    pub(crate) change: ChangeSource,
    pub(crate) message: String,
    pub(crate) rules: MergeRules,
}

#[derive(Debug, Clone)]
pub(crate) struct ComposeItem {
    pub(crate) task: String,
    pub(crate) change: ChangeSource,
    pub(crate) message: String,
}

#[derive(Debug, Clone)]
pub(crate) struct ComposeRequest {
    pub(crate) trunk: Remote,
    pub(crate) base: CommitSha,
    pub(crate) items: Vec<ComposeItem>,
    pub(crate) rules: MergeRules,
}

#[derive(Debug, Clone)]
pub(crate) struct RevertRequest {
    pub(crate) trunk: Remote,
    pub(crate) onto: CommitSha,
    pub(crate) commit: CommitSha,
    pub(crate) message: String,
    pub(crate) rules: MergeRules,
}

#[derive(Debug, Clone)]
pub(crate) struct UpdateRefRequest {
    pub(crate) trunk: Remote,
    pub(crate) update: RefUpdate,
}

/// The result of landing one change as a single commit.
#[derive(Debug, Clone, PartialEq, Eq)]
pub(crate) enum Landing {
    /// `sha` has the target as its only parent; `files` changed between the two.
    Clean { sha: CommitSha, files: Vec<String> },
    /// Nothing was committed; `files` are the conflicted paths.
    Conflict { files: Vec<String> },
}

impl Landing {
    pub(crate) fn sha(&self) -> Option<&CommitSha> {
        match self {
            Self::Clean { sha, .. } => Some(sha),
            Self::Conflict { .. } => None,
        }
    }
}

/// A squashed change and the commits that explain it.
#[derive(Debug, Clone)]
pub(crate) struct Squashed {
    pub(crate) landing: Landing,
    pub(crate) change_head: CommitSha,
    pub(crate) merge_base: CommitSha,
    pub(crate) change_files: Option<Vec<String>>,
}

#[derive(Debug, Clone)]
pub(crate) struct ComposedItem {
    pub(crate) task: String,
    pub(crate) squashed: Squashed,
}

#[derive(Debug, Clone)]
pub(crate) struct Composition {
    /// The last clean commit, or the base when nothing landed.
    pub(crate) head: CommitSha,
    pub(crate) items: Vec<ComposedItem>,
}

/// Squashes a change onto `onto` and publishes a clean result as a candidate ref.
///
/// # Errors
///
/// Unknown commits or refs, remote failures, and git failures.
pub(crate) async fn squash(workspace: &Workspace, request: &SquashRequest) -> Result<Squashed> {
    let cache = workspace.open_trunk(&request.trunk).await?;
    cache.ensure_commits(&[&request.onto]).await?;
    let job = workspace.new_job().await?;
    let setup = request.rules.prepare(job.path()).await?;
    let step = SquashStep {
        onto: &request.onto,
        change: &request.change,
        message: &request.message,
    };
    let squashed = squash_change(&cache, &setup, step).await?;
    if let Some(sha) = squashed.landing.sha() {
        cache.push_candidates(&[sha]).await?;
    }
    job.remove().await;
    Ok(squashed)
}

/// Stacks squash commits for each item onto `base` in order; a conflicting item is skipped and
/// the next one goes onto the last clean commit (the queue policy's batch build).
///
/// # Errors
///
/// As [`squash`]; an item whose ref cannot be fetched fails the whole composition.
pub(crate) async fn compose(
    workspace: &Workspace,
    request: &ComposeRequest,
) -> Result<Composition> {
    let cache = workspace.open_trunk(&request.trunk).await?;
    cache.ensure_commits(&[&request.base]).await?;
    let job = workspace.new_job().await?;
    let setup = request.rules.prepare(job.path()).await?;
    let mut head = request.base.clone();
    let mut items = Vec::with_capacity(request.items.len());
    for item in &request.items {
        let step = SquashStep {
            onto: &head,
            change: &item.change,
            message: &item.message,
        };
        let squashed = squash_change(&cache, &setup, step).await?;
        if let Some(sha) = squashed.landing.sha() {
            head = sha.clone();
        }
        items.push(ComposedItem {
            task: item.task.clone(),
            squashed,
        });
    }
    let clean: Vec<&CommitSha> = items
        .iter()
        .filter_map(|item| item.squashed.landing.sha())
        .collect();
    cache.push_candidates(&clean).await?;
    job.remove().await;
    Ok(Composition { head, items })
}

/// Reverts `commit` on top of `onto`: a 3-way merge with the commit as base and its first parent
/// as the other side (the beanstalk policy's `revert_culprit` and its probes).
///
/// # Errors
///
/// [`Error::RootCommit`] for a commit without a parent; otherwise as [`squash`].
pub(crate) async fn revert(workspace: &Workspace, request: &RevertRequest) -> Result<Landing> {
    let cache = workspace.open_trunk(&request.trunk).await?;
    cache
        .ensure_commits(&[&request.onto, &request.commit])
        .await?;
    let repo = cache.repo();
    let parent = repo
        .first_parent(&request.commit)
        .await?
        .ok_or_else(|| Error::RootCommit {
            sha: request.commit.to_string(),
        })?;
    let job = workspace.new_job().await?;
    let setup = request.rules.prepare(job.path()).await?;
    let three_way = ThreeWay {
        base: &request.commit,
        ours: &request.onto,
        theirs: &parent,
    };
    let merged = repo.merge_tree(three_way, &setup).await?;
    let commit = NewCommit {
        parent: &request.onto,
        message: &request.message,
    };
    let landing = land(repo, merged, commit).await?;
    if let Some(sha) = landing.sha() {
        cache.push_candidates(&[sha]).await?;
    }
    job.remove().await;
    Ok(landing)
}

/// Moves a trunk ref under a lease.
///
/// # Errors
///
/// As [`TrunkCache::update_ref`].
pub(crate) async fn update_ref(
    workspace: &Workspace,
    request: &UpdateRefRequest,
) -> Result<RefUpdateOutcome> {
    let cache = workspace.open_trunk(&request.trunk).await?;
    cache.update_ref(&request.update).await
}

/// One change to land on a target.
#[derive(Debug, Clone, Copy)]
struct SquashStep<'a> {
    onto: &'a CommitSha,
    change: &'a ChangeSource,
    message: &'a str,
}

/// A commit to create on top of `parent`.
#[derive(Debug, Clone, Copy)]
struct NewCommit<'a> {
    parent: &'a CommitSha,
    message: &'a str,
}

/// Fetches the change and lands `merge_base(head, onto)..head` on `onto` as one commit
/// (`gitops.squash_onto` after `merge_base(change_head, target)`).
async fn squash_change(
    cache: &TrunkCache<'_>,
    setup: &MergeSetup,
    step: SquashStep<'_>,
) -> Result<Squashed> {
    let change_head = cache
        .fetch_change(&step.change.remote, &step.change.reference)
        .await?;
    let change_files = change_files(cache, step.change, &change_head).await?;
    let repo = cache.repo();
    let merge_base = repo.merge_base(&change_head, step.onto).await?;
    let three_way = ThreeWay {
        base: &merge_base,
        ours: step.onto,
        theirs: &change_head,
    };
    let merged = repo.merge_tree(three_way, setup).await?;
    let commit = NewCommit {
        parent: step.onto,
        message: step.message,
    };
    Ok(Squashed {
        landing: land(repo, merged, commit).await?,
        change_head,
        merge_base,
        change_files,
    })
}

async fn change_files(
    cache: &TrunkCache<'_>,
    change: &ChangeSource,
    head: &CommitSha,
) -> Result<Option<Vec<String>>> {
    let Some(base) = &change.base else {
        return Ok(None);
    };
    cache.ensure_commits(&[base]).await?;
    cache.repo().changed_files(base, head).await.map(Some)
}

/// Commits a clean merge with `commit.parent` as its only parent; a conflict commits nothing.
async fn land(repo: &Repo<'_>, merged: TreeMerge, commit: NewCommit<'_>) -> Result<Landing> {
    match merged {
        TreeMerge::Conflicted(files) => Ok(Landing::Conflict { files }),
        TreeMerge::Clean(tree) => {
            let sha = repo
                .commit_tree(&tree, commit.parent, commit.message)
                .await?;
            let files = repo.changed_files(commit.parent, &sha).await?;
            Ok(Landing::Clean { sha, files })
        }
    }
}
