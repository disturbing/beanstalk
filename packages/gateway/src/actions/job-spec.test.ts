import { describe, expect, it } from 'vitest';

import { npmDefaults } from './job-spec';

describe('npm defaults for a job', () => {
  it('turns the install-time audit and funding message off', () => {
    const off = { NPM_CONFIG_AUDIT: 'false', NPM_CONFIG_FUND: 'false' };
    expect(npmDefaults({})).toEqual(off);
    expect(npmDefaults({ GITSTALK_NPM_AUDIT: 'off' })).toEqual(off);
    expect(npmDefaults({ BEANSTALK_NPM_AUDIT: 'on', GITSTALK_NPM_AUDIT: 'off' })).toEqual(off);
  });

  it('keeps npm as it is when the variable GITSTALK_NPM_AUDIT (or BEANSTALK_NPM_AUDIT) is on', () => {
    expect(npmDefaults({ GITSTALK_NPM_AUDIT: 'on' })).toEqual({});
    expect(npmDefaults({ BEANSTALK_NPM_AUDIT: 'on' })).toEqual({});
    expect(npmDefaults({ BEANSTALK_NPM_AUDIT: ' TRUE ' })).toEqual({});
  });
});
