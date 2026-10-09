//! The workflow file, cut down to the one job this container runs.
//!
//! `act -j <job>` also runs every job the target `needs`, which would put several jobs in one
//! container and run upstream jobs twice. So the runner hands act a copy of the workflow with
//! only the target job, without its `needs:`, and with each `needs.<job>.outputs.<name>` and
//! `needs.<job>.result` inside an expression replaced by the finished job's value as a string
//! literal. The job's `outputs:` templates are kept, to be resolved from the step outputs act
//! reports (act does not print job outputs).

use std::collections::BTreeMap;
use std::sync::LazyLock;

use regex::{Captures, Regex};
use yaml_rust2::yaml::Hash;
use yaml_rust2::{Yaml, YamlEmitter, YamlLoader};

use crate::deps::plan::{self as deps_plan, DepsPlan};
use crate::error::{Error, Result};
use crate::mask::Masker;
use crate::wire::NeededJob;

/// The target job alone, ready for act, and its `outputs:` templates.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct JobWorkflow {
    pub yaml: String,
    pub output_templates: BTreeMap<String, String>,
    /// What needs Docker inside the job container (`services:`, `container:`, `docker://`
    /// steps), named for the log; empty: the job runs on the host.
    pub docker_features: Vec<String>,
    /// The `owner/repo` of every remote action the job's steps use (`actions/checkout`, ...).
    pub remote_actions: Vec<String>,
    /// The dependency cache steps added to the job, if it asked for a cache.
    pub deps: Option<DepsPlan>,
}

/// Job outputs resolved from the step outputs, and the names that could not be.
#[derive(Debug, Clone, Default, PartialEq, Eq)]
pub struct ResolvedOutputs {
    pub values: BTreeMap<String, String>,
    pub unresolved: Vec<String>,
}

#[allow(clippy::expect_used)] // a constant pattern, checked by every test that runs it
static NEEDS_REFERENCE: LazyLock<Regex> = LazyLock::new(|| {
    Regex::new(r"needs\.([A-Za-z_][A-Za-z0-9_-]*)\.(?:outputs\.([A-Za-z_][A-Za-z0-9_-]*)|result)")
        .expect("valid needs pattern")
});
#[allow(clippy::expect_used)] // a constant pattern, checked by every test that runs it
static EXPRESSION: LazyLock<Regex> =
    LazyLock::new(|| Regex::new(r"\$\{\{(.*?)\}\}").expect("valid expression pattern"));
#[allow(clippy::expect_used)] // a constant pattern, checked by every test that runs it
static STEP_OUTPUT: LazyLock<Regex> = LazyLock::new(|| {
    Regex::new(
        r#"^steps\.([A-Za-z_][A-Za-z0-9_-]*)\.outputs(?:\.([A-Za-z_][A-Za-z0-9_-]*)|\[\s*'([^']+)'\s*\]|\[\s*"([^"]+)"\s*\])$"#,
    )
    .expect("valid step output pattern")
});

/// Parses `source`, keeps only `job_name` and substitutes the `needs` it references.
///
/// # Errors
///
/// [`Error::Workflow`] when the file does not parse, has no `jobs:` or no such job.
pub fn isolate_job(
    source: &str,
    job_name: &str,
    needs: &BTreeMap<String, NeededJob>,
) -> Result<JobWorkflow> {
    isolate_job_with_cache(source, job_name, needs, None)
}

/// [`isolate_job`], plus the dependency cache's steps (doc 27) when `tmpfs_max_bytes` is set
/// and the job asks for a cache.
///
/// # Errors
///
/// [`Error::Workflow`] when the file does not parse, has no `jobs:` or no such job.
pub fn isolate_job_with_cache(
    source: &str,
    job_name: &str,
    needs: &BTreeMap<String, NeededJob>,
    tmpfs_max_bytes: Option<u64>,
) -> Result<JobWorkflow> {
    let documents = YamlLoader::load_from_str(source)
        .map_err(|error| Error::Workflow(format!("the workflow does not parse: {error}")))?;
    let Some(Yaml::Hash(root)) = documents.into_iter().next() else {
        return Err(Error::Workflow("the workflow is not a mapping".into()));
    };
    let Some(Yaml::Hash(jobs)) = root.get(&key("jobs")) else {
        return Err(Error::Workflow("the workflow has no jobs".into()));
    };
    let Some(Yaml::Hash(job)) = jobs.get(&key(job_name)) else {
        return Err(Error::Workflow(format!(
            "the workflow has no job {job_name}"
        )));
    };
    let docker_features = docker_features(job);
    let remote_actions = remote_actions(job);
    let job = substitute_needs_in(&Yaml::Hash(without_needs(job)), needs, None);
    let (job, deps) = match (tmpfs_max_bytes, job.as_hash()) {
        (Some(bytes), Some(hash)) => match deps_plan::apply(hash, bytes) {
            Some((rewritten, plan)) => (Yaml::Hash(rewritten), Some(plan)),
            None => (job, None),
        },
        _ => (job, None),
    };
    let output_templates = output_templates(&job);
    let yaml = emit(&with_only_job(&root, job_name, job))?;
    Ok(JobWorkflow {
        yaml,
        output_templates,
        docker_features,
        remote_actions,
        deps,
    })
}

