import { describe, expect, it } from 'vitest';

import { adminPathOf, adminRunPath, queryOf } from './admin-paths';

const NONE = new URLSearchParams();

describe('the old public race URLs', () => {
  it('point at their admin pages', () => {
    expect(adminPathOf('/race', NONE)).toBe('/admin/race');
    expect(adminPathOf('/races', NONE)).toBe('/admin/runs');
    expect(adminPathOf('/runs/7z4j84eqvl', NONE)).toBe('/admin/runs/7z4j84eqvl');
    expect(adminPathOf('/runs/7z4j84eqvl/race', NONE)).toBe('/admin/runs/7z4j84eqvl/race');
    expect(adminPathOf('/runs/7z4j84eqvl/files', NONE)).toBe('/admin/runs/7z4j84eqvl/files');
  });

  it('keep their query, so a gateway live_url still carries its key', () => {
    const query = new URLSearchParams({ key: 'bst1.view', bean: 't005' });
    expect(adminPathOf('/runs/7z4j84eqvl', query)).toBe(
      '/admin/runs/7z4j84eqvl?key=bst1.view&bean=t005',
    );
  });

  it('leave every other path alone', () => {
    expect(adminPathOf('/runs/', NONE)).toBeNull();
    expect(adminPathOf('/racing', NONE)).toBeNull();
    expect(adminPathOf('/ada/shop', NONE)).toBeNull();
  });

  it('build run links in the admin area', () => {
    expect(adminRunPath('7z4j84eqvl')).toBe('/admin/runs/7z4j84eqvl');
  });

  it('turn page search params into a query, repeated keys kept', () => {
    expect(queryOf({ t: '600', bean: ['t1', 't2'], gone: undefined }).toString()).toBe(
      't=600&bean=t1&bean=t2',
    );
  });
});
