/**
 * The run the live Ask timing is calibrated on (`docs/claude-opus/14` §11): the v2 seed-7
 * race `7z4j84eqvl`, whose repository (114 files) is the one the 22 s live measurement read.
 * It is kept here, apart from the demo fixtures in `fixtures/`, so rebuilding those does
 * not move the calibration.
 */
import events from './fixtures/7z4j84eqvl/events.jsonl?raw';
import repo from './fixtures/7z4j84eqvl/repo.json?raw';
import tasks from './fixtures/7z4j84eqvl/tasks.json?raw';
import type { RecordedRun } from '../../recorded/recorded-runs';
import { parseRecorded } from '../../recorded/recorded-runs';

export function calibrationRun(): RecordedRun {
  return parseRecorded({
    run: '7z4j84eqvl',
    label: 'Beanstalk v2',
    policyName: 'beanstalk-v2',
    summary: 'The v2 seed-7 race the live Ask timing is calibrated on',
    // v2 before v2.2: agents waited for their beans' checks.
    options: { releaseOnCheck: false },
    texts: { events, tasks, repo },
  });
}
