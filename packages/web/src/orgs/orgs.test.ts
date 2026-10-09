import { describe, expect, it } from 'vitest';

import { readCreateForm } from '../repositories/create-form';
import { orgIconSrc } from './org-icon';

function form(fields: Readonly<Record<string, string>>): FormData {
  const data = new FormData();
  for (const [name, value] of Object.entries(fields)) data.set(name, value);
  return data;
}

describe('the owner picker on New repository', () => {
  it('sends the chosen org as the owner', () => {
    const read = readCreateForm(
      form({ owner: 'acme', name: 'tools', visibility: 'private', start: 'empty' }),
    );
    expect(read).toMatchObject({ ok: true, input: { owner: 'acme', name: 'tools' } });
  });

  it('leaves the owner out for a personal repository (the gateway uses the creator)', () => {
    const read = readCreateForm(
      form({ owner: '', name: 'mine', visibility: 'public', start: 'empty' }),
    );
    expect(read.ok && 'owner' in read.input).toBe(false);
  });

  it('keeps the chosen owner when the form comes back with errors', () => {
    const read = readCreateForm(
      form({ owner: 'acme', name: '', visibility: 'private', start: 'empty' }),
    );
    expect(read).toMatchObject({ ok: false, values: { owner: 'acme' } });
  });
});

describe('org icons', () => {
  it('serves an uploaded icon by its key, each segment escaped', () => {
    expect(orgIconSrc('orgs/acme icon.png')).toBe('/api/uploads/orgs/acme%20icon.png');
  });
});
