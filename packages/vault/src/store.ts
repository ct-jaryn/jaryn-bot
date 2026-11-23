import { randomUUID } from 'node:crypto'
import { join } from 'node:path'
import type { DatabaseSync } from 'node:sqlite'
import { decrypt, encrypt, loadOrCreateMasterKey } from './crypto.ts'

export type VaultKind = 'login' | 'card' | 'api_key' | 'note' | 'oauth'

export interface VaultMeta {
  id: string
  kind: VaultKind
  name: string
  origin?: string
  username?: string
  scope: string
  createdAt: number
  updatedAt: number
  lastUsedAt?: number
}

export interface VaultItem extends VaultMeta {
  secret: Record<string, unknown>
}

export interface FillClient {
  evaluate<T = unknown>(expression: string): Promise<T>
}

const SCHEMA = `
CREATE TABLE IF NOT EXISTS vault_items (
  id TEXT PRIMARY KEY,
  kind TEXT NOT NULL,
  name TEXT NOT NULL,
  origin TEXT,
  username TEXT,
  secret_enc TEXT NOT NULL,
  scope TEXT NOT NULL DEFAULT 'global',
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  last_used_at INTEGER
);
CREATE TABLE IF NOT EXISTS vault_grants (
  item_id TEXT NOT NULL, bot_id TEXT NOT NULL,
  allow_fill INTEGER NOT NULL DEFAULT 1,
  PRIMARY KEY (item_id, bot_id)
);
CREATE TABLE IF NOT EXISTS vault_events (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  ts INTEGER NOT NULL, actor TEXT, bot_id TEXT, item_id TEXT,
  action TEXT NOT NULL, origin TEXT, field_kind TEXT, result TEXT
);
CREATE TABLE IF NOT EXISTS secure_forms (
  token TEXT PRIMARY KEY,
  origin TEXT,
  purpose TEXT,
  kind TEXT NOT NULL DEFAULT 'login',
  expires_at INTEGER NOT NULL,
  used INTEGER NOT NULL DEFAULT 0
);
`

export class VaultService {
  private db: DatabaseSync
  private key: Buffer

  constructor(db: DatabaseSync, opts: { keyPath?: string } = {}) {
    this.db = db
    this.key = loadOrCreateMasterKey(opts.keyPath ?? join(process.env.JARY_HOME ?? join(process.cwd(), 'data'), 'vault.key'))
    this.db.exec(SCHEMA)
  }

