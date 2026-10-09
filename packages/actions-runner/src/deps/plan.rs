//! Where the dependency cache goes into a job (docs/claude-opus/27 §"Built").
//!
//! The cache restores `node_modules` into a tmpfs after `actions/checkout` (which would delete
//! anything already in the workspace) and saves it at the end, so it runs as two steps of the
//! job itself. The runner adds them to the job act runs, triggered by what workflows already
//! say, so a GitHub workflow benefits unchanged:
//!
//! | The job has | Becomes |
//! |---|---|
//! | `actions/setup-node` with `cache: npm\|pnpm\|yarn` | the same step without `cache:`, then the restore step |
//! | `actions/cache` (or `actions/cache/restore`) whose every `path` is `node_modules` or a package-manager store | the restore step in its place, same `id` (`cache-hit` is set on an exact hit) |
//! | `uses: beanstalk/deps-cache@v1` | the restore step in its place (the opt-in, with `working-directory`) |
//!
//! Only the first trigger counts. The save step is appended last with `if: success()`. Every
//! original step without an `id` gets its index as its id, so act's step ids (which are the
//! index when there is no id) still match the control plane's step numbers after the insert.
//! The repository or org variable `BEANSTALK_DEPS_CACHE=off` turns all of this off.

use std::sync::LazyLock;

use regex::Regex;
use yaml_rust2::Yaml;
use yaml_rust2::yaml::{Array, Hash};

/// The restore step's act id when it does not take over a step's id.
pub const RESTORE_STEP_ID: &str = "__beanstalk_deps_restore";
/// The save step's act id.
pub const SAVE_STEP_ID: &str = "__beanstalk_deps_save";
/// Where the image keeps the cache tool (and a `zstd` for Docker-mode job containers).
pub const TOOL_DIR: &str = "/opt/beanstalk/bin";
/// The secret the steps read the job's cache bearer from.
pub const TOKEN_SECRET: &str = "BEANSTALK_DEPS_TOKEN";
/// The virtual host the tool talks to (the container's outbound handler).
pub const DEPS_URL: &str = "http://deps.internal";

/// What turned the cache on, for the job's log.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum Trigger {
    SetupNode { package_manager: String },
    ActionsCache,
    Native,
}

/// The cache steps added to one job.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct DepsPlan {
    pub trigger: Trigger,
    /// The install directory, relative to the workspace (`.` for the root).
    pub install_dir: String,
    /// Install flags that change the tree, normalised (part of the snapshot key).
    pub flags: String,
    /// The tmpfs size the restore step mounts (the executor's `DEPS_TMPFS_MAX_BYTES`).
    pub tmpfs_max_bytes: u64,
    /// The job installs with `npm ci`, which deletes `node_modules` first: a partial snapshot
    /// is not worth downloading.
    pub wipes_tree: bool,
}

/// Adds the cache steps to `job` when one of its steps asks for a dependency cache.
pub fn apply(job: &Hash, tmpfs_max_bytes: u64) -> Option<(Hash, DepsPlan)> {
    let steps = job.get(&key("steps")).and_then(Yaml::as_vec)?;
    let (index, found) = steps
        .iter()
        .enumerate()
        .find_map(|(index, step)| step.as_hash().and_then(detect).map(|found| (index, found)))?;
    let (flags, wipes_tree) = install_flags(steps);
    let plan = DepsPlan {
        trigger: found.trigger.clone(),
        install_dir: found.install_dir.clone(),
        flags,
        tmpfs_max_bytes,
        wipes_tree,
    };
    let mut rewritten: Array = Vec::with_capacity(steps.len() + 2);
    for (position, step) in steps.iter().enumerate() {
        let step = with_index_id(step, position);
        if position != index {
            rewritten.push(step);
            continue;
        }
        match found.placement {
            Placement::After => {
                rewritten.push(without_cache_inputs(&step));
                rewritten.push(restore_step(&plan, None, None));
            }
            Placement::Replace => {
                let original = step.as_hash();
                let id = original.and_then(|step| step.get(&key("id"))).cloned();
                let condition = original.and_then(|step| step.get(&key("if"))).cloned();
                rewritten.push(restore_step(&plan, id, condition));
            }
        }
    }
    rewritten.push(save_step());
    let mut out = job.clone();
    out.insert(key("steps"), Yaml::Array(rewritten));
    Some((out, plan))
}

