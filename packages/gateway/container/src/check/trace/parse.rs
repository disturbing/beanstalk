//! Reading `strace -ff -y` logs (one file per traced process, `<prefix>.<pid>`) into the paths a
//! process tree read, probed and listed. A port of `research/test-impact/harness/trace.py`
//! (`parse_dir`), with one phase: the runner only runs node, which has no build step.
//!
//! - **reads**: successful opens for reading, `stat` family, `access` family, `readlink`, `execve`
//!   (build caches decide freshness by stat, so a stat is a read).
//! - **probes**: the same calls failing with `ENOENT` or `ENOTDIR`, the negative dependencies:
//!   adding a file there later can change what the test does.
//! - **dirs**: directories opened with `O_DIRECTORY`, listings: adding or deleting an entry can
//!   change what the test does.
//!
//! Paths come back absolute and lexically normalised; [`super::attribute`] keeps the ones that
//! belong to the checkout.

use std::collections::{BTreeMap, BTreeSet, HashMap};
use std::sync::LazyLock;

use regex::Regex;

use crate::check::paths;

/// `call(args) = ret<annotation> ERRNO`: the shape of every complete `strace -ff` line.
const LINE_PATTERN: &str = r"^(\w+)\((.*)\)\s+=\s+(-?\d+|\?)(?:<[^>]*>)?(?:\s+(\w+))?";
/// The first quoted string of the arguments (strace escapes `"` and `\` inside it).
const STRING_PATTERN: &str = r#"^"((?:[^"\\]|\\.)*)""#;
/// A leading directory descriptor annotated by `-y`: `AT_FDCWD</cwd>, ` or `17</dir>, `.
const DIRFD_PATTERN: &str = r"^(AT_FDCWD|\d+)<([^>]*)>,\s*";
/// The working directory as `-y` shows it anywhere in the arguments.
const CWD_PATTERN: &str = r"AT_FDCWD<([^>]*)>";

#[allow(clippy::expect_used)] // constant patterns, compiled by the unit tests
static LINE: LazyLock<Regex> = LazyLock::new(|| Regex::new(LINE_PATTERN).expect("LINE compiles"));
#[allow(clippy::expect_used)] // constant patterns, compiled by the unit tests
static STRING: LazyLock<Regex> =
    LazyLock::new(|| Regex::new(STRING_PATTERN).expect("STRING compiles"));
#[allow(clippy::expect_used)] // constant patterns, compiled by the unit tests
static DIRFD: LazyLock<Regex> =
    LazyLock::new(|| Regex::new(DIRFD_PATTERN).expect("DIRFD compiles"));
#[allow(clippy::expect_used)] // constant patterns, compiled by the unit tests
static CWD: LazyLock<Regex> = LazyLock::new(|| Regex::new(CWD_PATTERN).expect("CWD compiles"));

/// Calls that look a path up for reading.
const READ_CALLS: [&str; 22] = [
    "openat",
    "open",
    "openat2",
    "creat",
    "newfstatat",
    "fstatat64",
    "stat",
    "lstat",
    "stat64",
    "lstat64",
    "statx",
    "access",
    "faccessat",
    "faccessat2",
    "readlink",
    "readlinkat",
    "execve",
    "execveat",
    "chdir",
    "statfs",
    "getxattr",
    "lgetxattr",
];
const FORK_CALLS: [&str; 4] = ["clone", "clone3", "fork", "vfork"];
const NEGATIVE: [&str; 2] = ["ENOENT", "ENOTDIR"];

/// What a process tree touched, as absolute normalised paths.
#[derive(Debug, Clone, Default, PartialEq, Eq)]
pub(crate) struct Accesses {
    pub(crate) reads: BTreeSet<String>,
    pub(crate) probes: BTreeSet<String>,
    pub(crate) dirs: BTreeSet<String>,
}

