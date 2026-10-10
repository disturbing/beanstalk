#![allow(clippy::unwrap_used, clippy::expect_used)] // tests fail loudly by design

use proptest::prelude::*;

use super::*;

fn log(pid: u32, lines: &[&str]) -> ProcessLog {
    ProcessLog {
        pid,
        text: lines.join("\n"),
    }
}

fn set(paths: &[&str]) -> BTreeSet<String> {
    paths.iter().map(|path| (*path).to_owned()).collect()
}

/// Lines as strace 6.13 wrote them for `node --test src/lib/money.test.ts` (arm64, Node 24).
const NODE_RUN: [&str; 9] = [
    r#"execve("/usr/local/bin/node", ["node", "--test", "src/lib/money.test.ts"], 0xffffd4b07e38 /* 9 vars */) = 0"#,
    r#"openat(AT_FDCWD</work>, "/etc/ld.so.cache", O_RDONLY|O_CLOEXEC) = 3</etc/ld.so.cache>"#,
    r#"statx(AT_FDCWD</work>, "/work/src/lib/money.test.ts", AT_STATX_SYNC_AS_STAT|AT_SYMLINK_NOFOLLOW, STATX_ALL, {stx_mask=STATX_ALL|STATX_MNT_ID, stx_attributes=0, stx_mode=S_IFREG|0644, stx_size=1394, ...}) = 0"#,
    r#"statx(18</work/src/lib/money.ts>, "", AT_STATX_SYNC_AS_STAT|AT_EMPTY_PATH, STATX_ALL, {stx_mask=STATX_ALL, ...}) = 0"#,
    r#"openat(AT_FDCWD</work>, "/work/src/package.json", O_RDONLY|O_CLOEXEC) = -1 ENOENT (No such file or directory)"#,
    r#"openat(AT_FDCWD</work>, "/work/src/lib/money.ts", O_RDONLY|O_CLOEXEC) = 18</work/src/lib/money.ts>"#,
    r#"openat(AT_FDCWD</work>, "/work/package.json", O_RDONLY|O_CLOEXEC) = 17</work/package.json>"#,
    r#"getcwd("/work", 4096)                   = 6"#,
    r"clone(child_stack=NULL, flags=CLONE_CHILD_CLEARTID|CLONE_CHILD_SETTID|SIGCHLD, child_tidptr=0xffff8f8ae530) = 21",
];

#[test]
fn node_lookups_become_reads_and_probes() {
    let accesses = parse_logs(&[log(15, &NODE_RUN)], "/work");

    assert_eq!(
        accesses.reads,
        set(&[
            "/etc/ld.so.cache",
            "/usr/local/bin/node",
            "/work/package.json",
            "/work/src/lib/money.test.ts",
            "/work/src/lib/money.ts",
        ])
    );
    assert_eq!(accesses.probes, set(&["/work/src/package.json"]));
    assert!(accesses.dirs.is_empty());
}

#[test]
fn relative_paths_resolve_against_the_dirfd_or_the_working_directory() {
    let lines = [
        r#"openat(7</work/src>, "lib/a.ts", O_RDONLY) = 8</work/src/lib/a.ts>"#,
        // amd64: calls without a dirfd resolve against the last known working directory.
        r#"stat("lib/../b.ts", {st_mode=S_IFREG|0644, st_size=10, ...}) = 0"#,
        r#"chdir("/work/src") = 0"#,
        r#"open("c.ts", O_RDONLY|O_CLOEXEC) = 3</work/src/c.ts>"#,
        r#"access("d.ts", R_OK) = -1 ENOENT (No such file or directory)"#,
        r#"readlink("e", 0x7ffd, 4095) = -1 EINVAL (Invalid argument)"#,
    ];

    let accesses = parse_logs(&[log(1, &lines)], "/work");

    assert_eq!(
        accesses.reads,
        set(&[
            "/work/b.ts",
            "/work/src",
            "/work/src/c.ts",
            "/work/src/lib/a.ts"
        ])
    );
    assert_eq!(accesses.probes, set(&["/work/src/d.ts"]));
}

