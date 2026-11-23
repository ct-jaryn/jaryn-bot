import { randomUUID } from 'node:crypto'
import type { DatabaseSync } from 'node:sqlite'
import { jaccard, tokenize } from './tokenizer.ts'

export type MemoryKind = 'fact' | 'preference' | 'rule' | 'episode' | 'skill' | 'note'

export interface Memory {
  id: string
  ns: string
  kind: MemoryKind
  text: string
  key?: string
  source: string
  confidence: number
  pinned: boolean
  useCount: number
  lastUsedAt?: number
  createdAt: number
  updatedAt: number
  expiresAt?: number
}

export interface MemoryLimits {
  maxEntries?: number
  episodeTtlDays?: number
  decayDays?: number
}

export interface RememberInput {
  ns: string
  text: string
  kind?: MemoryKind
  pinned?: boolean
  source?: string
  key?: string
  confidence?: number
  expiresAt?: number
}

const SCHEMA = `
CREATE TABLE IF NOT EXISTS memories (
  id TEXT PRIMARY KEY,
  ns TEXT NOT NULL,
  kind TEXT NOT NULL,
  text TEXT NOT NULL,
  tokens TEXT NOT NULL,
  key TEXT,
  source TEXT NOT NULL,
  confidence REAL NOT NULL DEFAULT 0.7,
  pinned INTEGER NOT NULL DEFAULT 0,
  use_count INTEGER NOT NULL DEFAULT 0,
  last_used_at INTEGER,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  expires_at INTEGER
);
CREATE INDEX IF NOT EXISTS memories_ns ON memories(ns, updated_at);
CREATE VIRTUAL TABLE IF NOT EXISTS memories_fts USING fts5(id UNINDEXED, tokens, tokenize='unicode61');
CREATE TABLE IF NOT EXISTS memory_tags (memory_id TEXT NOT NULL, tag TEXT NOT NULL, PRIMARY KEY(memory_id, tag));
CREATE TABLE IF NOT EXISTS memory_candidates (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  ns TEXT NOT NULL, text TEXT NOT NULL, tokens TEXT NOT NULL,
  kind TEXT NOT NULL DEFAULT 'fact', source TEXT NOT NULL DEFAULT 'rule',
  created_at INTEGER NOT NULL, consumed INTEGER NOT NULL DEFAULT 0
);
CREATE TABLE IF NOT EXISTS memory_runs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  started_at INTEGER, ended_at INTEGER,
  candidates INTEGER, added INTEGER, merged INTEGER, archived INTEGER
);
`

export class MemoryStore {
  private db: DatabaseSync
  limits: Required<MemoryLimits>
  constructor(db: DatabaseSync, limits: MemoryLimits = {}) {
    this.db = db
    this.db.exec(SCHEMA)
    this.limits = {
      maxEntries: limits.maxEntries ?? 5000,
      episodeTtlDays: limits.episodeTtlDays ?? 30,
      decayDays: limits.decayDays ?? 90,
    }
  }

  /** Enforce TTL, decay/archive and capacity. Returns how many rows were archived/removed. */
  maintain(now = Date.now()): { expired: number; archived: number; evicted: number } {
    let expired = 0
    let archived = 0
    let evicted = 0
    if (this.limits.episodeTtlDays > 0) {
      expired = this.db.prepare(`DELETE FROM memories WHERE kind = 'episode' AND created_at < ?`)
        .run(now - this.limits.episodeTtlDays * 86_400_000).changes
    }
    if (this.limits.decayDays > 0) {
      const cutoff = now - this.limits.decayDays * 86_400_000
      const rows = this.db.prepare(
        `SELECT id, created_at, last_used_at, use_count, confidence FROM memories
         WHERE pinned = 0 AND (last_used_at IS NULL OR last_used_at < ?) AND created_at < ?`,
      ).all(cutoff, cutoff) as any[]
      for (const row of rows) {
        const useCount = Number(row.use_count ?? 0)
        const score = Number(row.confidence ?? 0.7) * Math.exp(-(now - (row.last_used_at ?? row.created_at)) / (this.limits.decayDays * 86_400_000)) + 0.1 * Math.min(useCount, 5)
        if (score < 0.2) {
          this.db.prepare('UPDATE memories SET expires_at = ? WHERE id = ?').run(now - 1, row.id)
          archived++
        }
      }
    }
    const total = (this.db.prepare('SELECT COUNT(*) AS c FROM memories').get() as any).c
    if (total > this.limits.maxEntries) {
      const extra = total - Math.floor(this.limits.maxEntries * 0.9)
      const victims = this.db.prepare(
        `SELECT id FROM memories WHERE pinned = 0
         ORDER BY confidence ASC, COALESCE(last_used_at, created_at) ASC LIMIT ?`,
      ).all(extra) as any[]
      for (const victim of victims) this.forget({ id: victim.id, ns: '' })
      evicted = victims.length
    }
    return { expired, archived, evicted }
  }

