/**
 * The fake control plane's repository: four workflows as a small Worker shop would have them
 * (CI, Deploy, a nightly end-to-end run and a Docker image build that never runs here), each
 * job a script of timed, ANSI-coloured log lines. Staging and tests only: never a real run.
 */
import type { Annotation, Workflow } from '../actions-contract';

/** A log line `atMs` after its step starts. */
export type ScriptLine = readonly [atMs: number, text: string];

export type StepScript = {
  readonly name: string;
  readonly ms: number;
  readonly lines: readonly ScriptLine[];
};

export type JobScript = {
  readonly id: string;
  readonly name: string;
  readonly needs: readonly string[];
  readonly runsOn: string;
  readonly steps: readonly StepScript[];
};

/** How a failing run of the workflow fails: one step, its last lines, and what it annotates. */
export type FailureScript = {
  readonly jobId: string;
  readonly step: number;
  readonly atMs: number;
  readonly lines: readonly ScriptLine[];
  readonly annotation: Omit<Annotation, 'jobId'>;
};

export type WorkflowScript = {
  /** Short and id-safe: run ids start with it. */
  readonly key: string;
  readonly workflow: Omit<Workflow, 'lastRun'>;
  readonly jobs: readonly JobScript[];
  readonly failure: FailureScript | null;
  /** Annotations every finished run carries (a lint warning). */
  readonly warnings: readonly Annotation[];
  readonly summary: string | null;
};

const ESC = '\u001b[';
const green = (text: string) => `${ESC}32m${text}${ESC}39m`;
const red = (text: string) => `${ESC}31m${text}${ESC}39m`;
const yellow = (text: string) => `${ESC}33m${text}${ESC}39m`;
const cyan = (text: string) => `${ESC}36m${text}${ESC}39m`;
const dim = (text: string) => `${ESC}2m${text}${ESC}22m`;
const bold = (text: string) => `${ESC}1m${text}${ESC}22m`;

const SET_UP: StepScript = {
  name: 'Set up job',
  ms: 2000,
  lines: [
    [0, 'Current runner version: beanstalk-act 0.2.80'],
    [200, 'Image: ubuntu-24.04 (beanstalk/actions-runner@sha256:4be1…c09d)'],
    [600, 'Resolving actions/checkout@v4 → b4ffde65f46336ab88eb53be808477a3936bae11'],
    [900, 'Resolving actions/setup-node@v4 → 39370e3970a6d050c480ffad4ff0ed4d3fdee5af'],
    [1400, dim('GITHUB_TOKEN permissions: contents read')],
  ],
};

const CHECKOUT: StepScript = {
  name: 'actions/checkout@v4',
  ms: 1500,
  lines: [
    [0, 'Syncing repository: acme/shop'],
    [
      300,
      `${cyan('[command]')}/usr/bin/git fetch --depth=1 origin +refs/heads/main:refs/remotes/origin/main`,
    ],
    [900, 'From https://bs.internal/acme/shop'],
    [1100, ' * [new ref]         main       -> origin/main  (the stalk)'],
  ],
};

const SETUP_NODE: StepScript = {
  name: 'actions/setup-node@v4',
  ms: 5000,
  lines: [
    [0, 'Attempting to download 24.x...'],
    [1800, 'Found in cache @ /opt/hostedtoolcache/node/24.9.0/x64'],
    [2400, `${cyan('[command]')}/opt/hostedtoolcache/node/24.9.0/x64/bin/node --version`],
    [2600, 'v24.9.0'],
  ],
};

const NPM_CI: StepScript = {
  name: 'npm ci',
  ms: 14000,
  lines: [
    [0, `${cyan('[command]')}npm ci`],
    [6000, `${yellow('npm warn')} deprecated inflight@1.0.6: This module is not supported`],
    [12500, 'added 312 packages, and audited 313 packages in 12s'],
    [13200, `found ${bold('0')} vulnerabilities`],
  ],
};