/// Resolves each output template whose expressions are all `steps.<id>.outputs.<name>`. A
/// value that would reveal a secret is withheld, as GitHub does.
pub fn resolve_outputs(
    templates: &BTreeMap<String, String>,
    step_outputs: &BTreeMap<String, BTreeMap<String, String>>,
    masker: &Masker,
) -> ResolvedOutputs {
    let mut resolved = ResolvedOutputs::default();
    for (name, template) in templates {
        match resolve_template(template, step_outputs) {
            Some(value) if !masker.reveals_secret(&value) => {
                resolved.values.insert(name.clone(), value);
            }
            _ => resolved.unresolved.push(name.clone()),
        }
    }
    resolved
}

fn resolve_template(
    template: &str,
    step_outputs: &BTreeMap<String, BTreeMap<String, String>>,
) -> Option<String> {
    let mut is_resolvable = true;
    let value = EXPRESSION.replace_all(template, |captures: &Captures<'_>| {
        let expression = captures.get(1).map_or("", |m| m.as_str()).trim();
        let Some(reference) = STEP_OUTPUT.captures(expression) else {
            is_resolvable = false;
            return String::new();
        };
        let step = reference.get(1).map_or("", |m| m.as_str());
        let output = (2..=4)
            .find_map(|group| reference.get(group))
            .map_or("", |m| m.as_str());
        step_outputs
            .get(step)
            .and_then(|outputs| outputs.get(output))
            .cloned()
            .unwrap_or_default()
    });
    is_resolvable.then(|| value.into_owned())
}

/// What act's host mode would skip or fail on: `services:` (skipped silently, a false green),
/// `container:`, and `docker://` steps. Such a job runs in act's Docker mode.
fn docker_features(job: &Hash) -> Vec<String> {
    let mut found = Vec::new();
    for feature in ["services", "container"] {
        if job.contains_key(&key(feature)) {
            found.push(format!("`{feature}:`"));
        }
    }
    let docker_steps = job
        .get(&key("steps"))
        .and_then(Yaml::as_vec)
        .into_iter()
        .flatten()
        .filter_map(|step| step["uses"].as_str())
        .filter(|uses| uses.starts_with("docker://"))
        .count();
    if docker_steps > 0 {
        found.push("`docker://` actions".to_owned());
    }
    found
}

/// `owner/repo` of each `uses: owner/repo[/path]@ref` step (not `./local`, not `docker://`).
fn remote_actions(job: &Hash) -> Vec<String> {
    let mut found: Vec<String> = job
        .get(&key("steps"))
        .and_then(Yaml::as_vec)
        .into_iter()
        .flatten()
        .filter_map(|step| step["uses"].as_str())
        .filter(|uses| !uses.starts_with("./") && !uses.starts_with("docker://"))
        .filter_map(|uses| {
            let name = uses.split('@').next()?;
            let mut parts = name.split('/');
            Some(format!("{}/{}", parts.next()?, parts.next()?))
        })
        .collect();
    found.sort();
    found.dedup();
    found
}

fn key(name: &str) -> Yaml {
    Yaml::String(name.to_owned())
}

fn without_needs(job: &Hash) -> Hash {
    job.iter()
        .filter(|(name, _)| **name != key("needs"))
        .map(|(name, value)| (name.clone(), value.clone()))
        .collect()
}

fn with_only_job(root: &Hash, job_name: &str, job: Yaml) -> Yaml {
    let mut jobs = Hash::new();
    jobs.insert(key(job_name), job);
    let rebuilt: Hash = root
        .iter()
        .map(|(name, value)| {
            if *name == key("jobs") {
                (name.clone(), Yaml::Hash(jobs.clone()))
            } else {
                (name.clone(), value.clone())
            }
        })
        .collect();
    Yaml::Hash(rebuilt)
}

fn output_templates(job: &Yaml) -> BTreeMap<String, String> {
    let Some(Yaml::Hash(outputs)) = job.as_hash().and_then(|job| job.get(&key("outputs"))) else {
        return BTreeMap::new();
    };
    outputs
        .iter()
        .filter_map(|(name, value)| Some((name.as_str()?.to_owned(), scalar_text(value)?)))
        .collect()
}

