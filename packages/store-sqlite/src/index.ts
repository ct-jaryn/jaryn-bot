import { DatabaseSync } from 'node:sqlite'
import { mkdirSync } from 'node:fs'
import { dirname } from 'node:path'
import { randomUUID } from 'node:crypto'
import { definePlugin } from '@jaryn/kernel'
import type { Plugin } from '@jaryn/kernel'

export interface StoredEvent {
  seq: number
  id: string
  sessionId: string
  turnId?: string
  type: string
  actorKind: string
  actorId?: string
  provenance: string
  ts: number
  data: unknown
}

export interface SessionRecord {
  id: string
  botId: string
  cwd: string
  status: string
  createdAt: number
  updatedAt: number
}

const SCHEMA = `
CREATE TABLE IF NOT EXISTS schema_meta (key TEXT PRIMARY KEY, value TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS sessions (
  id TEXT PRIMARY KEY,
  bot_id TEXT NOT NULL,
  cwd TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'idle',
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS events (
  seq INTEGER PRIMARY KEY AUTOINCREMENT,
  id TEXT NOT NULL UNIQUE,
  session_id TEXT NOT NULL,
  turn_id TEXT,
  type TEXT NOT NULL,
  actor_kind TEXT NOT NULL,
  actor_id TEXT,
  provenance TEXT NOT NULL,
  ts INTEGER NOT NULL,
  data TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS events_session ON events(session_id, seq);
`

export interface EventInput {
  sessionId: string
  type: string
  turnId?: string
  actorKind?: string
  actorId?: string
  provenance?: string
  data?: unknown
}

export class Store {
  readonly db: DatabaseSync

  readonly path: string
  constructor(path: string) {
    this.path = path
    if (path !== ':memory:') mkdirSync(dirname(path), { recursive: true })
    this.db = new DatabaseSync(path)
    this.db.exec('PRAGMA journal_mode=WAL; PRAGMA foreign_keys=ON;')
    this.db.exec(SCHEMA)
    this.db.exec(`INSERT OR IGNORE INTO schema_meta(key, value) VALUES ('schema_version', '1')`)
  }

  createSession(id: string, botId: string, cwd: string): SessionRecord {
    const now = Date.now()
    this.db
      .prepare(
        `INSERT INTO sessions(id, bot_id, cwd, status, created_at, updated_at)
         VALUES (?, ?, ?, 'idle', ?, ?)
         ON CONFLICT(id) DO NOTHING`,
      )
      .run(id, botId, cwd, now, now)
    return this.getSession(id)!
  }

  getSession(id: string): SessionRecord | undefined {
    const row = this.db.prepare('SELECT * FROM sessions WHERE id = ?').get(id) as any
    if (!row) return undefined
    return {
      id: row.id,
      botId: row.bot_id,
      cwd: row.cwd,
      status: row.status,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    }
  }

  listSessions(): SessionRecord[] {
    return (this.db.prepare('SELECT * FROM sessions ORDER BY updated_at DESC').all() as any[]).map(
      (row) => ({
        id: row.id,
        botId: row.bot_id,
        cwd: row.cwd,
        status: row.status,
        createdAt: row.created_at,
        updatedAt: row.updated_at,
      }),
    )
  }

  append(input: EventInput): StoredEvent {
    const ts = Date.now()
    const id = `evt_${randomUUID()}`
    this.db
      .prepare(
        `INSERT INTO events(id, session_id, turn_id, type, actor_kind, actor_id, provenance, ts, data)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        id,
        input.sessionId,
        input.turnId ?? null,
        input.type,
        input.actorKind ?? 'system',
        input.actorId ?? null,
        input.provenance ?? 'system',
        ts,
        JSON.stringify(input.data ?? null),
      )
    this.db
      .prepare('UPDATE sessions SET updated_at = ? WHERE id = ?')
      .run(ts, input.sessionId)
    const row = this.db.prepare('SELECT * FROM events WHERE id = ?').get(id) as any
    return toEvent(row)
  }

  events(sessionId: string, fromSeq = 0): StoredEvent[] {
    const rows = this.db
      .prepare('SELECT * FROM events WHERE session_id = ? AND seq > ? ORDER BY seq')
      .all(sessionId, fromSeq) as any[]
    return rows.map(toEvent)
  }

  /** Rebuild the session by replaying its event log. */
  replay(sessionId: string): StoredEvent[] {
    return this.events(sessionId)
  }

  setSessionStatus(id: string, status: string): void {
    this.db.prepare('UPDATE sessions SET status = ?, updated_at = ? WHERE id = ?').run(status, Date.now(), id)
  }

  close(): void {
    this.db.close()
  }
}

function toEvent(row: any): StoredEvent {
  return {
    seq: row.seq,
    id: row.id,
    sessionId: row.session_id,
    turnId: row.turn_id ?? undefined,
    type: row.type,
    actorKind: row.actor_kind,
    actorId: row.actor_id ?? undefined,
    provenance: row.provenance,
    ts: row.ts,
    data: JSON.parse(row.data),
  }
}

export function storePlugin(): Plugin<{ path?: string }> {
  return definePlugin({
    name: '@jaryn/store-sqlite',
    provides: ['store'],
    apply(ctx, cfg) {
      const store = new Store(cfg.path ?? ':memory:')
      ctx.provide('store', store)
      ctx.effect(() => () => store.close())
    },
  })
}
