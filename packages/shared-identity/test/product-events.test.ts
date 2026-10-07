import { env } from 'cloudflare:test';
import { describe, expect, it } from 'vitest';

import type { AgentSession } from '../src/agent-sessions';
import { SETTLING_MS, withSettlingSessions } from '../src/agent-sessions';
import type { AuditEvent } from '../src/audit';
import { recordAudit } from '../src/audit';
import type { ProductEventsDataset } from '../src/product-events';
import { hashedId, logIdentity, recordProductEvent } from '../src/product-events';
import { T0, signUp } from './helpers';

function recorder() {
  const points: AnalyticsEngineDataPoint[] = [];
  const dataset: ProductEventsDataset = {
    writeDataPoint: (point) => void points.push(point ?? {}),
  };
  return { dataset, points };
}

describe('product events', () => {
  it('writes one point per event with the hashed user, never the raw id', async () => {
    const { dataset, points } = recorder();
    await recordProductEvent(dataset, 'connect', { userId: 'u_abc', detail: 'Claude Code' });
    const user = await hashedId('u_abc');
    expect(user).toMatch(/^h_[0-9a-f]{16}$/);
    expect(points).toEqual([
      { indexes: [user], blobs: ['connect', user, 'Claude Code'], doubles: [1] },
    ]);
    expect(JSON.stringify(points)).not.toContain('u_abc');
  });

  it('records nothing without the binding, and survives a failing binding', async () => {
    await expect(recordProductEvent(undefined, 'signup', { userId: 'u' })).resolves.toBeUndefined();
    const failing: ProductEventsDataset = {
      writeDataPoint: () => {
        throw new Error('binding fault');
      },
    };
    await expect(recordProductEvent(failing, 'signup', { userId: 'u' })).resolves.toBeUndefined();
  });

  it('names people and sessions in logs by stable hashes', async () => {
    const fields = await logIdentity({ userId: 'u_abc', sessionId: 'sess' });
    expect(fields).toEqual({
      user_id: await hashedId('u_abc'),
      session_id: await hashedId('sess'),
    });
    expect(await logIdentity({ userId: 'u_abc' })).toEqual({ user_id: await hashedId('u_abc') });
  });
});

function listedGrant(clientId: string, createdAt: number): AgentSession {
  return {
    grantId: `g-${clientId}`,
    clientId,
    clientName: clientId,
    scopes: ['read'],
    createdAt,
    expiresAt: null,
  };
}

describe('sessions approved moments ago', () => {
  it('shows an approval the grant list does not have yet, until the list has it', async () => {
    const { user } = await signUp('settle-one');
    await recordAudit(
      env,
      {
        action: 'oauth.grant',
        actorUserId: user.id,
        target: 'https://claude.ai/oauth/claude-code-client-metadata',
        detail: { client: 'Claude Code', scopes: ['read', 'write'] },
      },
      T0,
    );
    const early = await withSettlingSessions(env, { userId: user.id, listed: [], now: T0 + 2000 });
    expect(early).toMatchObject([
      { clientName: 'Claude Code', scopes: ['read', 'write'], settling: true, createdAt: T0 },
    ]);
    const listed = [listedGrant('https://claude.ai/oauth/claude-code-client-metadata', T0 + 40)];
    expect(await withSettlingSessions(env, { userId: user.id, listed, now: T0 + 3000 })).toEqual(
      listed,
    );
    expect(
      await withSettlingSessions(env, { userId: user.id, listed: [], now: T0 + SETTLING_MS + 1 }),
    ).toEqual([]);
  });

  it('drops an approval revoked since, and never shows another person’s', async () => {
    const { user } = await signUp('settle-two');
    const { user: other } = await signUp('settle-other');
    const grant: Omit<AuditEvent, 'actorUserId'> = {
      action: 'oauth.grant',
      target: 'client-x',
      detail: { client: 'X' },
    };
    await recordAudit(env, { ...grant, actorUserId: user.id }, T0);
    await recordAudit(env, { ...grant, actorUserId: other.id }, T0);
    await recordAudit(
      env,
      { action: 'oauth.revoke', actorUserId: user.id, target: 'client-x' },
      T0 + 5,
    );
    expect(await withSettlingSessions(env, { userId: user.id, listed: [], now: T0 + 10 })).toEqual(
      [],
    );
    expect(
      await withSettlingSessions(env, { userId: other.id, listed: [], now: T0 + 10 }),
    ).toHaveLength(1);
  });
});
