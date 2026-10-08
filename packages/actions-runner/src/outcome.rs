//! The job's record: act's lines turned into masked [`LogLine`]s, and everything the result
//! reports (steps, step outputs, annotations, summaries, act's verdict) gathered on the way.

use std::collections::BTreeMap;

use crate::act::event::{ActRecord, StepRef};
use crate::mask::Masker;
use crate::wire::{Annotation, Level, LineKind, LogLine, StepRecord, StepSummary};

/// GitHub keeps at most 50 annotations per job; the rest stay in the log only.
const MAX_ANNOTATIONS: usize = 50;
/// GitHub's limits on step summaries: 1 MiB each, 20 per job.
const MAX_SUMMARY_BYTES: usize = 1024 * 1024;
const MAX_SUMMARIES: usize = 20;

/// Turns act records into log lines, masking every text first.
#[derive(Debug, Default)]
pub struct Recorder {
    masker: Masker,
    next_seq: u64,
    steps: Vec<StepRecord>,
    annotations: Vec<Annotation>,
    summaries: Vec<StepSummary>,
    step_outputs: BTreeMap<String, BTreeMap<String, String>>,
    job_result: Option<String>,
}

/// What the recorder gathered, for the result.
#[derive(Debug, Default)]
pub struct Recorded {
    pub masker: Masker,
    pub lines: u64,
    pub steps: Vec<StepRecord>,
    pub annotations: Vec<Annotation>,
    pub summaries: Vec<StepSummary>,
    pub step_outputs: BTreeMap<String, BTreeMap<String, String>>,
    pub job_result: Option<String>,
}

impl Recorder {
    pub fn new(masker: Masker) -> Self {
        Self {
            masker,
            ..Self::default()
        }
    }

    /// The log line for `record`, if it shows one (`set-output` and `add-mask` do not).
    pub fn record(&mut self, record: ActRecord, at: u64) -> Option<LogLine> {
        match record {
            ActRecord::Output { at: step, text } => {
                let text = text.strip_suffix('\n').unwrap_or(&text).to_owned();
                Some(self.line(at, LineKind::Output, &step, Level::Info, &text))
            }
            ActRecord::StepStarted { at: step, text } => {
                let text = text.trim_start_matches("⭐ ").to_owned();
                Some(self.line(at, LineKind::StepStart, &step, Level::Info, &text))
            }
            ActRecord::StepFinished {
                at: step,
                result,
                duration_ms,
                text,
            } => Some(self.step_finished(at, &step, &result, duration_ms, &text)),
            ActRecord::Command {
                at: step,
                command,
                arg,
                properties,
                name,
            } => self.command(at, &step, &command, &arg, &properties, name),
            ActRecord::Summary { at: step, markdown } => Some(self.summary(at, &step, &markdown)),
            ActRecord::JobFinished { result } => {
                let text = format!("Job {result}");
                self.job_result = Some(result);
                Some(self.line(
                    at,
                    LineKind::Runner,
                    &StepRef::default(),
                    Level::Info,
                    &text,
                ))
            }
            ActRecord::Message {
                at: step,
                level,
                text,
            } => Some(self.line(at, LineKind::Runner, &step, level_of(&level), &text)),
            ActRecord::Noise => None,
        }
    }

    /// A line from the runner itself (fetching the workflow, a failure before act ran).
    pub fn runner_line(&mut self, at: u64, level: Level, text: &str) -> LogLine {
        self.line(at, LineKind::Runner, &StepRef::default(), level, text)
    }

    /// act's verdict, once it printed one.
    pub fn job_result(&self) -> Option<&str> {
        self.job_result.as_deref()
    }

    pub fn masker(&self) -> &Masker {
        &self.masker
    }

    pub fn into_recorded(self) -> Recorded {
        Recorded {
            masker: self.masker,
            lines: self.next_seq,
            steps: self.steps,
            annotations: self.annotations,
            summaries: self.summaries,
            step_outputs: self.step_outputs,
            job_result: self.job_result,
        }
    }