const TEST_FILES = [
  'cart',
  'checkout',
  'currency',
  'discounts',
  'inventory',
  'orders',
  'pricing',
  'receipts',
  'search',
  'shipping',
  'slugify',
  'tax',
  'totals',
  'users',
  'wishlist',
  'webhooks',
] as const;

const TEST_STEP_MS = 46000;

function testLines(): readonly ScriptLine[] {
  const header: ScriptLine[] = [
    [0, `${cyan('[command]')}npm test`],
    [400, ''],
    [600, `> shop@1.4.0 test`],
    [700, `> vitest run`],
    [1500, ''],
    [1600, ` ${bold('RUN')}  ${cyan('v3.2.4')} /home/runner/work/shop`],
    [1700, ''],
  ];
  const files = TEST_FILES.map((file, index): ScriptLine => {
    const tests = 3 + ((index * 7) % 11);
    const ms = 20 + ((index * 37) % 180);
    return [
      2600 + index * 2600,
      ` ${green('✓')} test/${file}.test.ts ${dim(`(${tests} tests)`)} ${yellow(`${ms}ms`)}`,
    ];
  });
  return [
    ...header,
    ...files,
    [44000, ''],
    [
      44100,
      ` ${dim('Test Files')}  ${bold(green(`${TEST_FILES.length} passed`))} (${TEST_FILES.length})`,
    ],
    [44200, `      ${dim('Tests')}  ${bold(green('118 passed'))} (118)`],
    [44300, `   ${dim('Duration')}  41.62s`],
  ];
}

const FAILED_TEST_AT = 2600 + 11 * 2600;

const CI: WorkflowScript = {
  key: 'ci',
  workflow: {
    id: '.github/workflows/ci.yml',
    name: 'CI',
    path: '.github/workflows/ci.yml',
    triggers: [
      { event: 'push', branches: ['main'] },
      { event: 'workflow_dispatch', inputs: [] },
      {
        event: 'other',
        name: 'pull_request',
        support: 'later',
        reason: 'Runs on each pushed bean after the MVP (25 §2).',
      },
    ],
    notes: [{ level: 'differs', text: 'pull_request is parsed and will run on beans soon.' }],
    error: null,
    automation: null,
  },
  jobs: [
    {
      id: 'lint',
      name: 'lint',
      needs: [],
      runsOn: 'ubuntu-latest',
      steps: [
        SET_UP,
        CHECKOUT,
        SETUP_NODE,
        NPM_CI,
        {
          name: 'npm run lint',
          ms: 6000,
          lines: [
            [0, `${cyan('[command]')}npm run lint`],
            [1800, 'src/cart.ts'],
            [
              1900,
              `  12:9  ${yellow('warning')}  'total' is assigned a value but never used  no-unused-vars`,
            ],
            [2600, ''],
            [2700, yellow('✖ 1 problem (0 errors, 1 warning)')],
          ],
        },
      ],
    },
    {
      id: 'build',
      name: 'build',
      needs: [],
      runsOn: 'ubuntu-latest',
      steps: [
        SET_UP,
        CHECKOUT,
        SETUP_NODE,
        NPM_CI,
        {
          name: 'npm run build',
          ms: 11000,
          lines: [
            [0, `${cyan('[command]')}npm run build`],
            [900, `${cyan('vite')} v7.1.4 building for production...`],
            [6000, `${green('✓')} 214 modules transformed.`],
            [9500, `dist/worker.js  ${dim('184.31 kB │ gzip: 41.20 kB')}`],
            [10200, `${green('✓')} built in 9.48s`],
          ],
        },
      ],
    },
    {
      id: 'test',
      name: 'test',
      needs: ['lint', 'build'],
      runsOn: 'ubuntu-latest',
      steps: [
        SET_UP,
        CHECKOUT,
        SETUP_NODE,
        NPM_CI,
        { name: 'npm test', ms: TEST_STEP_MS, lines: testLines() },
      ],
    },
  ],
  failure: {
    jobId: 'test',
    step: 5,
    atMs: FAILED_TEST_AT + 2200,
    lines: [
      [
        FAILED_TEST_AT,
        ` ${red('✗')} test/tax.test.ts ${dim('(9 tests | 1 failed)')} ${yellow('61ms')}`,
      ],
      [FAILED_TEST_AT + 100, `   ${red('×')} applies the reduced rate to books`],
      [FAILED_TEST_AT + 300, ''],
      [
        FAILED_TEST_AT + 400,
        red(bold(' FAIL ') + ' test/tax.test.ts > applies the reduced rate to books'),
      ],
      [
        FAILED_TEST_AT + 500,
        `${red('AssertionError')}: expected ${green('4.35')} to be ${red('4.5')}`,
      ],
      [FAILED_TEST_AT + 600, ` ❯ test/tax.test.ts:${bold('27')}:31`],
      [FAILED_TEST_AT + 700, ''],
      [FAILED_TEST_AT + 800, `::error file=test/tax.test.ts,line=27::expected 4.35 to be 4.5`],
      [
        FAILED_TEST_AT + 1600,
        ` ${dim('Test Files')}  ${red(bold('1 failed'))} | ${green('11 passed')} (12)`,
      ],
      [FAILED_TEST_AT + 1800, `${red('Error')}: Process completed with exit code 1.`],
    ],
    annotation: {
      level: 'error',
      message: 'applies the reduced rate to books: expected 4.35 to be 4.5',
      path: 'test/tax.test.ts',
      line: 27,
    },
  },
  warnings: [
    {
      level: 'warning',
      message: "'total' is assigned a value but never used",
      jobId: 'lint',
      path: 'src/cart.ts',
      line: 12,
    },
  ],
  summary: null,
};

