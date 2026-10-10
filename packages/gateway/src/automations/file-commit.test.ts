import { describe, expect, it } from 'vitest';

import type { RepoTreeEntry } from '@gitstalk/shared-race/rpc';

import type { DirectoryReader } from './file-commit';
import { buildFileCommit } from './file-commit';

/**
 * The ids below are real git's, from a fixture repository: `git write-tree` after the same
 * change, and `git commit-tree` with the same author, time and message. Matching them shows
 * the Worker writes byte-identical objects (modes, entry order, directory removal).
 */
const BASE = '8a56e58ac8716b6c8b4d19d7aa2dd7fe55a059be';
const DIRECTORIES: Readonly<Record<string, readonly RepoTreeEntry[]>> = {
  '': [
    entry('.beanstalk', 'tree', 'd70a136172e53f3bf182b80fb609ea92a44a5055'),
    entry('README.md', 'blob', '45b983be36b73c0788dc9cbcb76cbb80fc7bb057'),
    entry('run.sh', 'exec', '1a2485251c33a70432394c93fb89330ef214bfc9'),
    entry('src', 'tree', 'f446eca6c84920c6dd5a92843f26e6027cd3c352'),
  ],
  '.beanstalk': [entry('automations', 'tree', '07789fbd8089a8ba675f7d14c1d0f4529faf6789')],
  '.beanstalk/automations': [entry('a.yml', 'blob', '22371deb3e6cb1ee750d09b46f140e21b124ee6a')],
};
const read: DirectoryReader = (path) => Promise.resolve(DIRECTORIES[path] ?? null);
const AUTHOR = { name: 'coop', email: 'coop@users.x', atMs: 1_700_000_100_000 };

describe('a file change as a git commit', () => {
  it('writes the same trees and commit as git for an edit', async () => {
    const built = await buildFileCommit(read, {
      base: { commit: BASE },
      path: '.beanstalk/automations/a.yml',
      content: 'name: B\n',
      author: AUTHOR,
      message: 'Edit automation a.yml',
    });
    expect(built.commit).toBe('b0002cc33ec3b9e110f9b6ab6319c0915f5dacbd');
    expect(built.objects.map((object) => object.type)).toEqual([
      'blob',
      'tree',
      'tree',
      'tree',
      'commit',
    ]);
    expect(built.objects.at(-2)?.id).toBe('e020ef7dc3a23ea950a490c6b16dea7cc069961f');
  });

  it('adds a file beside the others', async () => {
    const built = await buildFileCommit(read, {
      base: { commit: BASE },
      path: '.beanstalk/automations/b.yml',
      content: 'name: C\n',
      author: AUTHOR,
      message: 'Add automation b.yml',
    });
    expect(built.objects.at(-2)?.id).toBe('e30964d0712afd57840d332d7bb713babe2121be');
  });

  it('deletes a file and the directories it leaves empty', async () => {
    const built = await buildFileCommit(read, {
      base: { commit: BASE },
      path: '.beanstalk/automations/a.yml',
      content: null,
      author: AUTHOR,
      message: 'Delete automation a.yml',
    });
    expect(built.blob).toBeNull();
    expect(built.objects.map((object) => object.type)).toEqual(['tree', 'commit']);
    expect(built.objects[0]?.id).toBe('09f0d7c17a3834bcfeb7079a9e36a68b43823ffe');
  });

  it('creates missing directories for a first automation', async () => {
    const built = await buildFileCommit((path) => Promise.resolve(path === '' ? [] : null), {
      base: { commit: BASE },
      path: '.beanstalk/automations/first.yml',
      content: 'name: First\n',
      author: AUTHOR,
      message: 'Add automation first.yml',
    });
    expect(built.objects.map((object) => object.type)).toEqual([
      'blob',
      'tree',
      'tree',
      'tree',
      'commit',
    ]);
  });
});

function entry(name: string, type: RepoTreeEntry['type'], sha: string): RepoTreeEntry {
  return { name, path: name, type, sha };
}
