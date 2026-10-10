import { describe, expect, it } from 'vitest';

import {
  AUTOMATIONS_DIR,
  AUTOMATIONS_DIRS,
  WorkflowPath,
  isAutomationPath,
  preferredAutomationPaths,
} from './actions';
import { AutomationPath, automationPathFor } from './automation-editor';
import { CONFIG_DIRS, configPaths, readFirstPresent } from './config-dir';

const reader = (files: Readonly<Record<string, string>>) => (path: string) =>
  Promise.resolve(files[path] ?? null);

describe('the configuration directory', () => {
  it('looks in .gitstalk/ first, then .beanstalk/ from before the rename', () => {
    expect(CONFIG_DIRS).toEqual(['.gitstalk', '.beanstalk']);
    expect(configPaths('backlog.md')).toEqual(['.gitstalk/backlog.md', '.beanstalk/backlog.md']);
  });

  it('reads the .gitstalk/ file when both exist', async () => {
    const found = await readFirstPresent(
      configPaths('checks.toml'),
      reader({ '.gitstalk/checks.toml': 'new', '.beanstalk/checks.toml': 'old' }),
    );
    expect(found).toEqual({ path: '.gitstalk/checks.toml', text: 'new' });
  });

  it('falls back to the .beanstalk/ file, and finds nothing when neither exists', async () => {
    const paths = configPaths('checks.toml');
    expect(await readFirstPresent(paths, reader({ '.beanstalk/checks.toml': 'old' }))).toEqual({
      path: '.beanstalk/checks.toml',
      text: 'old',
    });
    expect(await readFirstPresent(paths, reader({}))).toBeNull();
  });
});

describe('automation files in either directory', () => {
  it('accepts both directories as automation paths', () => {
    expect(AUTOMATIONS_DIRS).toEqual(['.gitstalk/automations', '.beanstalk/automations']);
    for (const path of [
      '.gitstalk/automations/fix-red.yml',
      '.beanstalk/automations/fix-red.yml',
    ]) {
      expect(isAutomationPath(path)).toBe(true);
      expect(WorkflowPath.safeParse(path).success).toBe(true);
      expect(AutomationPath.safeParse(path).success).toBe(true);
    }
    expect(isAutomationPath('.github/workflows/ci.yml')).toBe(false);
    expect(isAutomationPath('.other/automations/x.yml')).toBe(false);
  });

  it('writes a new automation under .gitstalk/automations/', () => {
    expect(AUTOMATIONS_DIR).toBe('.gitstalk/automations');
    expect(automationPathFor('Fix red beans')).toBe('.gitstalk/automations/fix-red-beans.yml');
  });

  it('lists both, and a .gitstalk/ file hides its .beanstalk/ namesake', () => {
    expect(
      preferredAutomationPaths([
        '.github/workflows/ci.yml',
        '.gitstalk/automations/nightly.yml',
        '.gitstalk/automations/fix-red.yml',
        '.beanstalk/automations/fix-red.yml',
        '.beanstalk/automations/heartbeat.md',
      ]),
    ).toEqual([
      '.github/workflows/ci.yml',
      '.gitstalk/automations/nightly.yml',
      '.gitstalk/automations/fix-red.yml',
      '.beanstalk/automations/heartbeat.md',
    ]);
  });
});