fn scalar_text(value: &Yaml) -> Option<String> {
    match value {
        Yaml::String(text) | Yaml::Real(text) => Some(text.clone()),
        Yaml::Integer(number) => Some(number.to_string()),
        Yaml::Boolean(flag) => Some(flag.to_string()),
        _ => None,
    }
}

/// Rewrites every string under `node`: inside `${{ }}`, and the whole value of an `if:` key.
fn substitute_needs_in(
    node: &Yaml,
    needs: &BTreeMap<String, NeededJob>,
    parent_key: Option<&str>,
) -> Yaml {
    match node {
        Yaml::String(text) if parent_key == Some("if") && !text.contains("${{") => {
            Yaml::String(substitute_needs(text, needs))
        }
        Yaml::String(text) => Yaml::String(
            EXPRESSION
                .replace_all(text, |captures: &Captures<'_>| {
                    let inner = captures.get(1).map_or("", |m| m.as_str());
                    format!("${{{{{}}}}}", substitute_needs(inner, needs))
                })
                .into_owned(),
        ),
        Yaml::Array(items) => Yaml::Array(
            items
                .iter()
                .map(|item| substitute_needs_in(item, needs, None))
                .collect(),
        ),
        Yaml::Hash(entries) => Yaml::Hash(
            entries
                .iter()
                .map(|(name, value)| {
                    (
                        name.clone(),
                        substitute_needs_in(value, needs, name.as_str()),
                    )
                })
                .collect(),
        ),
        other => other.clone(),
    }
}

fn substitute_needs(expression: &str, needs: &BTreeMap<String, NeededJob>) -> String {
    NEEDS_REFERENCE
        .replace_all(expression, |captures: &Captures<'_>| {
            let whole = captures.get(0).map_or("", |m| m.as_str());
            let job = captures.get(1).map_or("", |m| m.as_str());
            let Some(needed) = needs.get(job) else {
                return whole.to_owned();
            };
            let value = match captures.get(2) {
                Some(output) => needed
                    .outputs
                    .get(output.as_str())
                    .cloned()
                    .unwrap_or_default(),
                None => needed.result.clone(),
            };
            format!("'{}'", value.replace('\'', "''"))
        })
        .into_owned()
}

fn emit(document: &Yaml) -> Result<String> {
    let mut text = String::new();
    let mut emitter = YamlEmitter::new(&mut text);
    emitter.multiline_strings(true);
    emitter
        .dump(document)
        .map_err(|error| Error::Workflow(format!("the job could not be written back: {error}")))?;
    text.push('\n');
    Ok(text)
}

#[cfg(test)]
mod tests {
    use proptest::prelude::*;

    use super::*;

    const WORKFLOW: &str = r"
name: CI
on:
  push:
    branches: [main]
env:
  TOP: level
jobs:
  build:
    runs-on: ubuntu-latest
    outputs:
      version: ${{ steps.v.outputs.version }}
    steps:
      - id: v
        run: echo version=1.2.3 >> $GITHUB_OUTPUT
  deploy:
    needs: [build]
    if: needs.build.result == 'success'
    runs-on: ubuntu-latest
    outputs:
      url: https://example.com/${{ steps.d.outputs.path }}
      both: ${{ steps.d.outputs.path }}-${{ steps.d.outputs['tag'] }}
      computed: ${{ format('{0}', steps.d.outputs.path) }}
      fixed: plain
    steps:
      - id: d
        run: |
          echo deploying ${{ needs.build.outputs.version }}
          echo the word needs.build.result stays in a script
        env:
          NODE: 20
";

    fn build_succeeded() -> BTreeMap<String, NeededJob> {
        BTreeMap::from([(
            "build".to_owned(),
            NeededJob {
                result: "success".into(),
                outputs: BTreeMap::from([("version".to_owned(), "1.2.3".to_owned())]),
            },
        )])
    }

    #[test]
    fn keeps_only_the_target_job_without_its_needs() -> Result<()> {
        let job = isolate_job(WORKFLOW, "deploy", &build_succeeded())?;
        let parsed = YamlLoader::load_from_str(&job.yaml)
            .map_err(|error| Error::Workflow(error.to_string()))?;
        let jobs = &parsed[0]["jobs"];
        assert!(jobs["build"].is_badvalue());
        assert!(jobs["deploy"]["needs"].is_badvalue());
        assert_eq!(parsed[0]["env"]["TOP"].as_str(), Some("level"));
        assert_eq!(
            parsed[0]["on"]["push"]["branches"][0].as_str(),
            Some("main")
        );
        Ok(())
    }