#[test]
fn children_start_in_their_parents_directory() {
    let parent = log(
        1,
        &[
            r#"chdir("/work/pkg") = 0"#,
            r"clone(child_stack=NULL, flags=SIGCHLD) = 2",
        ],
    );
    let child = log(2, &[r#"stat("x.ts", {st_mode=S_IFREG, ...}) = 0"#]);

    let accesses = parse_logs(&[child, parent], "/work");

    assert!(accesses.reads.contains("/work/pkg/x.ts"));
}

#[test]
fn writes_and_listings_are_kept_apart() {
    let lines = [
        r#"openat(AT_FDCWD</w>, "/w/out.xml", O_WRONLY|O_CREAT|O_TRUNC|O_CLOEXEC, 0666) = 3</w/out.xml>"#,
        r#"openat(AT_FDCWD</w>, "/w/log", O_RDWR|O_CREAT, 0644) = 3</w/log>"#,
        r#"openat(AT_FDCWD</w>, "/w/src", O_RDONLY|O_CLOEXEC|O_DIRECTORY) = 4</w/src>"#,
        r#"openat(AT_FDCWD</w>, "/w/gone", O_RDONLY|O_DIRECTORY) = -1 ENOTDIR (Not a directory)"#,
        r#"openat(AT_FDCWD</w>, "/w/secret", O_RDONLY) = -1 EACCES (Permission denied)"#,
        r#"unlink("/w/tmp.txt") = 0"#,
    ];

    let accesses = parse_logs(&[log(1, &lines)], "/w");

    assert_eq!(accesses.reads, set(&["/w/log"]));
    assert_eq!(accesses.dirs, set(&["/w/src"]));
    assert_eq!(accesses.probes, set(&["/w/gone"]));
}

#[test]
fn escaped_paths_are_unescaped() {
    let lines = [
        r#"openat(AT_FDCWD</w>, "/w/a b\"c\\d\x41\303\251.ts", O_RDONLY) = 3</w/x>"#,
        r#"stat("/w/tab\there", {st_mode=S_IFREG, ...}) = 0"#,
    ];

    let accesses = parse_logs(&[log(1, &lines)], "/w");

    assert_eq!(accesses.reads, set(&["/w/a b\"c\\dAé.ts", "/w/tab\there"]));
}

#[test]
fn incomplete_and_unrelated_lines_are_ignored() {
    let lines = [
        "+++ exited with 0 +++",
        "--- SIGCHLD {si_signo=SIGCHLD, si_code=CLD_EXITED} ---",
        r#"openat(AT_FDCWD</w>, "/w/a.ts", O_RDONLY <unfinished ...>"#,
        r#"mkdir("/w/new", 0777) = 0"#,
        r"exit_group(0) = ?",
    ];

    assert_eq!(parse_logs(&[log(1, &lines)], "/w"), Accesses::default());
}

#[test]
fn every_pattern_compiles() {
    for pattern in [LINE_PATTERN, STRING_PATTERN, DIRFD_PATTERN, CWD_PATTERN] {
        assert!(Regex::new(pattern).is_ok(), "{pattern}");
    }
}

proptest! {
    #[test]
    fn parsing_never_panics_and_paths_stay_absolute(
        lines in proptest::collection::vec("\\PC{0,120}", 0..20),
        call in prop::sample::select(vec!["openat", "stat", "statx", "access", "execve", "chdir"]),
        path in "[a-z./]{0,30}",
    ) {
        let mut text: Vec<String> = lines;
        text.push(format!("{call}(\"{path}\", O_RDONLY) = 0"));
        let refs: Vec<&str> = text.iter().map(String::as_str).collect();

        let accesses = parse_logs(&[log(1, &refs)], "/w");

        for found in accesses.reads.iter().chain(&accesses.probes).chain(&accesses.dirs) {
            prop_assert!(found.starts_with('/'), "{found}");
            prop_assert_eq!(found, &paths::normalize(found));
        }
    }
}