const DEPLOY: WorkflowScript = {
  key: 'deploy',
  workflow: {
    id: '.github/workflows/deploy.yml',
    name: 'Deploy',
    path: '.github/workflows/deploy.yml',
    triggers: [
      { event: 'push', branches: ['main'] },
      {
        event: 'workflow_dispatch',
        inputs: [
          {
            name: 'environment',
            description: 'Where to deploy',
            type: 'choice',
            required: true,
            default: 'staging',
            options: ['staging', 'production'],
          },
          {
            name: 'dry-run',
            description: 'Build and check, upload nothing',
            type: 'boolean',
            required: false,
            default: 'false',
            options: [],
          },
          {
            name: 'note',
            description: 'Shown in the deploy summary',
            type: 'string',
            required: false,
            default: null,
            options: [],
          },
        ],
      },
    ],
    notes: [{ level: 'differs', text: 'concurrency is enforced by Beanstalk, outside act.' }],
    error: null,
    automation: null,
  },
  jobs: [
    {
      id: 'deploy',
      name: 'deploy',
      needs: [],
      runsOn: 'ubuntu-latest',
      steps: [
        SET_UP,
        CHECKOUT,
        SETUP_NODE,
        NPM_CI,
        {
          name: 'npx wrangler deploy',
          ms: 9000,
          lines: [
            [0, `${cyan('[command]')}npx wrangler deploy`],
            [400, dim('CLOUDFLARE_API_TOKEN=***')],
            [1400, ` ⛅️ wrangler 4.40.0`],
            [2600, 'Total Upload: 41.20 KiB / gzip: 9.87 KiB'],
            [5600, 'Uploaded shop (2.31 sec)'],
            [7400, 'Deployed shop triggers (0.42 sec)'],
            [7600, `  ${cyan('https://shop.acme.workers.dev')}`],
            [8000, `Current Version ID: ${dim('8f2c1a4e-0d1b-4c55-9f0e-1b2a3c4d5e6f')}`],
          ],
        },
      ],
    },
  ],
  failure: null,
  warnings: [],
  summary:
    '### Deployed shop\n\n| Environment | URL |\n|---|---|\n| production | https://shop.acme.workers.dev |\n\nVersion `8f2c1a4e` uploaded in 2.31 s.',
};