    fn step_finished(
        &mut self,
        at: u64,
        step: &StepRef,
        result: &str,
        duration_ms: u64,
        text: &str,
    ) -> LogLine {
        self.steps.push(StepRecord {
            id: step.step_id.clone().unwrap_or_default(),
            name: self.masker.apply(step.step.as_deref().unwrap_or_default()),
            stage: step.stage.clone().unwrap_or_else(|| "Main".into()),
            result: result.to_owned(),
            duration_ms,
        });
        let level = if result == "failure" {
            Level::Error
        } else {
            Level::Info
        };
        let mut line = self.line(
            at,
            LineKind::StepEnd,
            step,
            level,
            text.trim_start_matches(['✅', '❌', ' ']),
        );
        line.result = Some(result.to_owned());
        line.duration_ms = Some(duration_ms);
        line
    }

    fn command(
        &mut self,
        at: u64,
        step: &StepRef,
        command: &str,
        arg: &str,
        properties: &BTreeMap<String, String>,
        name: Option<String>,
    ) -> Option<LogLine> {
        match command {
            "add-mask" => {
                self.masker.add(arg);
                None
            }
            "set-output" => {
                let step_id = step.step_id.clone().unwrap_or_default();
                let outputs = self.step_outputs.entry(step_id).or_default();
                outputs.insert(name.unwrap_or_default(), arg.to_owned());
                None
            }
            "error" | "warning" | "notice" => {
                Some(self.annotation(at, step, command, arg, properties))
            }
            "group" => Some(self.line(at, LineKind::GroupStart, step, Level::Info, arg)),
            "endgroup" => Some(self.line(at, LineKind::GroupEnd, step, Level::Info, "")),
            "debug" => Some(self.line(at, LineKind::Debug, step, Level::Debug, arg)),
            _ => None,
        }
    }

    fn annotation(
        &mut self,
        at: u64,
        step: &StepRef,
        command: &str,
        arg: &str,
        properties: &BTreeMap<String, String>,
    ) -> LogLine {
        let level = level_of(command);
        let annotation = Annotation {
            level,
            message: self.masker.apply(arg),
            title: properties
                .get("title")
                .map(|title| self.masker.apply(title)),
            file: properties.get("file").cloned(),
            line: number(properties, "line"),
            end_line: number(properties, "endLine"),
            col: number(properties, "col"),
            end_column: number(properties, "endColumn"),
            step_id: step.step_id.clone(),
        };
        if self.annotations.len() < MAX_ANNOTATIONS {
            self.annotations.push(annotation.clone());
        }
        let mut line = self.line(at, LineKind::Annotation, step, level, arg);
        line.annotation = Some(annotation);
        line
    }

    fn summary(&mut self, at: u64, step: &StepRef, markdown: &str) -> LogLine {
        let masked = self.masker.apply(markdown);
        let step_id = step.step_id.clone().unwrap_or_default();
        if self.summaries.len() < MAX_SUMMARIES && masked.len() <= MAX_SUMMARY_BYTES {
            match self
                .summaries
                .iter_mut()
                .find(|summary| summary.step_id == step_id)
            {
                Some(existing) => existing.markdown.push_str(&masked),
                None => self.summaries.push(StepSummary {
                    step_id,
                    markdown: masked,
                }),
            }
        }
        self.line(at, LineKind::Summary, step, Level::Info, markdown)
    }

    fn line(
        &mut self,
        at: u64,
        kind: LineKind,
        step: &StepRef,
        level: Level,
        text: &str,
    ) -> LogLine {
        let seq = self.next_seq;
        self.next_seq += 1;
        LogLine {
            seq,
            at,
            kind,
            stage: step.stage.clone(),
            step_id: step.step_id.clone(),
            step: step.step.as_deref().map(|name| self.masker.apply(name)),
            level,
            text: self.masker.apply(text),
            result: None,
            duration_ms: None,
            annotation: None,
        }
    }
}

fn level_of(level: &str) -> Level {
    match level {
        "debug" | "trace" => Level::Debug,
        "notice" => Level::Notice,
        "warning" | "warn" => Level::Warning,
        "error" | "fatal" | "panic" => Level::Error,
        _ => Level::Info,
    }
}

