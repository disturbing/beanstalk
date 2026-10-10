import { describe, expect, it } from 'vitest';

import { isPlatformAdmin, platformAdminHandles } from './platform-admins';

describe('platform admins', () => {
  it('reads comma-separated handles, any case, with spaces or an @', () => {
    expect([...platformAdminHandles(' Coop, @ada ,,grace ')]).toEqual(['coop', 'ada', 'grace']);
  });

  it('makes nobody an admin when PLATFORM_ADMINS is empty', () => {
    expect(platformAdminHandles('').size).toBe(0);
    expect(isPlatformAdmin({ handle: 'coop' }, '')).toBe(false);
    expect(isPlatformAdmin({ handle: 'coop' }, ' , ')).toBe(false);
  });

  it('admits a named handle whatever its case', () => {
    expect(isPlatformAdmin({ handle: 'Coop' }, 'coop')).toBe(true);
    expect(isPlatformAdmin({ handle: 'coop' }, 'ada,COOP')).toBe(true);
  });

  it('refuses everyone else, and a signed-out visitor', () => {
    expect(isPlatformAdmin({ handle: 'coopx' }, 'coop')).toBe(false);
    expect(isPlatformAdmin({ handle: 'ada' }, 'coop')).toBe(false);
    expect(isPlatformAdmin(null, 'coop')).toBe(false);
  });
});
