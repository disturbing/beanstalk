import { describe, expect, it } from 'vitest';

import type { StreamDelta, StreamFile } from '@beanstalk/shared-race/driver';
import { StreamDelta as DeltaSchema, STREAM_MAX_PATCH_BYTES } from '@beanstalk/shared-race/driver';

import type {
  PostDecision,
  PostInput,
  StoredBean,
  StoredFileStat,
  StreamInvocation,
} from './stream-rules';
import { decidePost, patchBytes, STREAM_MIN_INTERVAL_MS } from './stream-rules';

const NOW = 1_000_000;

const invocation: StreamInvocation = {
  inv: 'inv0003-initial',
  task: 't001',
  slot: 'a0',
  kind: 'initial',
  openedMs: NOW - 10_000,
  openedT: 40,
  closedMs: null,
};

function file(path: string, patch: string | null = `@@ -1 +1 @@\n-a\n+${path}\n`): StreamFile {
  return { path, status: 'modified', additions: 1, deletions: 1, binary: false, patch };
}

function stat(path: string, bytes: number | null = 20): StoredFileStat {
  return {
    path,
    status: 'modified',
    additions: 1,
    deletions: 1,
    binary: false,
    patchBytes: bytes,
    redacted: 0,
  };
}

const stored: StoredBean = {
  task: 't001',
  inv: invocation.inv,
  agent: 'a0',
  seq: 4,
  atMs: NOW - 1000,
  t: 49,
  truncated: false,
  redacted: 0,
  additions: 2,
  deletions: 2,
};

function delta(fields: Partial<StreamDelta>): StreamDelta {
  return DeltaSchema.parse({ seq: 5, files: [], ...fields });
}

function input(fields: Partial<PostInput>): PostInput {
  return {
    isStreamingRun: true,
    invocation,
    bean: stored,
    files: [stat('src/a.ts'), stat('src/b.ts')],
    slot: 'a0',
    inv: invocation.inv,
    nowMs: NOW,
    delta: delta({ base_seq: 4, files: [file('src/b.ts')] }),
    ...fields,
  };
}

function applied(decision: PostDecision): Extract<PostDecision, { kind: 'apply' }> {
  if (decision.kind !== 'apply') throw new Error(`expected an applied post, got ${decision.kind}`);
  return decision;
}

describe('decidePost', () => {
  it('refuses posts the run, the invocation or the slot does not allow', () => {
    const codes = [
      decidePost(input({ invocation: null, isStreamingRun: false })),
      decidePost(input({ invocation: null })),
      decidePost(input({ invocation: { ...invocation, closedMs: NOW - 1 } })),
      decidePost(input({ slot: 'a1' })),
      decidePost(input({ invocation: { ...invocation, kind: 'reconcile' } })),
    ].map((decision) => (decision.kind === 'refuse' ? decision.refusal.code : decision.kind));

    expect(codes).toEqual([
      'stream_off',
      'unknown_invocation',
      'closed_invocation',
      'wrong_slot',
      'invalid_state',
    ]);
  });

  it('ignores a seq that is not newer, a post too soon, and a delta on another base', () => {
    const answers = [
      decidePost(input({ delta: delta({ seq: 4, base_seq: 4 }) })),
      decidePost(input({ nowMs: stored.atMs + STREAM_MIN_INTERVAL_MS - 1 })),
      decidePost(input({ delta: delta({ base_seq: 3 }) })),
      decidePost(input({ bean: null, delta: delta({ base_seq: 4 }) })),
    ].map((decision) => (decision.kind === 'ignore' ? decision.response : decision.kind));

    expect(answers).toEqual([
      { accepted: false, reason: 'stale', seq: 4 },
      { accepted: false, reason: 'rate', seq: 4 },
      { accepted: false, reason: 'resync', seq: 4 },
      { accepted: false, reason: 'resync', seq: 0 },
    ]);
  });

  it('writes only the changed and removed files of a delta, and patches only them', () => {
    const decision = applied(
      decidePost(
        input({ delta: delta({ base_seq: 4, files: [file('src/c.ts')], removed: ['src/a.ts'] }) }),
      ),
    );

    expect(decision.write.upserts.map((f) => f.path)).toEqual(['src/c.ts']);
    expect(decision.write.deletes).toEqual(['src/a.ts']);
    expect(decision.summary.files.map((f) => f.path)).toEqual(['src/b.ts', 'src/c.ts']);
    expect(decision.summary).toMatchObject({ seq: 5, t: 50, agent: 'a0', additions: 2 });
    expect(decision.patch).toMatchObject({ base_seq: 4, removed: ['src/a.ts'] });
    expect(decision.patch.files.map((f) => f.path)).toEqual(['src/c.ts']);
  });

  it('replaces everything with a full snapshot, and starts a new invocation from scratch', () => {
    const fullPost = applied(decidePost(input({ delta: delta({ files: [file('src/z.ts')] }) })));
    const rework = applied(
      decidePost(
        input({
          inv: 'inv0009-rework',
          invocation: { ...invocation, inv: 'inv0009-rework', kind: 'rework' },
          delta: delta({ seq: 1, files: [file('src/b.ts')] }),
        }),
      ),
    );

    expect(fullPost.write.deletes).toEqual(['src/a.ts', 'src/b.ts']);
    expect(fullPost.patch).toMatchObject({ base_seq: 0, removed: [] });
    expect(rework.write.deletes).toEqual(['src/a.ts']);
    expect(rework.summary).toMatchObject({ inv: 'inv0009-rework', seq: 1 });
  });

  it('scans only the delta for secrets, and keeps the stored count of the other files', () => {
    const leak = '@@ -0,0 +1 @@\n+const key = "sk-ant-api03-abcdefghij";\n';
    const decision = applied(
      decidePost(
        input({
          files: [{ ...stat('src/a.ts'), redacted: 2 }, stat('src/b.ts')],
          delta: delta({ base_seq: 4, files: [file('src/b.ts', leak), file('/Users/coop/x.ts')] }),
        }),
      ),
    );

    expect(JSON.stringify(decision.patch)).not.toContain('sk-ant-');
    expect(decision.patch.files.map((f) => f.path)).toContain('redacted-path');
    expect(decision.summary.redacted).toBe(4);
  });

  it('keeps a file without its patch once the stored snapshot would pass 64 KB', () => {
    const big = `@@ -1 +1 @@\n+${'x'.repeat(4000)}\n`;
    const decision = applied(
      decidePost(
        input({
          files: [stat('src/a.ts', STREAM_MAX_PATCH_BYTES - 3000)],
          delta: delta({ base_seq: 4, files: [file('src/b.ts', big), file('src/c.ts')] }),
        }),
      ),
    );

    const patches = Object.fromEntries(decision.write.upserts.map((f) => [f.path, f.patch]));
    expect(patches['src/b.ts']).toBeNull();
    expect(patchBytes(patches['src/c.ts'] ?? null)).toBeGreaterThan(0);
    expect(decision.summary.truncated).toBe(true);
  });

  it('leaves out new files past 200', () => {
    const files = Array.from({ length: 200 }, (_, index) => stat(`src/f${index}.ts`));
    const decision = applied(
      decidePost(input({ files, delta: delta({ base_seq: 4, files: [file('src/new.ts')] }) })),
    );

    expect(decision.write.upserts).toEqual([]);
    expect(decision.summary.files).toHaveLength(200);
    expect(decision.summary.truncated).toBe(true);
  });
});