fn number(properties: &BTreeMap<String, String>, name: &str) -> Option<u32> {
    properties.get(name).and_then(|value| value.parse().ok())
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::act::event::parse_line;

    fn recorder_with_secret(secret: &str) -> Recorder {
        let mut masker = Masker::new();
        masker.add(secret);
        Recorder::new(masker)
    }

    fn record(recorder: &mut Recorder, line: &str) -> Option<LogLine> {
        recorder.record(parse_line(line), 1)
    }

    #[test]
    fn masks_a_multi_line_secret_that_act_printed() {
        let mut recorder = recorder_with_secret("line-one\nline-two");
        let line = record(
            &mut recorder,
            r#"{"msg":"multi=[line-one\n","raw_output":true,"stage":"Main","step":"s","stepID":["0"]}"#,
        );
        assert_eq!(line.map(|line| line.text), Some("multi=[***".to_owned()));
    }

    #[test]
    fn masks_values_added_at_run_time_from_then_on() {
        let mut recorder = Recorder::new(Masker::new());
        let hidden = record(
            &mut recorder,
            r#"{"arg":"runtime-value","command":"add-mask","msg":"x","stage":"Main","stepID":["0"]}"#,
        );
        assert!(hidden.is_none());
        let line = record(
            &mut recorder,
            r#"{"msg":"got runtime-value\n","raw_output":true,"stage":"Main","stepID":["0"]}"#,
        );
        assert_eq!(line.map(|line| line.text), Some("got ***".to_owned()));
    }

    #[test]
    fn gathers_step_outputs_without_showing_them() {
        let mut recorder = Recorder::new(Masker::new());
        let shown = record(
            &mut recorder,
            r#"{"arg":"hi there","command":"set-output","name":"greeting","msg":"x","stage":"Main","stepID":["greet"]}"#,
        );
        assert!(shown.is_none());
        let gathered = recorder.into_recorded();
        assert_eq!(
            gathered.step_outputs["greet"]["greeting"],
            "hi there".to_owned()
        );
    }

    #[test]
    fn turns_an_error_command_into_an_annotation() {
        let mut recorder = Recorder::new(Masker::new());
        let line = record(
            &mut recorder,
            r#"{"arg":"bad thing","command":"error","kvPairs":{"file":"a.ts","line":"4","title":"T"},"level":"error","msg":"x","stage":"Main","stepID":["1"]}"#,
        );
        let annotation = line.and_then(|line| line.annotation);
        assert_eq!(
            annotation
                .as_ref()
                .map(|a| (a.level, a.line, a.file.as_deref())),
            Some((Level::Error, Some(4), Some("a.ts")))
        );
        assert_eq!(recorder.into_recorded().annotations.len(), 1);
    }

    #[test]
    fn records_steps_and_the_job_result_in_order() {
        let mut recorder = Recorder::new(Masker::new());
        let started = record(
            &mut recorder,
            r#"{"msg":"⭐ Run Main Test","stage":"Main","step":"Test","stepID":["0"]}"#,
        );
        let ended = record(
            &mut recorder,
            r#"{"executionTime":2000000,"msg":"  ❌  Failure - Main Test [2ms]","stage":"Main","step":"Test","stepID":["0"],"stepResult":"failure"}"#,
        );
        record(
            &mut recorder,
            r#"{"jobResult":"failure","msg":"🏁  Job failed"}"#,
        );
        assert_eq!(
            started.map(|line| (line.seq, line.text)),
            Some((0, "Run Main Test".to_owned()))
        );
        let ended = ended.map(|line| (line.seq, line.level, line.duration_ms, line.text));
        assert_eq!(
            ended,
            Some((
                1,
                Level::Error,
                Some(2),
                "Failure - Main Test [2ms]".to_owned()
            ))
        );
        let gathered = recorder.into_recorded();
        assert_eq!(gathered.job_result.as_deref(), Some("failure"));
        assert_eq!(gathered.steps.len(), 1);
        assert_eq!(gathered.lines, 3);
    }

    #[test]
    fn keeps_a_steps_summary() {
        let mut recorder = Recorder::new(Masker::new());
        record(
            &mut recorder,
            r##"{"command":"summary","content":"# Done\n","msg":"x","stage":"Main","stepID":["greet"]}"##,
        );
        let gathered = recorder.into_recorded();
        assert_eq!(gathered.summaries[0].markdown, "# Done\n");
    }
}
