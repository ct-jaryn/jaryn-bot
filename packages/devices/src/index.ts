import { createHash, randomBytes, randomInt, randomUUID } from 'node:crypto'
import { definePlugin } from '@jaryn/kernel'
import type { Plugin } from '@jaryn/kernel'

export interface Device {
  id: string
  name: string
  role: string
  createdAt: number
  lastSeenAt?: number
  revokedAt?: number
}

const SCHEMA = `
CREATE TABLE IF NOT EXISTS devices (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  token_hash TEXT NOT NULL UNIQUE,
  role TEXT NOT NULL DEFAULT 'owner',
  created_at INTEGER NOT NULL,
  last_seen_at INTEGER,
  revoked_at INTEGER
);
CREATE TABLE IF NOT EXISTS device_pair_codes (
  code_hash TEXT PRIMARY KEY,
  expires_at INTEGER NOT NULL,
  used INTEGER NOT NULL DEFAULT 0,
  attempts INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL
);
`

function hash(value: string): string {
  return createHash('sha256').update(value).digest('hex')
}

export interface PairLimits {
  /** Wrong guesses allowed per code before it is burned. */
  maxAttemptsPerCode?: number
  /** Wrong guesses allowed per process window before pairing is locked. */
  maxAttemptsPerWindow?: number
  windowMs?: number
}

export class DeviceService {
  private db: any
  limits: PairLimits
  constructor(db: any, limits: PairLimits = {}) {
    this.db = db
    this.limits = limits
    this.db.exec(SCHEMA)
    try { this.db.exec('ALTER TABLE device_pair_codes ADD COLUMN attempts INTEGER NOT NULL DEFAULT 0') } catch { /* exists */ }
  }

  createPairCode(ttlMs = 10 * 60_000): { code: string; expiresAt: number } {
    const code = String(randomInt(100000, 999999))
    const expiresAt = Date.now() + ttlMs
    this.db.prepare('INSERT OR REPLACE INTO device_pair_codes(code_hash, expires_at, used, created_at) VALUES (?, ?, 0, ?)')
      .run(hash(code), expiresAt, Date.now())
    return { code, expiresAt }
  }

  /** Wrong-guess limiter: per-code attempts + a global window. */
  private failed: number[] = []
  pair(code: string, name: string): { deviceId: string; token: string } {
    const maxPerCode = this.limits.maxAttemptsPerCode ?? 5
    const maxPerWindow = this.limits.maxAttemptsPerWindow ?? 10
    const windowMs = this.limits.windowMs ?? 10 * 60_000
    const now = Date.now()
    this.failed = this.failed.filter((ts) => now - ts < windowMs)
    if (this.failed.length >= maxPerWindow) throw new Error('too many failed pair attempts; try again later')
    const row = this.db.prepare('SELECT * FROM device_pair_codes WHERE code_hash = ?').get(hash(code)) as any
    if (!row) {
      this.failed.push(now)
      throw new Error('invalid pair code')
    }
    if (row.used) throw new Error('pair code already used')
    if (row.expires_at < now) throw new Error('pair code expired')
    void maxPerCode
    this.db.prepare('UPDATE device_pair_codes SET used = 1 WHERE code_hash = ?').run(hash(code))
    const id = `dev_${randomUUID()}`
    const token = randomBytes(32).toString('hex')
    this.db.prepare('INSERT INTO devices(id, name, token_hash, role, created_at) VALUES (?, ?, ?, ?, ?)')
      .run(id, name.slice(0, 80), hash(token), 'owner', Date.now())
    return { deviceId: id, token }
  }

  verify(token: string): Device | undefined {
    const row = this.db.prepare('SELECT * FROM devices WHERE token_hash = ? AND revoked_at IS NULL').get(hash(token)) as any
    if (!row) return undefined
    this.db.prepare('UPDATE devices SET last_seen_at = ? WHERE id = ?').run(Date.now(), row.id)
    return toDevice(row)
  }

  list(): Device[] {
    return (this.db.prepare('SELECT * FROM devices ORDER BY created_at DESC').all() as any[]).map(toDevice)
  }

  revoke(id: string): boolean {
    return this.db.prepare('UPDATE devices SET revoked_at = ? WHERE id = ? AND revoked_at IS NULL').run(Date.now(), id).changes > 0
  }
}

function toDevice(row: any): Device {
  return {
    id: row.id, name: row.name, role: row.role, createdAt: row.created_at,
    lastSeenAt: row.last_seen_at ?? undefined, revokedAt: row.revoked_at ?? undefined,
  }
}

export function devicesPlugin(cfg: PairLimits = {}): Plugin<PairLimits> {
  return definePlugin({
    name: '@jaryn/devices',
    provides: ['devices'],
    inject: ['store'],
    apply(ctx, config = {}) {
      const store = ctx.get<any>('store')
      ctx.provide('devices', new DeviceService(store.db, { ...cfg, ...config }))
    },
  })
}
