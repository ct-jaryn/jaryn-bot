import { mkdirSync } from 'node:fs'
import { join } from 'node:path'
import { randomUUID } from 'node:crypto'
import { definePlugin } from '@jaryn/kernel'
import type { Plugin } from '@jaryn/kernel'
import type { Tool } from '@jaryn/agent-core'

export interface BotRecord {
  id: string
  name: string
  persona: string
  workspace: string
  memoryNs: string
  budget: Record<string, number>
  createdAt: number
}

const SCHEMA = `
CREATE TABLE IF NOT EXISTS bots (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  persona TEXT NOT NULL DEFAULT '',
  workspace TEXT NOT NULL,
  memory_ns TEXT NOT NULL,
  budget_json TEXT NOT NULL DEFAULT '{}',
  created_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS bot_messages (
  id TEXT PRIMARY KEY,
  thread_id TEXT NOT NULL,
  from_bot TEXT NOT NULL,
  to_bot TEXT NOT NULL,
  hop INTEGER NOT NULL,
  kind TEXT NOT NULL,
  content TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'queued',
  created_at INTEGER NOT NULL
);
`

export class BotsService {
  private db: any
  private home: string
  constructor(db: any, home: string) {
    this.db = db
    this.home = home
    this.db.exec(SCHEMA)
  }

  add(input: { id: string; name?: string; persona?: string; workspace?: string; memoryNs?: string }): BotRecord {
    if (!/^[a-z0-9-]{2,32}$/.test(input.id)) throw new Error('bot id must match [a-z0-9-]{2,32}')
    const now = Date.now()
    const workspace = input.workspace ?? join(this.home, 'bots', input.id)
    mkdirSync(workspace, { recursive: true })
    this.db.prepare(
      `INSERT INTO bots(id, name, persona, workspace, memory_ns, budget_json, created_at)
       VALUES (?, ?, ?, ?, ?, '{}', ?)
       ON CONFLICT(id) DO UPDATE SET name = excluded.name, persona = excluded.persona`,
    ).run(input.id, input.name ?? input.id, input.persona ?? '', workspace, input.memoryNs ?? `bot:${input.id}`, now)
    return this.get(input.id)!
  }

  get(id: string): BotRecord | undefined {
    const row = this.db.prepare('SELECT * FROM bots WHERE id = ?').get(id) as any
    return row ? toBot(row) : undefined
  }

  list(): BotRecord[] {
    return (this.db.prepare('SELECT * FROM bots ORDER BY created_at').all() as any[]).map(toBot)
  }

  remove(id: string): boolean {
    return this.db.prepare('DELETE FROM bots WHERE id = ?').run(id).changes > 0
  }

  send(from: string, to: string, content: string, threadId?: string, hop = 0): { id: string; hop: number } {
    if (!this.get(from)) throw new Error(`unknown bot: ${from}`)
    if (!this.get(to)) throw new Error(`unknown bot: ${to}`)
    if (hop > 2) throw new Error('message hop limit exceeded (max 2)')
    const id = `msg_${randomUUID()}`
    this.db.prepare(
      `INSERT INTO bot_messages(id, thread_id, from_bot, to_bot, hop, kind, content, created_at)
       VALUES (?, ?, ?, ?, ?, 'inform', ?, ?)`,
    ).run(id, threadId ?? `th_${randomUUID()}`, from, to, hop, content.slice(0, 2000), Date.now())
    return { id, hop }
  }

  inbox(botId: string, limit = 20): any[] {
    return this.db.prepare(
      `SELECT * FROM bot_messages WHERE to_bot = ? AND status = 'queued' ORDER BY created_at LIMIT ?`,
    ).all(botId, limit)
  }

  markDelivered(ids: string[]): void {
    for (const id of ids) this.db.prepare(`UPDATE bot_messages SET status = 'delivered' WHERE id = ?`).run(id)
  }
}

function toBot(row: any): BotRecord {
  return {
    id: row.id,
    name: row.name,
    persona: row.persona,
    workspace: row.workspace,
    memoryNs: row.memory_ns,
    budget: JSON.parse(row.budget_json),
    createdAt: row.created_at,
  }
}

export function botsPlugin(cfg: { home?: string } = {}): Plugin<{ home?: string }> {
  return definePlugin({
    name: '@jaryn/bots',
    provides: ['bots'],
    inject: ['store'],
    apply(ctx, config = {}) {
      const store = ctx.get<any>('store')
      const home = config.home ?? cfg.home ?? process.env.JARY_HOME ?? join(process.cwd(), 'data')
      ctx.provide('bots', new BotsService(store.db, home))
    },
  })
}

export function botToolsPlugin(): Plugin {
  return definePlugin({
    name: '@jaryn/bots/tools',
    inject: ['bots', 'tools'],
    apply(ctx) {
      const bots = ctx.get<BotsService>('bots')!
      const tools = ctx.get<{ register(t: Tool): () => void }>('tools')!
      const list: Tool[] = [
        {
          name: 'bot.list_agents',
          description: 'List available bots in the roster.',
          risk: 'read',
          schema: { type: 'object', properties: {} },
          async execute() {
            return bots.list().map((b) => ({ id: b.id, name: b.name, workspace: b.workspace }))
          },
        },
        {
          name: 'bot.send_message',
          description: 'Send a message to another bot (max 2 hops).',
          risk: 'external',
          schema: {
            type: 'object',
            properties: { to: { type: 'string' }, content: { type: 'string' }, threadId: { type: 'string' }, hop: { type: 'number' } },
            required: ['to', 'content'],
          },
          async execute(args, runCtx) {
            const from = bots.list()[0]?.id
            if (!from) throw new Error('no bots configured')
            return bots.send(from, String(args.to), String(args.content), args.threadId ? String(args.threadId) : undefined, Number(args.hop ?? 0))
          },
        },
      ]
      for (const tool of list) ctx.effect(() => tools.register(tool))
    },
  })
}
