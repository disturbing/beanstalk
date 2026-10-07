import { describe, expect, it } from 'vitest';

import { receivePackBody, refusedRefs } from '../adapters/repository-storage';
import { emptyPack, objectId, seedPack } from './seed-pack';

const encoder = new TextEncoder();

describe('the pack writer', () => {
  it('names objects as git does', async () => {
    // `git hash-object` of "hello\n", and git's empty tree.
    expect(await objectId({ kind: 'blob', body: encoder.encode('hello\n') })).toBe(
      'ce013625030ba8dba906f756967f9e9ca394464a',
    );
    expect(await objectId({ kind: 'tree', body: new Uint8Array() })).toBe(
      '4b825dc642cb6eb9a060e54bf8d69288fbee4904',
    );
  });

  it('writes the commit git itself computes for the same files (checked with git fsck)', async () => {
    const { commit, pack } = await seedPack({
      files: [
        { path: 'README.md', content: '# hi\n' },
        { path: 'src/a.ts', content: 'export const a = 1;\n' },
        { path: 'src-x.ts', content: 'x\n' },
        { path: 'test/a.test.ts', content: 't\n' },
        { path: 'src/deep/b.ts', content: 'b\n' },
      ],
      message: 'Initial commit',
      author: { name: 'Beanstalk', email: 'seed@beanstalk.invalid' },
      time: 1_760_000_000,
    });
    // `src-x.ts` sorts before the `src/` tree, as git orders a directory as `src/`.
    expect(commit).toBe('70d02eb4250987d54f328a3b454dbd5883c73f14');
    expect(new TextDecoder().decode(pack.slice(0, 4))).toBe('PACK');
    // Five blobs, four trees (root, src, src/deep, test) and the commit.
    expect(new DataView(pack.buffer, pack.byteOffset).getUint32(8)).toBe(10);
  });

  it('writes an empty pack for a push that only creates refs', async () => {
    const pack = await emptyPack();
    expect(pack.length).toBe(32);
    expect(new DataView(pack.buffer, pack.byteOffset).getUint32(8)).toBe(0);
  });
});

describe('the seeding push', () => {
  it('creates the stalk and the sprout in one receive-pack request', () => {
    const commit = 'a'.repeat(40);
    const text = new TextDecoder().decode(receivePackBody(commit, new Uint8Array()));
    expect(text).toBe(
      `0075${'0'.repeat(40)} ${commit} refs/heads/stalk\0report-status\n` +
        `0068${'0'.repeat(40)} ${commit} refs/heads/sprout\n0000`,
    );
  });

  it('reads refusals from the report', () => {
    expect(refusedRefs('000eunpack ok\n0019ok refs/heads/stalk\n0000')).toEqual([]);
    expect(refusedRefs('000eunpack ok\n0026ng refs/heads/stalk protected\n0000')).toEqual([
      'ng refs/heads/stalk protected',
    ]);
    expect(refusedRefs('0019unpack index-pack failed\n0000')).toEqual(['unpack index-pack failed']);
  });
});
