import { DurableObject } from 'cloudflare:workers';

import { loggerFor, swarmConfig } from '../config';
import type { Logger } from '../log';
import {
  AuthJsonSchema,
  RefreshError,
  isExpired,
  jwtClaims,
  needsRefresh,
  refreshAuth,
} from './chatgpt-auth';
import type { AuthJson } from './chatgpt-auth';
import { importSeatKey, open, seal } from './seat-crypto';

/** A lease lasts this long past the holder's last model request. */
export const LEASE_MS = 15 * 60 * 1000;

export type SeatSummary = {
  readonly name: string;
  /** Whether the swarm may refresh it (a login made for the swarm alone, not a laptop's copy). */
  readonly refreshable: boolean;
  /** The access token's expiry (seconds since epoch), from its unverified claims. */
  readonly expires_at: number | null;
  readonly holder: string | null;
  readonly lease_until: number | null;
  readonly updated_at: number;
  readonly last_error: string | null;
};

export type SeatGrant =
  | { readonly ok: true; readonly accessToken: string; readonly accountId: string }
  | { readonly ok: false; readonly reason: string };

export type HaltState = { readonly reason: string; readonly at: number } | null;

type SeatRow = {
  name: string;
  iv: ArrayBuffer;
  ciphertext: ArrayBuffer;
  refreshable: number;
  expires_at: number | null;
  holder: string | null;
  lease_until: number | null;
  updated_at: number;
  last_error: string | null;
};

/**
 * One instance ("broker"): leased ChatGPT seats, encrypted under SEAT_KEY; the swarm-wide halt
 * switch; the list of live matches. A seat's tokens leave this object only towards the
 * model.internal handler, for the holder of its lease, and never reach a container or a log.
 */
export class BrokerDO extends DurableObject<Env> {
  readonly #log: Logger;
  #refreshing: Promise<AuthJson> | null = null;

  constructor(ctx: DurableObjectState, env: Env) {
    super(ctx, env);
    this.#log = loggerFor(env, 'broker');
    ctx.storage.sql.exec(`CREATE TABLE IF NOT EXISTS seats (
      name TEXT PRIMARY KEY, iv BLOB NOT NULL, ciphertext BLOB NOT NULL, refreshable INTEGER NOT NULL,
      expires_at INTEGER, holder TEXT, lease_until INTEGER, updated_at INTEGER NOT NULL, last_error TEXT)`);
  }

  // ---- halt switch and live matches -------------------------------------------------------------

  halted(): HaltState {
    return this.ctx.storage.kv.get<HaltState>('halt') ?? null;
  }

  /** Stops every live match and refuses new ones until `resume`. Returns the matches it halted. */
  halt(reason: string): readonly string[] {
    this.ctx.storage.kv.put('halt', { reason, at: Date.now() });
    this.#log.warn('swarm halted', { reason });
    return this.liveMatches();
  }

  resume(): void {
    this.ctx.storage.kv.delete('halt');
    this.#log.info('swarm resumed');
  }

  liveMatches(): readonly string[] {
    return this.ctx.storage.kv.get<string[]>('matches') ?? [];
  }

  matchStarted(match: string): void {
    this.ctx.storage.kv.put('matches', [...new Set([...this.liveMatches(), match])]);
  }

  /** The match is over: forget it and free every seat lease it held. */
  matchEnded(match: string): void {
    this.ctx.storage.kv.put(
      'matches',
      this.liveMatches().filter((m) => m !== match),
    );
    this.ctx.storage.sql.exec(
      'UPDATE seats SET holder = NULL, lease_until = NULL WHERE holder LIKE ?',
      `${match}:%`,
    );
  }

  // ---- seats --------------------------------------------------------------------------------------

  /** Stores (or replaces) a seat from an `auth.json` body; returns its summary, never a token. */
  async putSeat(name: string, body: string, refreshable: boolean): Promise<SeatSummary> {
    const auth = AuthJsonSchema.parse(JSON.parse(body));
    await this.#store(name, auth, { refreshable, keepLease: false });
    this.#log.info('seat stored', { seat: name, refreshable });
    return this.#summary(name);
  }

  listSeats(): readonly SeatSummary[] {
    return this.#rows().map((row) => summaryOf(row));
  }

  deleteSeat(name: string): boolean {
    const cursor = this.ctx.storage.sql.exec('DELETE FROM seats WHERE name = ?', name);
    return cursor.rowsWritten > 0;
  }