/// Whether the job's variables turn the cache off (`BEANSTALK_DEPS_CACHE=off`).
pub fn is_switched_off(value: Option<&str>) -> bool {
    value.is_some_and(|value| {
        matches!(
            value.trim().to_ascii_lowercase().as_str(),
            "off" | "false" | "0" | "no" | "disabled"
        )
    })
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum Placement {
    After,
    Replace,
}

#[derive(Debug, Clone)]
struct Found {
    trigger: Trigger,
    install_dir: String,
    placement: Placement,
}

fn detect(step: &Hash) -> Option<Found> {
    let uses = step.get(&key("uses")).and_then(Yaml::as_str)?;
    let action = uses
        .split('@')
        .next()
        .unwrap_or_default()
        .to_ascii_lowercase();
    let inputs = step.get(&key("with")).and_then(Yaml::as_hash);
    let input = |name: &str| inputs.and_then(|with| with.get(&key(name))).and_then(text);
    match action.as_str() {
        "actions/setup-node" => {
            let manager = input("cache")?.trim().to_ascii_lowercase();
            if !matches!(manager.as_str(), "npm" | "pnpm" | "yarn") {
                return None;
            }
            let install_dir = input("cache-dependency-path")
                .and_then(|paths| {
                    paths
                        .lines()
                        .map(str::trim)
                        .find(|line| !line.is_empty())
                        .map(str::to_owned)
                })
                .map_or_else(|| ".".to_owned(), |path| parent_dir(&path));
            Some(Found {
                trigger: Trigger::SetupNode {
                    package_manager: manager,
                },
                install_dir,
                placement: Placement::After,
            })
        }
        "actions/cache" | "actions/cache/restore" => {
            let install_dir = node_install_dir(&input("path")?)?;
            Some(Found {
                trigger: Trigger::ActionsCache,
                install_dir,
                placement: Placement::Replace,
            })
        }
        "beanstalk/deps-cache" => Some(Found {
            trigger: Trigger::Native,
            install_dir: input("working-directory")
                .map_or_else(|| ".".to_owned(), |dir| clean_dir(&dir)),
            placement: Placement::Replace,
        }),
        _ => None,
    }
}

/// The install directory when every path of an `actions/cache` step is a `node_modules`
/// directory or a package-manager store; None when any path is something else.
fn node_install_dir(paths: &str) -> Option<String> {
    let entries: Vec<&str> = paths
        .lines()
        .map(str::trim)
        .filter(|line| !line.is_empty() && !line.starts_with('!'))
        .collect();
    if entries.is_empty() {
        return None;
    }
    let mut install_dir: Option<String> = None;
    for entry in entries {
        if is_store_path(entry) {
            continue;
        }
        let trimmed = entry.trim_end_matches('/');
        let parent = trimmed.strip_suffix("node_modules")?;
        if !(parent.is_empty() || parent.ends_with('/')) {
            return None;
        }
        let dir = if parent.contains('*') {
            ".".to_owned()
        } else {
            parent_dir(trimmed)
        };
        install_dir.get_or_insert(dir);
    }
    Some(install_dir.unwrap_or_else(|| ".".to_owned()))
}

fn is_store_path(path: &str) -> bool {
    const STORES: [&str; 7] = [
        "~/.npm",
        "~/.pnpm-store",
        "~/.local/share/pnpm/store",
        "~/.cache/yarn",
        "~/.yarn/berry/cache",
        ".yarn/cache",
        ".pnpm-store",
    ];
    let path = path.trim_end_matches('/');
    STORES
        .iter()
        .any(|store| path == *store || path.starts_with(&format!("{store}/")))
}

/// `a/b/package-lock.json` → `a/b`; `package-lock.json` → `.`.
fn parent_dir(path: &str) -> String {
    match path.trim_start_matches("./").rsplit_once('/') {
        Some((dir, _)) if !dir.is_empty() => clean_dir(dir),
        _ => ".".to_owned(),
    }
}

/// A workspace-relative directory without `./`, `..` or a leading `/`; `.` for the root.
fn clean_dir(dir: &str) -> String {
    let parts: Vec<&str> = dir
        .split('/')
        .filter(|part| !part.is_empty() && *part != "." && *part != ".." && !part.contains('$'))
        .collect();
    if parts.is_empty() {
        ".".to_owned()
    } else {
        parts.join("/")
    }
}

#[allow(clippy::expect_used)] // a constant pattern, checked by every test that runs it
static INSTALL: LazyLock<Regex> = LazyLock::new(|| {
    Regex::new(
        r"(?m)\b(?:npm\s+(?:ci|install|i|clean-install)|pnpm\s+(?:install|i)|yarn(?:\s+install)?|bun\s+install)\b([^\n;&|]*)",
    )
    .expect("valid install pattern")
});

/// Flags of the first install command in a `run:` step that change what gets installed, and
/// whether that command is `npm ci` (which deletes `node_modules` before installing).
fn install_flags(steps: &[Yaml]) -> (String, bool) {
    const IGNORED: [&str; 10] = [
        "--no-audit",
        "--no-fund",
        "--prefer-offline",
        "--silent",
        "--quiet",
        "--frozen-lockfile",
        "--immutable",
        "--no-progress",
        "--progress=false",
        "--loglevel",
    ];
    let Some(captures) = steps
        .iter()
        .filter_map(|step| step["run"].as_str())
        .find_map(|script| INSTALL.captures(script))
    else {
        return (String::new(), false);
    };
    let command = captures.get(0).map_or("", |m| m.as_str());
    let wipes_tree = ["npm ci", "npm clean-install"].iter().any(|ci| {
        command
            .split_whitespace()
            .take(2)
            .collect::<Vec<_>>()
            .join(" ")
            == *ci
    });
    let mut flags: Vec<&str> = captures
        .get(1)
        .map_or("", |m| m.as_str())
        .split_whitespace()
        .filter(|word| word.starts_with('-'))
        .filter(|word| !IGNORED.iter().any(|ignored| word.starts_with(ignored)))
        .collect();
    flags.sort_unstable();
    flags.dedup();
    (flags.join(" "), wipes_tree)
}

fn with_index_id(step: &Yaml, position: usize) -> Yaml {
    let Some(hash) = step.as_hash() else {
        return step.clone();
    };
    if hash.contains_key(&key("id")) {
        return step.clone();
    }
    let mut out = Hash::new();
    out.insert(key("id"), Yaml::String(position.to_string()));
    for (name, value) in hash {
        out.insert(name.clone(), value.clone());
    }
    Yaml::Hash(out)
}

fn without_cache_inputs(step: &Yaml) -> Yaml {
    let Some(hash) = step.as_hash() else {
        return step.clone();
    };
    let mut out = hash.clone();
    if let Some(Yaml::Hash(inputs)) = hash.get(&key("with")) {
        let kept: Hash = inputs
            .iter()
            .filter(|(name, _)| {
                name.as_str()
                    .is_none_or(|name| name != "cache" && name != "cache-dependency-path")
            })
            .map(|(name, value)| (name.clone(), value.clone()))
            .collect();
        out.insert(key("with"), Yaml::Hash(kept));
    }
    Yaml::Hash(out)
}

fn restore_step(plan: &DepsPlan, id: Option<Yaml>, condition: Option<Yaml>) -> Yaml {
    let mut step = Hash::new();
    step.insert(key("id"), id.unwrap_or_else(|| key(RESTORE_STEP_ID)));
    step.insert(key("name"), key("Restore dependencies (Beanstalk cache)"));
    if let Some(condition) = condition {
        step.insert(key("if"), condition);
    }
    step.insert(key("shell"), key("bash"));
    step.insert(key("working-directory"), key("${{ github.workspace }}"));
    step.insert(
        key("run"),
        key(&format!("{TOOL_DIR}/beanstalk-deps restore")),
    );
    let mut env = tool_env();
    env.insert(key("BEANSTALK_DEPS_DIR"), key(&plan.install_dir));
    env.insert(key("BEANSTALK_DEPS_FLAGS"), key(&plan.flags));
    env.insert(
        key("BEANSTALK_DEPS_TMPFS_MAX_BYTES"),
        key(&plan.tmpfs_max_bytes.to_string()),
    );
    if plan.wipes_tree {
        env.insert(key("BEANSTALK_DEPS_WIPES_TREE"), key("1"));
    }
    step.insert(key("env"), Yaml::Hash(env));
    Yaml::Hash(step)
}

fn save_step() -> Yaml {
    let mut step = Hash::new();
    step.insert(key("id"), key(SAVE_STEP_ID));
    step.insert(key("name"), key("Save dependencies (Beanstalk cache)"));
    step.insert(key("if"), key("success()"));
    step.insert(key("shell"), key("bash"));
    step.insert(key("working-directory"), key("${{ github.workspace }}"));
    step.insert(key("run"), key(&format!("{TOOL_DIR}/beanstalk-deps save")));
    step.insert(key("env"), Yaml::Hash(tool_env()));
    Yaml::Hash(step)
}

fn tool_env() -> Hash {
    let mut env = Hash::new();
    env.insert(
        key(TOKEN_SECRET),
        key(&format!("${{{{ secrets.{TOKEN_SECRET} }}}}")),
    );
    env.insert(key("BEANSTALK_DEPS_URL"), key(DEPS_URL));
    env
}

fn text(value: &Yaml) -> Option<String> {
    match value {
        Yaml::String(text) | Yaml::Real(text) => Some(text.clone()),
        _ => None,
    }
}

fn key(name: &str) -> Yaml {
    Yaml::String(name.to_owned())
}

#[cfg(test)]
mod tests {
    use yaml_rust2::YamlLoader;

    use super::*;

    fn job(yaml: &str) -> Hash {
        let docs = YamlLoader::load_from_str(yaml).unwrap_or_default();
        docs.into_iter()
            .next()
            .and_then(Yaml::into_hash)
            .unwrap_or_default()
    }

    fn steps(job: &Hash) -> Vec<Yaml> {
        job.get(&key("steps"))
            .and_then(Yaml::as_vec)
            .cloned()
            .unwrap_or_default()
    }

    #[test]
    fn setup_node_with_cache_gets_a_restore_step_after_it_and_a_save_step_last() {
        let job = job(r"
steps:
  - uses: actions/checkout@v4
  - uses: actions/setup-node@v4
    with: { node-version: 24, cache: npm, cache-dependency-path: app/package-lock.json }
  - run: npm ci --ignore-scripts --no-audit
  - run: npm test
");
        let (rewritten, plan) = apply(&job, GIB).unwrap_or_else(|| (Hash::new(), plan_stub()));
        assert_eq!(plan.install_dir, "app");
        assert_eq!(plan.flags, "--ignore-scripts");
        assert!(plan.wipes_tree);
        let steps = steps(&rewritten);
        let ids: Vec<&str> = steps
            .iter()
            .filter_map(|step| step["id"].as_str())
            .collect();
        assert_eq!(ids, ["0", "1", RESTORE_STEP_ID, "2", "3", SAVE_STEP_ID]);
        assert!(steps[1]["with"]["cache"].is_badvalue());
        assert_eq!(steps[1]["with"]["node-version"].as_i64(), Some(24));
        assert_eq!(steps[5]["if"].as_str(), Some("success()"));
    }

    #[test]
    fn actions_cache_of_node_modules_is_replaced_in_place_keeping_its_id() {
        let job = job(r"
steps:
  - uses: actions/checkout@v4
  - id: deps
    uses: actions/cache@v4
    with:
      path: |
        node_modules
        ~/.npm
      key: x
  - if: steps.deps.outputs.cache-hit != 'true'
    run: npm ci
");
        let (rewritten, plan) = apply(&job, GIB).unwrap_or_else(|| (Hash::new(), plan_stub()));
        assert_eq!(plan.trigger, Trigger::ActionsCache);
        let steps = steps(&rewritten);
        assert_eq!(steps[1]["id"].as_str(), Some("deps"));
        assert!(
            steps[1]["run"]
                .as_str()
                .is_some_and(|run| run.ends_with("restore"))
        );
        assert_eq!(steps.len(), 4);
    }

    #[test]
    fn leaves_jobs_without_a_dependency_cache_alone() {
        let plain = job(
            "steps:\n  - uses: actions/setup-node@v4\n    with: { node-version: 24 }\n  - run: npm ci\n",
        );
        assert!(apply(&plain, GIB).is_none());
        let other = job("steps:\n  - uses: actions/cache@v4\n    with: { path: dist, key: k }\n");
        assert!(apply(&other, GIB).is_none());
    }

    #[test]
    fn the_native_step_names_its_directory() {
        let native = job(
            "steps:\n  - uses: beanstalk/deps-cache@v1\n    with: { working-directory: ./web/../web }\n",
        );
        let plan = apply(&native, GIB).map(|(_, plan)| plan);
        assert_eq!(
            plan.map(|plan| plan.install_dir),
            Some("web/web".to_owned())
        );
    }

    #[test]
    fn reads_the_install_directory_of_cache_paths() {
        assert_eq!(node_install_dir("node_modules"), Some(".".to_owned()));
        assert_eq!(
            node_install_dir("packages/a/node_modules/"),
            Some("packages/a".to_owned())
        );
        assert_eq!(node_install_dir("**/node_modules"), Some(".".to_owned()));
        assert_eq!(node_install_dir("~/.npm"), Some(".".to_owned()));
        assert_eq!(node_install_dir("node_modules\ndist"), None);
        assert_eq!(node_install_dir("my_node_modules"), None);
    }

    #[test]
    fn the_switch_reads_off_values() {
        assert!(is_switched_off(Some("OFF")));
        assert!(is_switched_off(Some(" false ")));
        assert!(!is_switched_off(Some("on")));
        assert!(!is_switched_off(None));
    }

    fn plan_stub() -> DepsPlan {
        DepsPlan {
            trigger: Trigger::Native,
            install_dir: String::new(),
            flags: String::new(),
            tmpfs_max_bytes: GIB,
            wipes_tree: false,
        }
    }

    const GIB: u64 = 1 << 30;
}