/// One process's log: its pid and its text.
#[derive(Debug, Clone)]
pub(crate) struct ProcessLog {
    pub(crate) pid: u32,
    pub(crate) text: String,
}

/// Every process's accesses, merged. `root_cwd` is the working directory of the first process.
#[must_use]
pub(crate) fn parse_logs(logs: &[ProcessLog], root_cwd: &str) -> Accesses {
    let parents = parent_pids(logs);
    let mut order: Vec<&ProcessLog> = logs.iter().collect();
    order.sort_by_key(|log| (depth(log.pid, &parents), log.pid));
    let mut ends: HashMap<u32, ProcessState> = HashMap::new();
    let mut accesses = Accesses::default();
    for log in order {
        let inherited = parents
            .get(&log.pid)
            .and_then(|parent| ends.get(parent))
            .cloned()
            .unwrap_or_else(|| ProcessState {
                cwd: root_cwd.to_owned(),
            });
        let end = parse_process(&log.text, inherited, &mut accesses);
        ends.insert(log.pid, end);
    }
    accesses
}

/// The state a child inherits from its parent: the working directory (the parent's state at
/// its end, as the prototype approximates it).
#[derive(Debug, Clone)]
struct ProcessState {
    cwd: String,
}

fn parent_pids(logs: &[ProcessLog]) -> BTreeMap<u32, u32> {
    let mut parents = BTreeMap::new();
    for log in logs {
        for line in log.text.lines() {
            let Some(call) = LINE.captures(line) else {
                continue;
            };
            let is_fork = FORK_CALLS.contains(&&call[1]);
            if let (true, Ok(child)) = (is_fork, call[3].parse::<u32>())
                && child > 0
            {
                parents.insert(child, log.pid);
            }
        }
    }
    parents
}

fn depth(pid: u32, parents: &BTreeMap<u32, u32>) -> usize {
    let mut current = pid;
    let mut hops = 0;
    while let Some(parent) = parents.get(&current) {
        current = *parent;
        hops += 1;
        if hops > parents.len() {
            break; // a cycle (pid reuse): stop rather than loop
        }
    }
    hops
}

fn parse_process(text: &str, mut state: ProcessState, accesses: &mut Accesses) -> ProcessState {
    for line in text.lines() {
        if let Some(event) = parse_line(line, &state.cwd) {
            if event.call == "chdir" && event.outcome == Outcome::Found {
                state.cwd.clone_from(&event.path);
            }
            if let Some(cwd) = event.cwd {
                state.cwd = cwd;
            }
            record(accesses, event.kind, event.outcome, event.path);
        }
    }
    state
}

