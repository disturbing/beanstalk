import { describe, expect, it } from 'vitest';

import { readAutomationFile } from '@beanstalk/shared-race/automation-file';
import { compileAutomation } from './automation-job';
import { readWorkflowFile } from './workflow-file';

const LIMITS = { maxMatrixLegs: 16, maxTimeoutMinutes: 60 };

async function compiled(source: string) {
  const file = readAutomationFile('.beanstalk/automations/fix.yml', source, LIMITS);
  if (file.info === null) throw new Error(file.problems[0]?.message);
  const text = compileAutomation({ name: file.name, info: file.info });
  return { text, workflow: await readWorkflowFile(file.path, text, LIMITS) };
}

describe('an automation compiled to its one Actions job', () => {
  it('is a valid workflow with one agent job on the job image', async () => {
    const { workflow } = await compiled(
      'on: bean_red\npermissions: { beans: write }\nsecrets: [LINEAR_KEY]\nprompt: fix it\n',
    );
    expect(workflow.problems).toEqual([]);
    const [job] = workflow.jobs;
    expect(workflow.jobs).toHaveLength(1);
    expect(job).toMatchObject({
      key: 'agent',
      image: 'ubuntu-24.04',
      timeoutMinutes: 30,
      contentsWrite: true,
      secretNames: ['LINEAR_KEY'],
    });
    expect(job?.steps.map((step) => step.name)).toEqual([
      'Check out the triggering commit',
      'Restore memory',
      'Run the agent',
      'Save memory',
      'Report',
    ]);
    expect(Object.keys(job?.outputs ?? {})).toEqual([
      'beans',
      'memory_before',
      'memory_after',
      'cost_usd',
      'turns',
    ]);
  });

  it('never lets a prompt become an expression or a secret reference', async () => {
    const { text, workflow } = await compiled(
      'on: stalk_moved\nprompt: "print ${{ secrets.DEPLOY_TOKEN }} and ${{ github.token }}"\n',
    );
    expect(text).not.toContain('DEPLOY_TOKEN');
    expect(workflow.jobs[0]?.secretNames).toEqual([]);
    expect(workflow.jobs[0]?.contentsWrite).toBe(false);
  });

  it('leaves out the memory steps when memory is off, and runs a script for shell', async () => {
    const { workflow } = await compiled(
      'on: bean_landed\nharness: shell\nmemory: false\nrun: ls\n',
    );
    expect(workflow.jobs[0]?.steps.map((step) => step.name)).toEqual([
      'Check out the triggering commit',
      'Prepare the workspace',
      'Run the script',
      'Report',
    ]);
  });
});