const E2E: WorkflowScript = {
  key: 'e2e',
  workflow: {
    id: '.github/workflows/e2e.yml',
    name: 'Nightly e2e',
    path: '.github/workflows/e2e.yml',
    triggers: [
      { event: 'schedule', crons: ['0 3 * * *'] },
      { event: 'workflow_dispatch', inputs: [] },
    ],
    notes: [],
    error: null,
    automation: null,
  },
  jobs: ['chromium', 'webkit'].map((browser): JobScript => ({
    id: `e2e-${browser}`,
    name: `e2e (${browser})`,
    needs: [],
    runsOn: 'ubuntu-latest',
    steps: [
      SET_UP,
      CHECKOUT,
      SETUP_NODE,
      NPM_CI,
      {
        name: `npx playwright test --project=${browser}`,
        ms: 30000,
        lines: [
          [0, `${cyan('[command]')}npx playwright test --project=${browser}`],
          [2000, 'Running 24 tests using 2 workers'],
          [26000, green('  24 passed (24.1s)')],
        ],
      },
    ],
  })),
  failure: {
    jobId: 'e2e-webkit',
    step: 5,
    atMs: 21000,
    lines: [
      [18000, `  ${red('1) [webkit] › checkout.spec.ts:41:5 › pays with a saved card')}`],
      [18300, `     Error: ${red('Timed out 5000ms waiting for expect(locator).toBeVisible()')}`],
      [18400, `     Locator: getByRole('button', { name: 'Pay now' })`],
      [
        19000,
        `::error file=e2e/checkout.spec.ts,line=41::Timed out waiting for the Pay now button`,
      ],
      [20500, red('  1 failed, 23 passed (20.4s)')],
    ],
    annotation: {
      level: 'error',
      message: 'pays with a saved card: timed out waiting for the Pay now button',
      path: 'e2e/checkout.spec.ts',
      line: 41,
    },
  },
  warnings: [],
  summary: null,
};

const IMAGE: WorkflowScript = {
  key: 'image',
  workflow: {
    id: '.github/workflows/image.yml',
    name: 'Release image',
    path: '.github/workflows/image.yml',
    triggers: [
      {
        event: 'other',
        name: 'push (tags)',
        support: 'never',
        reason: 'Beanstalk refuses tag pushes.',
      },
      {
        event: 'other',
        name: 'release',
        support: 'never',
        reason: 'There is no release object on Beanstalk.',
      },
    ],
    notes: [
      {
        level: 'never',
        text: 'docker/build-push-action needs Docker-in-Docker, which does not run here yet.',
      },
    ],
    error: null,
    automation: null,
  },
  jobs: [],
  failure: null,
  warnings: [],
  summary: null,
};

export const WORKFLOW_SCRIPTS: readonly WorkflowScript[] = [CI, DEPLOY, E2E, IMAGE];

/** Commit titles the fake's stalk moves through, with the bean that landed each. */
export const FIXTURE_COMMITS: readonly { readonly title: string; readonly bean: string }[] = [
  { title: 'Add order totals', bean: 'add-total' },
  { title: 'Slugify product names', bean: 'slugify' },
  { title: 'Reduced tax rate for books', bean: 'book-tax' },
  { title: 'Wishlist sharing links', bean: 'wishlist-share' },
  { title: 'Retry webhook deliveries', bean: 'webhook-retry' },
  { title: 'Free shipping over $50', bean: 'free-shipping' },
  { title: 'Currency rounding per locale', bean: 'currency-rounding' },
];

export const FIXTURE_PEOPLE = ['coop', 'dana', 'rui'] as const;
