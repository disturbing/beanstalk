//! When lines leave the container: in batches of at most one a second or 64 KiB (the control
//! plane writes each batch as one gzip chunk in R2 and relays it live), and an empty batch
//! after 15 quiet seconds as the heartbeat. The container keeps a line only until its batch is
//! acknowledged.

use std::time::{Duration, Instant};

use crate::wire::LogLine;

pub const BATCH_INTERVAL: Duration = Duration::from_secs(1);
pub const BATCH_MAX_BYTES: usize = 64 * 1024;
pub const HEARTBEAT_INTERVAL: Duration = Duration::from_secs(15);
/// How often the job loop looks at the batcher.
pub const TICK: Duration = Duration::from_millis(250);
/// Per-line overhead of the JSON envelope, for the size estimate.
const LINE_OVERHEAD_BYTES: usize = 96;

/// A batch ready to send (`index` counts from 0; an empty batch is a heartbeat).
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct BatchOut {
    pub index: u32,
    pub lines: Vec<LogLine>,
}

/// Whether a flush must send what it has now (the job ended).
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Flush {
    WhenDue,
    Everything,
}

#[derive(Debug)]
pub struct Batcher {
    lines: Vec<LogLine>,
    bytes: usize,
    sent_at: Instant,
    next_index: u32,
}

impl Batcher {
    pub fn new(now: Instant) -> Self {
        Self {
            lines: Vec::new(),
            bytes: 0,
            sent_at: now,
            next_index: 0,
        }
    }

    pub fn push(&mut self, line: LogLine) {
        self.bytes += line.text.len() + LINE_OVERHEAD_BYTES;
        self.lines.push(line);
    }

    /// The next batch, when one is due: full, a second old, or a heartbeat.
    pub fn take(&mut self, now: Instant, flush: Flush) -> Option<BatchOut> {
        let waited = now.saturating_duration_since(self.sent_at);
        let has_lines = !self.lines.is_empty();
        let is_due = match flush {
            Flush::Everything => has_lines,
            Flush::WhenDue => {
                self.bytes >= BATCH_MAX_BYTES
                    || (has_lines && waited >= BATCH_INTERVAL)
                    || waited >= HEARTBEAT_INTERVAL
            }
        };
        if !is_due {
            return None;
        }
        self.sent_at = now;
        self.bytes = 0;
        let index = self.next_index;
        self.next_index += 1;
        Some(BatchOut {
            index,
            lines: std::mem::take(&mut self.lines),
        })
    }

    /// Batches handed out so far.
    pub fn batches(&self) -> u32 {
        self.next_index
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::wire::{Level, LineKind};

    fn line(seq: u64, text: &str) -> LogLine {
        LogLine {
            seq,
            at: 0,
            kind: LineKind::Output,
            stage: None,
            step_id: None,
            step: None,
            level: Level::Info,
            text: text.into(),
            result: None,
            duration_ms: None,
            annotation: None,
        }
    }

    #[test]
    fn sends_lines_once_a_second() {
        let start = Instant::now();
        let mut batcher = Batcher::new(start);
        batcher.push(line(0, "a"));
        assert!(
            batcher
                .take(start + Duration::from_millis(500), Flush::WhenDue)
                .is_none()
        );
        let batch = batcher.take(start + BATCH_INTERVAL, Flush::WhenDue);
        assert_eq!(
            batch.map(|batch| (batch.index, batch.lines.len())),
            Some((0, 1))
        );
    }

    #[test]
    fn sends_a_full_batch_at_once() {
        let start = Instant::now();
        let mut batcher = Batcher::new(start);
        batcher.push(line(0, &"x".repeat(BATCH_MAX_BYTES)));
        assert!(batcher.take(start, Flush::WhenDue).is_some());
    }

    #[test]
    fn sends_an_empty_heartbeat_when_quiet() {
        let start = Instant::now();
        let mut batcher = Batcher::new(start);
        assert!(
            batcher
                .take(start + BATCH_INTERVAL, Flush::WhenDue)
                .is_none()
        );
        let beat = batcher.take(start + HEARTBEAT_INTERVAL, Flush::WhenDue);
        assert_eq!(beat.map(|batch| batch.lines.len()), Some(0));
    }

    #[test]
    fn numbers_batches_and_flushes_the_rest_at_the_end() {
        let start = Instant::now();
        let mut batcher = Batcher::new(start);
        batcher.push(line(0, "first"));
        assert!(
            batcher
                .take(start + BATCH_INTERVAL, Flush::WhenDue)
                .is_some()
        );
        batcher.push(line(1, "last"));
        let last = batcher.take(start + BATCH_INTERVAL, Flush::Everything);
        assert_eq!(
            last.map(|batch| (batch.index, batch.lines[0].seq)),
            Some((1, 1))
        );
        assert!(batcher.take(start, Flush::Everything).is_none());
        assert_eq!(batcher.batches(), 2);
    }
}
