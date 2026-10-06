import { describe, expect, it } from 'vitest';

import { diffReport, diffText, renderDiff } from './diff-text';

const change = (path: string, before: string | null, after: string | null) => ({
  path,
  before,
  after,
  beforeId: before === null ? null : 'a'.repeat(40),
  afterId: after === null ? null : 'b'.repeat(40),
});

describe('git diff --stat -p', () => {
  it('renders a one-line change with the stat block, header and hunk git prints', () => {
    expect(renderDiff([change('src/a.ts', 'one\ntwo\nthree\n', 'one\n2\nthree\n')])).toBe(
      ' src/a.ts | 2 +-\n' +
        ' 1 file changed, 1 insertion(+), 1 deletion(-)\n' +
        '\n' +
        'diff --git a/src/a.ts b/src/a.ts\n' +
        'index aaaaaaa..bbbbbbb 100644\n' +
        '--- a/src/a.ts\n' +
        '+++ b/src/a.ts\n' +
        '@@ -1,3 +1,3 @@\n' +
        ' one\n' +
        '-two\n' +
        '+2\n' +
        ' three\n',
    );
  });

  it('shows new and deleted files against /dev/null', () => {
    const text = renderDiff([change('b.ts', null, 'x\ny\n'), change('a.ts', 'gone\n', null)]);

    expect(text).toContain(' 2 files changed, 2 insertions(+), 1 deletion(-)\n');
    expect(text).toContain(
      'new file mode 100644\nindex 0000000..bbbbbbb\n--- /dev/null\n+++ b/b.ts\n@@ -0,0 +1,2 @@\n+x\n+y\n',
    );
    expect(text).toContain(
      'deleted file mode 100644\nindex aaaaaaa..0000000\n--- a/a.ts\n+++ /dev/null\n@@ -1 +0,0 @@\n-gone\n',
    );
    expect(text.indexOf('a/a.ts')).toBeLessThan(text.indexOf('b/b.ts'));
  });

  it('keeps far-apart changes in separate hunks with the enclosing function as context', () => {
    const lines = Array.from({ length: 30 }, (_, index) => `  line ${index}`);
    const before = ['function total() {', ...lines, '}', ''].join('\n');
    const edited = [...lines];
    edited[2] = '  changed 2';
    edited[25] = '  changed 25';
    const after = ['function total() {', ...edited, '}', ''].join('\n');

    const text = renderDiff([change('t.ts', before, after)]);

    expect(text.match(/^@@ /gm)).toHaveLength(2);
    expect(text).toContain('@@ -1,7 +1,7 @@\n');
    expect(text).toContain('@@ -24,7 +24,7 @@ function total() {\n');
  });

  it('marks a missing final newline', () => {
    expect(renderDiff([change('n.txt', 'a', 'b')])).toContain(
      '-a\n\\ No newline at end of file\n+b\n\\ No newline at end of file\n',
    );
  });

  it('cuts at the limit and says how much is left, exactly when every file was rendered', () => {
    const one = [change('src/a.ts', 'one\n', 'two\n')];
    const full = renderDiff(one);

    expect(diffText(one, full.length - 5)).toBe(
      `${full.slice(0, full.length - 5)}\n... [diff truncated, 5 more chars]\n`,
    );
    expect(diffText(one, 10_000)).toBe(full);
  });

  it('is empty when nothing changed', () => {
    expect(renderDiff([change('same.ts', 'x\n', 'x\n')])).toBe('');
  });
});

describe('diffReport', () => {
  const many = ['a.ts', 'b.ts', 'c.ts'].map((path) => change(path, 'one\n', `${path}\n`));

  it('stops rendering patches once the limit is crossed and keeps every file in the stats', () => {
    const report = diffReport(many, 150);

    expect(report.truncated).toBe(true);
    expect(report.text).toContain('diff --git a/a.ts');
    expect(report.text).not.toContain('diff --git a/c.ts');
    expect(report.text).toMatch(/\[diff truncated, at least \d+ more chars\]\n$/);
    expect(report.files).toEqual(
      many.map((file) => ({ path: file.path, status: 'modified', additions: 1, deletions: 1 })),
    );
  });

  it('counts lines from the same diff the patch is rendered from', () => {
    const report = diffReport(
      [change('b.ts', null, 'x\ny\n'), change('a.ts', 'gone\n', null)],
      10_000,
    );

    expect(report.truncated).toBe(false);
    expect(report.files).toEqual([
      { path: 'b.ts', status: 'added', additions: 2, deletions: 0 },
      { path: 'a.ts', status: 'deleted', additions: 0, deletions: 1 },
    ]);
  });

  it('shows a side too large to load as a binary file with its byte counts', () => {
    const big = {
      ...change('big.txt', '', 'x'),
      binary: true,
      beforeBytes: 300_000,
      afterBytes: 400_000,
    };
    const report = diffReport([big], 10_000);

    expect(report.text).toContain(' big.txt | Bin 300000 -> 400000 bytes\n');
    expect(report.text).toContain('Binary files a/big.txt and b/big.txt differ\n');
    expect(report.files).toEqual([
      { path: 'big.txt', status: 'modified', additions: 0, deletions: 0 },
    ]);
  });
});
