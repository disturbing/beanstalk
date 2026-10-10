//! act's `--json` output, one object per line, read into [`ActRecord`]s. Measured on act
//! v0.2.89 in host mode: step output carries `raw_output: true`; workflow commands carry
//! `command`, `arg` and `kvPairs`; a step's end carries `stepResult` and `executionTime` (ns);
//! the job's end carries `jobResult`; summaries arrive as `command: "summary"` with `content`.

use std::collections::BTreeMap;

use serde::Deserialize;

/// Where a line comes from: the step it belongs to, when it belongs to one.
#[derive(Debug, Clone, Default, PartialEq, Eq)]
pub struct StepRef {
    /// `Pre`, `Main` or `Post`.
    pub stage: Option<String>,
    /// The step's `id:`, or act's index for a step without one; nested ids joined with `/`.
    pub step_id: Option<String>,
    pub step: Option<String>,
}

/// One act line, classified.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum ActRecord {
    /// What a step printed.
    Output {
        at: StepRef,
        text: String,
    },
    StepStarted {
        at: StepRef,
        text: String,
    },
    StepFinished {
        at: StepRef,
        result: String,
        duration_ms: u64,
        text: String,
    },
    /// A workflow command act parsed (`::error::`, `::group::`, `set-output`, ...).
    Command {
        at: StepRef,
        command: String,
        arg: String,
        properties: BTreeMap<String, String>,
        name: Option<String>,
    },
    Summary {
        at: StepRef,
        markdown: String,
    },
    JobFinished {
        result: String,
    },
    /// act's own message.
    Message {
        at: StepRef,
        level: String,
        text: String,
    },
    /// act's complaints that the empty working directory is not a git repository: expected
    /// (the workspace is empty until `actions/checkout`), so never shown.
    Noise,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct RawLine {
    #[serde(default)]
    msg: String,
    #[serde(default)]
    level: String,
    #[serde(default)]
    stage: Option<String>,
    #[serde(default)]
    step: Option<String>,
    #[serde(default, rename = "stepID")]
    step_id: Option<Vec<String>>,
    #[serde(default, rename = "stepid")]
    step_id_lower: Option<Vec<String>>,
    #[serde(default, rename = "raw_output")]
    raw_output: bool,
    #[serde(default)]
    command: Option<String>,
    #[serde(default)]
    arg: Option<String>,
    #[serde(default)]
    name: Option<String>,
    #[serde(default)]
    kv_pairs: Option<BTreeMap<String, String>>,
    #[serde(default)]
    content: Option<String>,
    #[serde(default)]
    step_result: Option<String>,
    #[serde(default)]
    job_result: Option<String>,
    #[serde(default)]
    execution_time: Option<u64>,
}

const NOISE: [&str; 4] = [
    "Couldn't get a valid docker connection",
    "not located inside a git repository",
    "unable to get git ref",
    "unable to get git revision",
];

/// Reads one line of act's stdout. A line that is not act JSON is act (or a tool) printing
/// plainly; it is kept as a runner message.
pub fn parse_line(line: &str) -> ActRecord {
    match serde_json::from_str::<RawLine>(line) {
        Ok(raw) => classify(raw),
        Err(_) => ActRecord::Message {
            at: StepRef::default(),
            level: "info".into(),
            text: line.to_owned(),
        },
    }
}

fn classify(raw: RawLine) -> ActRecord {
    if let Some(result) = raw.job_result {
        return ActRecord::JobFinished { result };
    }
    let at = step_ref(&raw);
    if raw.raw_output {
        return ActRecord::Output { at, text: raw.msg };
    }
    if let Some(command) = raw.command {
        return classify_command(at, command, raw.arg, raw.kv_pairs, raw.name, raw.content);
    }
    if let Some(result) = raw.step_result {
        let duration_ms = raw.execution_time.map_or(0, |ns| ns / 1_000_000);
        return ActRecord::StepFinished {
            at,
            result,
            duration_ms,
            text: raw.msg.trim().to_owned(),
        };
    }
    if NOISE.iter().any(|noise| raw.msg.contains(noise)) {
        return ActRecord::Noise;
    }
    if raw.msg.starts_with("⭐ Run ") {
        return ActRecord::StepStarted {
            at,
            text: raw.msg.trim().to_owned(),
        };
    }
    ActRecord::Message {
        at,
        level: raw.level,
        text: raw.msg.trim_end().to_owned(),
    }
}

fn classify_command(
    at: StepRef,
    command: String,
    arg: Option<String>,
    properties: Option<BTreeMap<String, String>>,
    name: Option<String>,
    content: Option<String>,
) -> ActRecord {
    if command == "summary" {
        return ActRecord::Summary {
            at,
            markdown: content.unwrap_or_default(),
        };
    }
    ActRecord::Command {
        at,
        command,
        arg: arg.unwrap_or_default(),
        properties: properties.unwrap_or_default(),
        name,
    }
}