/// One path lookup.
#[derive(Debug, Clone, PartialEq, Eq)]
struct PathEvent {
    call: String,
    path: String,
    kind: LookupKind,
    outcome: Outcome,
    /// The working directory the line revealed, if any.
    cwd: Option<String>,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum LookupKind {
    /// A write open: not an input of the test.
    Write,
    /// An `O_DIRECTORY` open: a listing.
    Listing,
    /// Any other lookup.
    Lookup,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum Outcome {
    Found,
    Missing,
    /// Failed for another reason (`EACCES`, `ELOOP`, ...): recorded nowhere, as in the prototype.
    Failed,
}

fn parse_line(line: &str, cwd: &str) -> Option<PathEvent> {
    let captures = LINE.captures(line)?;
    let call = &captures[1];
    if !READ_CALLS.contains(&call) {
        return None;
    }
    let args = &captures[2];
    let revealed_cwd = CWD.captures(args).map(|found| found[1].to_owned());
    let (base, rest) = match DIRFD.captures(args) {
        Some(dirfd) => (
            dirfd[2].to_owned(),
            &args[dirfd.get(0).map_or(0, |whole| whole.end())..],
        ),
        None => (revealed_cwd.clone().unwrap_or_else(|| cwd.to_owned()), args),
    };
    let raw = unescape(&STRING.captures(rest)?[1]);
    if raw.is_empty() {
        return None;
    }
    let joined = if raw.starts_with('/') {
        raw
    } else {
        paths::join(&base, &raw)
    };
    if !joined.starts_with('/') {
        return None; // no known directory to resolve it against
    }
    let outcome = match (&captures[3], captures.get(4).map(|errno| errno.as_str())) {
        ("-1", Some(errno)) if NEGATIVE.contains(&errno) => Outcome::Missing,
        ("-1", _) => Outcome::Failed,
        _ => Outcome::Found,
    };
    Some(PathEvent {
        call: call.to_owned(),
        path: paths::normalize(&joined),
        kind: lookup_kind(call, args),
        outcome,
        cwd: revealed_cwd,
    })
}

fn lookup_kind(call: &str, args: &str) -> LookupKind {
    let is_open = call.starts_with("open") || call == "creat";
    if !is_open {
        return LookupKind::Lookup;
    }
    let writes = call == "creat"
        || args.contains("O_WRONLY")
        || (args.contains("O_CREAT") && !args.contains("O_RDWR"))
        || args.contains("O_TRUNC");
    if writes {
        LookupKind::Write
    } else if args.contains("O_DIRECTORY") {
        LookupKind::Listing
    } else {
        LookupKind::Lookup
    }
}

fn record(accesses: &mut Accesses, kind: LookupKind, outcome: Outcome, path: String) {
    match (kind, outcome) {
        (LookupKind::Write, _) | (_, Outcome::Failed) => {}
        (LookupKind::Listing, Outcome::Found) => {
            accesses.dirs.insert(path);
        }
        (_, Outcome::Found) => {
            accesses.reads.insert(path);
        }
        (_, Outcome::Missing) => {
            accesses.probes.insert(path);
        }
    }
}

/// strace's C escapes (`\"`, `\\`, `\n`, `\t`, `\xNN`, octal `\NNN`) back to the path's bytes,
/// read as UTF-8 (lossily: a path that is not UTF-8 cannot be in a git tree the gateway sees).
fn unescape(escaped: &str) -> String {
    if !escaped.contains('\\') {
        return escaped.to_owned();
    }
    let mut bytes = Vec::with_capacity(escaped.len());
    let mut rest = escaped.as_bytes();
    while let Some((&first, tail)) = rest.split_first() {
        if first != b'\\' {
            bytes.push(first);
            rest = tail;
            continue;
        }
        let (byte, used) = escape_value(tail);
        bytes.push(byte);
        rest = &tail[used..];
    }
    String::from_utf8_lossy(&bytes).into_owned()
}

/// The byte a backslash escape stands for, and how many bytes after the backslash it used.
fn escape_value(after: &[u8]) -> (u8, usize) {
    match after {
        [b'x', high, low, ..] if high.is_ascii_hexdigit() && low.is_ascii_hexdigit() => {
            (hex(*high) * 16 + hex(*low), 3)
        }
        [b'0'..=b'7', ..] => {
            let digits = after
                .iter()
                .take(3)
                .take_while(|digit| (b'0'..=b'7').contains(*digit))
                .count();
            let value = after[..digits]
                .iter()
                .fold(0u32, |value, digit| value * 8 + u32::from(digit - b'0'));
            (u8::try_from(value).unwrap_or(u8::MAX), digits)
        }
        [b'n', ..] => (b'\n', 1),
        [b't', ..] => (b'\t', 1),
        [b'r', ..] => (b'\r', 1),
        [b'v', ..] => (0x0b, 1),
        [b'f', ..] => (0x0c, 1),
        [other, ..] => (*other, 1),
        [] => (b'\\', 0),
    }
}

fn hex(digit: u8) -> u8 {
    match digit {
        b'0'..=b'9' => digit - b'0',
        b'a'..=b'f' => digit - b'a' + 10,
        _ => digit - b'A' + 10,
    }
}

#[cfg(test)]
#[path = "parse_tests.rs"]
mod tests;