    #[test]
    fn replaces_needs_references_with_the_finished_jobs_values() -> Result<()> {
        let job = isolate_job(WORKFLOW, "deploy", &build_succeeded())?;
        let parsed = YamlLoader::load_from_str(&job.yaml)
            .map_err(|error| Error::Workflow(error.to_string()))?;
        let deploy = &parsed[0]["jobs"]["deploy"];
        assert_eq!(deploy["if"].as_str(), Some("'success' == 'success'"));
        let script = deploy["steps"][0]["run"].as_str().unwrap_or_default();
        assert!(script.contains("echo deploying ${{ '1.2.3' }}"));
        assert!(script.contains("the word needs.build.result stays in a script"));
        assert_eq!(deploy["steps"][0]["env"]["NODE"].as_i64(), Some(20));
        Ok(())
    }

    #[test]
    fn quotes_a_value_that_contains_a_quote() {
        let needs = BTreeMap::from([(
            "a".to_owned(),
            NeededJob {
                result: "success".into(),
                outputs: BTreeMap::from([("x".to_owned(), "it's".to_owned())]),
            },
        )]);
        assert_eq!(substitute_needs("needs.a.outputs.x", &needs), "'it''s'");
    }

    #[test]
    fn leaves_a_reference_to_a_job_it_was_not_given() {
        assert_eq!(
            substitute_needs("needs.other.result", &BTreeMap::new()),
            "needs.other.result"
        );
    }

    #[test]
    fn refuses_a_missing_job() {
        assert!(matches!(
            isolate_job(WORKFLOW, "release", &BTreeMap::new()),
            Err(Error::Workflow(_))
        ));
    }

    #[test]
    fn marks_services_containers_and_docker_steps_for_docker_mode() -> Result<()> {
        let source = r"
on: push
jobs:
  db:
    runs-on: ubuntu-latest
    services:
      redis:
        image: redis
    steps:
      - uses: docker://alpine:3
      - uses: actions/checkout@v4
      - uses: actions/cache/restore@v4
      - uses: ./local-action
";
        let job = isolate_job(source, "db", &BTreeMap::new())?;
        assert_eq!(
            job.docker_features,
            vec!["`services:`", "`docker://` actions"]
        );
        assert_eq!(
            job.remote_actions,
            vec!["actions/cache", "actions/checkout"]
        );
        let host = isolate_job(WORKFLOW, "deploy", &BTreeMap::new())?;
        assert!(host.docker_features.is_empty());
        Ok(())
    }

    #[test]
    fn refuses_a_file_that_does_not_parse() {
        assert!(matches!(
            isolate_job("jobs: [unclosed", "x", &BTreeMap::new()),
            Err(Error::Workflow(_))
        ));
    }

    #[test]
    fn resolves_step_output_templates_and_reports_the_rest() -> Result<()> {
        let job = isolate_job(WORKFLOW, "deploy", &build_succeeded())?;
        let step_outputs = BTreeMap::from([(
            "d".to_owned(),
            BTreeMap::from([
                ("path".to_owned(), "app".to_owned()),
                ("tag".to_owned(), "v1".to_owned()),
            ]),
        )]);
        let resolved = resolve_outputs(&job.output_templates, &step_outputs, &Masker::new());
        assert_eq!(
            resolved.values.get("url").map(String::as_str),
            Some("https://example.com/app")
        );
        assert_eq!(
            resolved.values.get("both").map(String::as_str),
            Some("app-v1")
        );
        assert_eq!(
            resolved.values.get("fixed").map(String::as_str),
            Some("plain")
        );
        assert_eq!(resolved.unresolved, vec!["computed".to_owned()]);
        Ok(())
    }

    #[test]
    fn withholds_an_output_that_reveals_a_secret() {
        let templates =
            BTreeMap::from([("token".to_owned(), "${{ steps.s.outputs.t }}".to_owned())]);
        let step_outputs = BTreeMap::from([(
            "s".to_owned(),
            BTreeMap::from([("t".to_owned(), "super-secret-value".to_owned())]),
        )]);
        let mut masker = Masker::new();
        masker.add("super-secret-value");
        let resolved = resolve_outputs(&templates, &step_outputs, &masker);
        assert!(resolved.values.is_empty());
        assert_eq!(resolved.unresolved, vec!["token".to_owned()]);
    }

    proptest! {
        #[test]
        fn a_substituted_value_round_trips_through_the_quoting(value in "[ -~]{0,40}") {
            let needs = BTreeMap::from([(
                "a".to_owned(),
                NeededJob { result: "success".into(), outputs: BTreeMap::from([("x".to_owned(), value.clone())]) },
            )]);
            let literal = substitute_needs("needs.a.outputs.x", &needs);
            prop_assert!(literal.starts_with('\'') && literal.ends_with('\''));
            let inner = &literal[1..literal.len() - 1];
            prop_assert_eq!(inner.replace("''", "'"), value);
        }
    }
}