fn step_ref(raw: &RawLine) -> StepRef {
    let ids = raw.step_id.as_ref().or(raw.step_id_lower.as_ref());
    StepRef {
        stage: raw.stage.clone(),
        step_id: ids.filter(|ids| !ids.is_empty()).map(|ids| ids.join("/")),
        step: raw.step.clone(),
    }
}

#[cfg(test)]
mod tests {
    use proptest::prelude::*;

    use super::*;

    fn main_step(id: &str, name: &str) -> StepRef {
        StepRef {
            stage: Some("Main".into()),
            step_id: Some(id.into()),
            step: Some(name.into()),
        }
    }

    #[test]
    fn reads_step_output() {
        let line = r#"{"job":"CI/test","jobID":"test","level":"info","matrix":{},"msg":"hello\n","raw_output":true,"stage":"Main","step":"Hello","stepID":["0"],"time":"2026-10-08T04:12:36Z"}"#;
        assert_eq!(
            parse_line(line),
            ActRecord::Output {
                at: main_step("0", "Hello"),
                text: "hello\n".into()
            }
        );
    }

    #[test]
    fn reads_an_annotation_with_its_properties() {
        let line = r#"{"arg":"watch out","command":"warning","kvPairs":{"file":"src/a.js","line":"3"},"level":"warning","msg":"  🚧  ::warning file=src/a.js,line=3::watch out\n","raw":"::warning file=src/a.js,line=3::watch out\n","stage":"Main","step":"Set output","stepID":["greet"]}"#;
        let ActRecord::Command {
            command,
            arg,
            properties,
            ..
        } = parse_line(line)
        else {
            unreachable!("not a command")
        };
        assert_eq!(command, "warning");
        assert_eq!(arg, "watch out");
        assert_eq!(properties.get("line").map(String::as_str), Some("3"));
    }

    #[test]
    fn reads_a_set_output_with_its_name() {
        let line = r#"{"arg":"hi there","command":"set-output","level":"info","msg":"  ⚙  ::set-output:: greeting=hi there","name":"greeting","stage":"Main","step":"Set output","stepID":["greet"]}"#;
        assert!(matches!(
            parse_line(line),
            ActRecord::Command { ref name, ref arg, .. } if name.as_deref() == Some("greeting") && arg == "hi there"
        ));
    }

    #[test]
    fn reads_a_step_end_with_its_duration() {
        let line = r#"{"executionTime":4535520002,"level":"info","msg":"  ✅  Success - Main actions/setup-node@v4 [4.535520002s]","stage":"Main","step":"actions/setup-node@v4","stepID":["2"],"stepResult":"success"}"#;
        assert!(matches!(
            parse_line(line),
            ActRecord::StepFinished { ref result, duration_ms: 4535, .. } if result == "success"
        ));
    }

    #[test]
    fn reads_the_setup_step_with_the_lower_case_id_field() {
        let line = r#"{"level":"info","msg":"⭐ Run Set up job","step":"Set up job","stepid":["--setup-job"]}"#;
        let ActRecord::StepStarted { at, .. } = parse_line(line) else {
            unreachable!("not a step start")
        };
        assert_eq!(at.step_id.as_deref(), Some("--setup-job"));
    }

    #[test]
    fn reads_a_summary_and_the_job_result() {
        let summary = r##"{"command":"summary","content":"# Heading\n","level":"info","msg":"  ⚙  Summary - # Heading\n","stage":"Main","step":"Set output","stepID":["greet"]}"##;
        assert!(
            matches!(parse_line(summary), ActRecord::Summary { ref markdown, .. } if markdown == "# Heading\n")
        );
        let done = r#"{"jobResult":"failure","level":"info","msg":"🏁  Job failed"}"#;
        assert_eq!(
            parse_line(done),
            ActRecord::JobFinished {
                result: "failure".into()
            }
        );
    }

    #[test]
    fn drops_the_empty_workspace_complaints() {
        let line = r#"{"error":"repository does not exist","level":"error","msg":"path/home/runner/wsnot located inside a git repository"}"#;
        assert_eq!(parse_line(line), ActRecord::Noise);
    }

    #[test]
    fn keeps_a_plain_line_as_a_message() {
        assert!(matches!(
            parse_line("Error: Job 'test' failed"),
            ActRecord::Message { ref text, .. } if text == "Error: Job 'test' failed"
        ));
    }

    proptest! {
        #[test]
        fn never_panics_on_arbitrary_input(line in ".{0,200}") {
            let _ = parse_line(&line);
        }
    }
}
