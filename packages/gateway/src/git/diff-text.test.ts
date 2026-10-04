import { describe, expect, it } from 'vitest';

import { diffText, renderDiff } from './diff-text';

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

  it('cuts at the limit and says how much is left, as diff_text does', () => {
    const full = renderDiff([change('src/a.ts', 'one\n', 'two\n')]);

    expect(diffText([change('src/a.ts', 'one\n', 'two\n')], 10)).toBe(
      `${full.slice(0, 10)}\n... [diff truncated, ${full.length - 10} more chars]\n`,
    );
    expect(diffText([change('src/a.ts', 'one\n', 'two\n')], 10_000)).toBe(full);
  });

  it('is empty when nothing changed', () => {
    expect(renderDiff([change('same.ts', 'x\n', 'x\n')])).toBe('');
  });
});