  remember(input: RememberInput): Memory {
    const text = input.text.trim()
    if (!text) throw new Error('memory text is empty')
    if (text.length > 500) throw new Error('memory text exceeds 500 chars')
    const now = Date.now()
    const id = `mem_${randomUUID()}`
    const kind = input.kind ?? 'fact'
    const tokens = tokenize(text).join(' ')
    this.db.prepare(
      `INSERT INTO memories(id, ns, kind, text, tokens, key, source, confidence, pinned, created_at, updated_at, expires_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    ).run(id, input.ns, kind, text, tokens, input.key ?? null, input.source ?? 'user', input.confidence ?? 0.7,
      input.pinned ? 1 : 0, now, now, input.expiresAt ?? null)
    this.db.prepare('INSERT INTO memories_fts(id, tokens) VALUES (?, ?)').run(id, tokens)
    return this.get(id)!
  }

  get(id: string): Memory | undefined {
    const row = this.db.prepare('SELECT * FROM memories WHERE id = ?').get(id) as any
    return row ? toMemory(row) : undefined
  }

  list(opts: { ns: string; kind?: string; tag?: string; limit?: number }): Memory[] {
    const limit = Math.min(opts.limit ?? 20, 100)
    let sql = 'SELECT m.* FROM memories m'
    const params: any[] = []
    if (opts.tag) {
      sql += ' JOIN memory_tags t ON t.memory_id = m.id AND t.tag = ?'
      params.push(opts.tag)
    }
    sql += ' WHERE m.ns = ?'
    params.push(opts.ns)
    if (opts.kind) { sql += ' AND m.kind = ?'; params.push(opts.kind) }
    sql += ' ORDER BY m.pinned DESC, m.updated_at DESC LIMIT ?'
    params.push(limit)
    return (this.db.prepare(sql).all(...params) as any[]).map(toMemory)
  }

  catalog(ns: string): { kind: string; count: number; titles: string[] }[] {
    const rows = this.db.prepare(
      `SELECT kind, COUNT(*) AS count FROM memories WHERE ns = ? GROUP BY kind ORDER BY count DESC`,
    ).all(ns) as any[]
    return rows.map((r) => ({
      kind: r.kind,
      count: r.count,
      titles: this.list({ ns, kind: r.kind, limit: 3 }).map((m) => m.text.slice(0, 60)),
    }))
  }

  search(opts: { ns: string; query: string; limit?: number }): Memory[] {
    const tokens = tokenize(opts.query)
    if (tokens.length === 0) return []
    const match = tokens.map((t) => `"${t.replace(/"/g, '""')}"`).join(' OR ')
    const rows = this.db.prepare(
      `SELECT m.*, bm25(memories_fts) AS rank
       FROM memories_fts f JOIN memories m ON m.id = f.id
       WHERE f.tokens MATCH ? AND m.ns = ? AND (m.expires_at IS NULL OR m.expires_at > ?)
       ORDER BY rank LIMIT 30`,
    ).all(match, opts.ns, Date.now()) as any[]
    const now = Date.now()
    const scored = rows.map((r) => {
      const recency = Math.exp(-((now - (r.last_used_at ?? r.updated_at)) / 86_400_000) / 30)
      const score = -r.rank + 0.3 * recency + 0.5 * (r.pinned ? 1 : 0) + 0.2 * r.confidence
      return { memory: toMemory(r), score }
    })
    scored.sort((a, b) => b.score - a.score)
    const results: Memory[] = []
    const seen = new Set<string>()
    for (const { memory } of scored) {
      const sig = tokenize(memory.text).join(' ')
      if (seen.has(sig)) continue
      seen.add(sig)
      results.push(memory)
      if (results.length >= (opts.limit ?? 5)) break
    }
    return results
  }

  /** Digest for prompt injection: pinned + query hits, capped by tokens (chars/3). */
  digest(opts: { ns: string; query?: string; budgetTokens?: number }): string {
    const budget = opts.budgetTokens ?? 600
    const maxChars = budget * 3
    const lines: string[] = []
    let used = 0
    const push = (label: string, text: string) => {
      const line = `- ${label}${text.slice(0, 120)}`
      if (used + line.length > maxChars) return false
      lines.push(line)
      used += line.length + 1
      return true
    }
    for (const m of this.list({ ns: opts.ns, limit: 5 })) {
      if (m.pinned && !push(`[${m.kind}] `, m.text)) break
    }
    if (opts.query) {
      for (const m of this.search({ ns: opts.ns, query: opts.query, limit: 5 })) {
        if (!push(`[${m.kind}] `, m.text)) break
      }
    }
    if (lines.length === 0) return ''
    return `Long-term memory:\n${lines.join('\n')}`
  }

  forget(opts: { id?: string; query?: string; ns: string }): number {
    let ids: string[] = []
    if (opts.id) ids = [opts.id]
    else if (opts.query) ids = this.search({ ns: opts.ns, query: opts.query, limit: 50 }).map((m) => m.id)
    for (const id of ids) {
      this.db.prepare('DELETE FROM memories WHERE id = ?').run(id)
      this.db.prepare('DELETE FROM memories_fts WHERE id = ?').run(id)
      this.db.prepare('DELETE FROM memory_tags WHERE memory_id = ?').run(id)
    }
    return ids.length
  }

  observe(ns: string, text: string): number {
    const candidates = extractCandidates(text)
    let added = 0
    for (const c of candidates) {
      this.db.prepare(
        'INSERT INTO memory_candidates(ns, text, tokens, kind, source, created_at) VALUES (?, ?, ?, ?, ?, ?)',
      ).run(ns, c.text, tokenize(c.text).join(' '), c.kind, 'rule', Date.now())
      added++
    }
    return added
  }

  consolidate(ns?: string): { candidates: number; added: number; merged: number } {
    const started = Date.now()
    const rows = this.db.prepare(
      `SELECT * FROM memory_candidates WHERE consumed = 0${ns ? ' AND ns = ?' : ''} ORDER BY id LIMIT 200`,
    ).all(...(ns ? [ns] : [])) as any[]
    let added = 0
    let merged = 0
    for (const row of rows) {
      const tokens = tokenize(row.text)
      const existing = this.list({ ns: row.ns, limit: 100 })
      const near = existing.find((m) => jaccard(new Set(tokens), new Set(tokenize(m.text))) >= 0.8)
      if (near) {
        this.db.prepare('UPDATE memories SET updated_at = ?, confidence = MIN(1, confidence + 0.05) WHERE id = ?')
          .run(Date.now(), near.id)
        merged++
      } else {
        this.remember({ ns: row.ns, text: row.text, kind: row.kind, source: 'consolidation', confidence: 0.6 })
        added++
      }
      this.db.prepare('UPDATE memory_candidates SET consumed = 1 WHERE id = ?').run(row.id)
    }
    this.db.prepare(
      'INSERT INTO memory_runs(started_at, ended_at, candidates, added, merged, archived) VALUES (?, ?, ?, ?, ?, 0)',
    ).run(started, Date.now(), rows.length, added, merged)
    return { candidates: rows.length, added, merged }
  }

  stats(ns: string): { total: number; pinned: number; byKind: Record<string, number> } {
    const total = (this.db.prepare('SELECT COUNT(*) AS c FROM memories WHERE ns = ?').get(ns) as any).c
    const pinned = (this.db.prepare('SELECT COUNT(*) AS c FROM memories WHERE ns = ? AND pinned = 1').get(ns) as any).c
    const byKind: Record<string, number> = {}
    for (const row of this.catalog(ns)) byKind[row.kind] = row.count
    return { total, pinned, byKind }
  }
}

function extractCandidates(text: string): { text: string; kind: MemoryKind }[] {
  const out: { text: string; kind: MemoryKind }[] = []
  const rules: [RegExp, MemoryKind][] = [
    [/^记住[:：]?\s*(.{2,200})$/, 'fact'],
    [/^以后(?:都)?(?:要)?\s*(.{2,200})$/, 'rule'],
    [/^以后(?:都)?(?:别|不要)\s*(.{2,200})$/, 'rule'],
    [/^我(?:喜欢|偏好|习惯|不喜欢)\s*(.{2,200})$/, 'preference'],
    [/^我的(.{1,20}?)是\s*(.{1,100})$/, 'fact'],
  ]
  for (const [re, kind] of rules) {
    const m = text.trim().match(re)
    if (m) out.push({ text: m.slice(1).join('是'), kind })
  }
  return out
}

function toMemory(row: any): Memory {
  return {
    id: row.id,
    ns: row.ns,
    kind: row.kind,
    text: row.text,
    key: row.key ?? undefined,
    source: row.source,
    confidence: row.confidence,
    pinned: !!row.pinned,
    useCount: row.use_count,
    lastUsedAt: row.last_used_at ?? undefined,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    expiresAt: row.expires_at ?? undefined,
  }
}