  add(input: {
    kind?: VaultKind; name: string; origin?: string; username?: string;
    secret: Record<string, unknown>; scope?: string
  }): VaultMeta {
    const id = `vault_${randomUUID()}`
    const now = Date.now()
    this.db.prepare(
      `INSERT INTO vault_items(id, kind, name, origin, username, secret_enc, scope, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    ).run(id, input.kind ?? 'login', input.name, input.origin ?? null, input.username ?? null,
      encrypt(input.secret, this.key), input.scope ?? 'global', now, now)
    this.audit(input.scope ?? 'global', undefined, id, 'add', input.origin)
    return this.meta(id)!
  }

  meta(id: string): VaultMeta | undefined {
    const row = this.db.prepare('SELECT * FROM vault_items WHERE id = ?').get(id) as any
    return row ? toMeta(row) : undefined
  }

  list(scope?: string): VaultMeta[] {
    const rows = scope
      ? this.db.prepare('SELECT * FROM vault_items WHERE scope = ? ORDER BY updated_at DESC').all(scope)
      : this.db.prepare('SELECT * FROM vault_items ORDER BY updated_at DESC').all()
    return (rows as any[]).map(toMeta)
  }

  /** Internal only: never expose through tools/API. */
  reveal(id: string): VaultItem | undefined {
    const row = this.db.prepare('SELECT * FROM vault_items WHERE id = ?').get(id) as any
    if (!row) return undefined
    return { ...toMeta(row), secret: decrypt(row.secret_enc, this.key) as Record<string, unknown> }
  }

  /** True when the bot may use this item: explicit grant, or no grants configured for the item. */
  canUse(itemId: string, botId?: string): boolean {
    const grants = this.db.prepare('SELECT bot_id FROM vault_grants WHERE item_id = ?').all(itemId) as any[]
    if (grants.length === 0) return true
    if (!botId) return false
    return grants.some((grant) => grant.bot_id === botId || grant.bot_id === '*')
  }

  async fill(id: string, opts: { client: FillClient; botId?: string; origin?: string }): Promise<{ ok: boolean; filled: string[] }> {
    const item = this.reveal(id)
    if (!item) throw new Error(`vault item not found: ${id}`)
    if (!this.canUse(id, opts.botId)) throw new Error(`vault item ${id} is not granted to bot ${opts.botId ?? '(none)'}`)
    if (item.kind !== 'login' && item.kind !== 'api_key') throw new Error(`item ${id} is not fillable`)
    if (item.origin && opts.origin) {
      const expected = new URL(item.origin).host
      const actual = new URL(opts.origin).host
      if (expected !== actual) {
        this.audit(item.scope, opts.botId, id, 'fill', opts.origin, 'denied')
        throw new Error(`origin mismatch: expected ${expected}, got ${actual}`)
      }
    }
    const username = String(item.secret.username ?? item.secret.user ?? '')
    const password = String(item.secret.password ?? item.secret.token ?? '')
    const filled: string[] = []
    if (username) {
      const ok = await opts.client.evaluate<boolean>(`(() => {
        const el = document.querySelector('input[type="email"],input[name*="user" i],input[name*="email" i],input[type="text"]');
        if (!el) return false;
        el.focus(); el.value = ${JSON.stringify(username)};
        el.dispatchEvent(new Event('input', { bubbles: true }));
        el.dispatchEvent(new Event('change', { bubbles: true }));
        return true;
      })()`)
      if (ok) filled.push('username')
    }
    if (password) {
      const ok = await opts.client.evaluate<boolean>(`(() => {
        const el = document.querySelector('input[type="password"]');
        if (!el) return false;
        el.focus(); el.value = ${JSON.stringify(password)};
        el.dispatchEvent(new Event('input', { bubbles: true }));
        el.dispatchEvent(new Event('change', { bubbles: true }));
        return true;
      })()`)
      if (ok) filled.push('password')
    }
    this.touch(id)
    this.audit(item.scope, opts.botId, id, 'fill', opts.origin, filled.length ? 'ok' : 'no-field')
    return { ok: filled.length > 0, filled }
  }

  remove(id: string): boolean {
    const item = this.meta(id)
    const changed = this.db.prepare('DELETE FROM vault_items WHERE id = ?').run(id).changes > 0
    if (changed) this.audit(item?.scope, undefined, id, 'remove', item?.origin)
    return changed
  }

  rotate(id: string, secret: Record<string, unknown>): void {
    const item = this.meta(id)
    if (!item) throw new Error(`vault item not found: ${id}`)
    this.db.prepare('UPDATE vault_items SET secret_enc = ?, updated_at = ? WHERE id = ?')
      .run(encrypt(secret, this.key), Date.now(), id)
    this.audit(item.scope, undefined, id, 'rotate', item.origin)
  }

  grant(itemId: string, botId: string): void {
    this.db.prepare('INSERT OR REPLACE INTO vault_grants(item_id, bot_id) VALUES (?, ?)').run(itemId, botId)
    this.audit(undefined, botId, itemId, 'grant')
  }

  revoke(itemId: string, botId: string): void {
    this.db.prepare('DELETE FROM vault_grants WHERE item_id = ? AND bot_id = ?').run(itemId, botId)
    this.audit(undefined, botId, itemId, 'revoke')
  }

  events(limit = 50): any[] {
    return this.db.prepare('SELECT * FROM vault_events ORDER BY id DESC LIMIT ?').all(limit)
  }

  createSecureForm(input: { origin: string; purpose: string; kind?: VaultKind; ttlMs?: number }): string {
    const token = randomUUID().replace(/-/g, '')
    this.db.prepare('INSERT INTO secure_forms(token, origin, purpose, kind, expires_at) VALUES (?, ?, ?, ?, ?)')
      .run(token, input.origin, input.purpose, input.kind ?? 'login', Date.now() + (input.ttlMs ?? 10 * 60_000))
    return token
  }

  consumeSecureForm(token: string, input: { username?: string; secret: Record<string, unknown>; name?: string }): VaultMeta {
    const row = this.db.prepare('SELECT * FROM secure_forms WHERE token = ?').get(token) as any
    if (!row) throw new Error('secure form not found')
    if (row.used) throw new Error('secure form already used')
    if (row.expires_at < Date.now()) throw new Error('secure form expired')
    this.db.prepare('UPDATE secure_forms SET used = 1 WHERE token = ?').run(token)
    return this.add({
      kind: row.kind, name: input.name ?? `${row.purpose} (${new URL(row.origin).host})`,
      origin: row.origin, username: input.username, secret: input.secret,
    })
  }

  private touch(id: string): void {
    this.db.prepare('UPDATE vault_items SET last_used_at = ? WHERE id = ?').run(Date.now(), id)
  }

  private audit(scope: string | undefined, botId: string | undefined, itemId: string, action: string, origin?: string, result = 'ok'): void {
    this.db.prepare(
      'INSERT INTO vault_events(ts, actor, bot_id, item_id, action, origin, result) VALUES (?, ?, ?, ?, ?, ?, ?)',
    ).run(Date.now(), scope, botId ?? null, itemId, action, origin ?? null, result)
  }
}

function toMeta(row: any): VaultMeta {
  return {
    id: row.id, kind: row.kind, name: row.name, origin: row.origin ?? undefined,
    username: row.username ?? undefined, scope: row.scope,
    createdAt: row.created_at, updatedAt: row.updated_at, lastUsedAt: row.last_used_at ?? undefined,
  }
}
