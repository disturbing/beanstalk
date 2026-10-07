import { describe, expect, it } from 'vitest';

import { indexClient } from './index-client';

const bean = {
  bean: 'add-total',
  title: 'Add a total helper',
  actor: 'coop',
  state: 'promoted',
  opened_at: '2026-10-07T12:00:00.000Z',
  landed_at: '2026-10-07T12:00:05.000Z',
  landed_sha: 'a'.repeat(40),
  promoted_at: '2026-10-07T12:00:09.000Z',
  promoted_sha: 'a'.repeat(40),
  reverted_at: null,
  reason: '',
  reworks: 0,
  updated_at: '2026-10-07T12:00:09.000Z',
};

describe('the repository index client', () => {
  it("reads History's validation view and Home growth, checking every answer", async () => {
    const asked: string[] = [];
    const client = indexClient({
      repositoryStalk: async (repoId: string, viewer: string | null) => {
        asked.push(`stalk ${repoId} ${viewer}`);
        return {
          ok: true,
          value: {
            lines: null,
            validating: [],
            promotions: [
              {
                at: bean.promoted_at,
                sha: bean.promoted_sha,
                kind: 'promoted',
                beans: [bean],
                text: 'The stalk moved.',
              },
            ],
            off: [],
            growing: [],
            days: [],
            activity: [],
            verdicts: [],
          },
        };
      },
      repositoryGrowth: async () => ({
        ok: true,
        value: [{ repo_id: 'r1', landed: 1, growing: 0, indexed: true }],
      }),
    });
    const stalk = await client.stalk('r1', 'u1');
    expect(stalk.ok && stalk.value.promotions[0]?.beans[0]?.bean).toBe('add-total');
    expect(asked).toEqual(['stalk r1 u1']);
    expect(await client.growth(['r1'], 'u1')).toEqual({
      ok: true,
      value: [{ repo_id: 'r1', landed: 1, growing: 0, indexed: true }],
    });
    expect(await client.growth([], 'u1')).toEqual({ ok: true, value: [] });
  });

  it('reads a gateway without the index as unavailable', async () => {
    expect(await indexClient({}).stalk('r1', null)).toMatchObject({
      ok: false,
      error: { code: 'unavailable' },
    });
  });

  it('passes a refusal through as a value', async () => {
    const client = indexClient({
      repositoryStalk: async () => ({
        ok: false,
        error: { code: 'not_found', status: 404, message: 'repository r1 not found' },
      }),
      repositoryGrowth: async () => ({ ok: true, value: [] }),
    });
    expect(await client.stalk('r1', null)).toEqual({
      ok: false,
      error: { code: 'not_found', message: 'repository r1 not found' },
    });
  });
});