  /**
   * The seat's token for `holder` (`<match>:<slot>`), taking or renewing its lease. Another
   * holder's live lease refuses the call: one seat, one serialised stream of Codex requests.
   */
  async lease(name: string, holder: string): Promise<SeatGrant> {
    const row = this.#row(name);
    if (row === null) return { ok: false, reason: `no seat named ${name}` };
    const now = Date.now();
    if (row.holder !== null && row.holder !== holder && (row.lease_until ?? 0) > now) {
      return { ok: false, reason: `seat ${name} is leased to another agent` };
    }
    this.ctx.storage.sql.exec(
      'UPDATE seats SET holder = ?, lease_until = ? WHERE name = ?',
      holder,
      now + LEASE_MS,
      name,
    );
    try {
      const auth = await this.#fresh(name, row);
      return { ok: true, accessToken: auth.tokens.access_token, accountId: auth.tokens.account_id };
    } catch (error) {
      const reason = error instanceof Error ? error.message : 'seat unavailable';
      this.ctx.storage.sql.exec('UPDATE seats SET last_error = ? WHERE name = ?', reason, name);
      this.#log.warn('seat unavailable', { seat: name, reason });
      return { ok: false, reason };
    }
  }

  async #fresh(name: string, row: SeatRow): Promise<AuthJson> {
    const auth = await this.#decrypt(row);
    const nowSeconds = Date.now() / 1000;
    if (!needsRefresh(auth, nowSeconds)) return auth;
    if (row.refreshable === 0) {
      if (isExpired(auth, nowSeconds)) {
        throw new RefreshError(`seat ${name} expired; store a fresh login (scripts/seed-seat.sh)`);
      }
      return auth;
    }
    // Refresh tokens rotate on use: one refresh at a time, stored before anyone uses it.
    this.#refreshing ??= this.#refresh(name, auth).finally(() => {
      this.#refreshing = null;
    });
    return this.#refreshing;
  }

  async #refresh(name: string, auth: AuthJson): Promise<AuthJson> {
    const fresh = await refreshAuth(auth, swarmConfig(this.env).chatgptTokenUrl);
    await this.#store(name, fresh, { refreshable: true, keepLease: true });
    this.#log.info('seat refreshed', { seat: name });
    return fresh;
  }

  async #store(
    name: string,
    auth: AuthJson,
    options: { refreshable: boolean; keepLease: boolean },
  ): Promise<void> {
    const key = await importSeatKey(this.env.SEAT_KEY);
    const sealed = await seal(key, JSON.stringify(auth));
    const expires = jwtClaims(auth.tokens.access_token).exp;
    const previous = options.keepLease ? this.#row(name) : null;
    this.ctx.storage.sql.exec(
      `INSERT OR REPLACE INTO seats (name, iv, ciphertext, refreshable, expires_at, holder, lease_until, updated_at, last_error)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, NULL)`,
      name,
      sealed.iv,
      sealed.ciphertext,
      options.refreshable ? 1 : 0,
      expires,
      previous?.holder ?? null,
      previous?.lease_until ?? null,
      Date.now(),
    );
  }

  async #decrypt(row: SeatRow): Promise<AuthJson> {
    const key = await importSeatKey(this.env.SEAT_KEY);
    const plaintext = await open(key, {
      iv: new Uint8Array(row.iv),
      ciphertext: new Uint8Array(row.ciphertext),
    });
    return AuthJsonSchema.parse(JSON.parse(plaintext));
  }

  #summary(name: string): SeatSummary {
    const row = this.#row(name);
    if (row === null) throw new Error(`seat ${name} vanished`);
    return summaryOf(row);
  }

  #row(name: string): SeatRow | null {
    return this.#rows(name)[0] ?? null;
  }

  #rows(name?: string): SeatRow[] {
    const cursor =
      name === undefined
        ? this.ctx.storage.sql.exec<SeatRow>('SELECT * FROM seats ORDER BY name')
        : this.ctx.storage.sql.exec<SeatRow>('SELECT * FROM seats WHERE name = ?', name);
    return cursor.toArray();
  }
}

function summaryOf(row: SeatRow): SeatSummary {
  return {
    name: row.name,
    refreshable: row.refreshable === 1,
    expires_at: row.expires_at,
    holder: row.holder,
    lease_until: row.lease_until,
    updated_at: row.updated_at,
    last_error: row.last_error,
  };
}
