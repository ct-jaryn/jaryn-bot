import { createHash, randomUUID } from 'node:crypto'
import { mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { definePlugin } from '@jaryn/kernel'
import type { Plugin } from '@jaryn/kernel'
import type { Tool } from '@jaryn/agent-core'

export interface Signal {
  botId?: string
  kind: string
  title: string
  reason: string
  impact?: number
  urgency?: number
  confidence?: number
  evidence?: unknown
}

export interface Proposal {
  id: string
  botId: string
  kind: string
  title: string
  reason: string
  score: number
  evidence?: unknown
  status: 'pending' | 'accepted' | 'dismissed' | 'expired'
  createdAt: number
  expiresAt: number
}

const SCHEMA = `
CREATE TABLE IF NOT EXISTS initiative_proposals (
  id TEXT PRIMARY KEY,
  bot_id TEXT NOT NULL,
  kind TEXT NOT NULL,
  title TEXT NOT NULL,
  title_hash TEXT NOT NULL,
  reason TEXT NOT NULL,
  score REAL NOT NULL,
  evidence_json TEXT,
  status TEXT NOT NULL DEFAULT 'pending',
  created_at INTEGER NOT NULL,
  expires_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS initiative_mutes (
  pattern_hash TEXT PRIMARY KEY,
  pattern TEXT NOT NULL,
  created_at INTEGER NOT NULL
);
`

export interface InitiativeConfig {
  threshold?: number
  maxPerDay?: number
  dedupeMs?: number
  ttlMs?: number
}

export class InitiativeService {
  private db: any
  private cfg: Required<InitiativeConfig>
  emit?: (event: string, payload: unknown) => void

  constructor(db: any, config: InitiativeConfig = {}) {
    this.db = db
    this.db.exec(SCHEMA)
    this.cfg = {
      threshold: config.threshold ?? 0.6,
      maxPerDay: config.maxPerDay ?? 3,
      dedupeMs: config.dedupeMs ?? 24 * 3600_000,
      ttlMs: config.ttlMs ?? 24 * 3600_000,
    }
  }

  ingest(signal: Signal): { created: Proposal | null; skipped?: string } {
    const botId = signal.botId ?? 'default'
    const hash = hashOf(`${botId}:${signal.title}`)
    if (this.db.prepare('SELECT 1 FROM initiative_mutes WHERE pattern_hash = ?').get(hash)) {
      return { created: null, skipped: 'muted' }
    }
    const since = Date.now() - this.cfg.dedupeMs
    if (this.db.prepare('SELECT 1 FROM initiative_proposals WHERE title_hash = ? AND created_at > ?').get(hash, since)) {
      return { created: null, skipped: 'duplicate' }
    }
    const today = this.db.prepare('SELECT COUNT(*) AS c FROM initiative_proposals WHERE bot_id = ? AND created_at > ?').get(botId, Date.now() - 86_400_000) as any
    if (today.c >= this.cfg.maxPerDay) return { created: null, skipped: 'daily-cap' }

    const score = (signal.impact ?? 0.6) * (signal.urgency ?? 0.6) * (signal.confidence ?? 0.6) - 0.15
    if (score < this.cfg.threshold) return { created: null, skipped: `low-score:${score.toFixed(2)}` }
    const id = `prop_${randomUUID()}`
    const now = Date.now()
    this.db.prepare(
      `INSERT INTO initiative_proposals(id, bot_id, kind, title, title_hash, reason, score, evidence_json, status, created_at, expires_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'pending', ?, ?)`,
    ).run(id, botId, signal.kind ?? 'generic', signal.title, hash, signal.reason, score, signal.evidence ? JSON.stringify(signal.evidence) : null, now, now + this.cfg.ttlMs)
    const proposal = this.get(id)!
    this.emit?.('initiative/proposal', proposal)
    return { created: proposal }
  }

  get(id: string): Proposal | undefined {
    const row = this.db.prepare('SELECT * FROM initiative_proposals WHERE id = ?').get(id) as any
    return row ? toProposal(row) : undefined
  }

  list(botId?: string): Proposal[] {
    this.expire()
    const rows = botId
      ? this.db.prepare(`SELECT * FROM initiative_proposals WHERE bot_id = ? AND status = 'pending' ORDER BY score DESC`).all(botId)
      : this.db.prepare(`SELECT * FROM initiative_proposals WHERE status = 'pending' ORDER BY score DESC`).all()
    return (rows as any[]).map(toProposal)
  }

  accept(id: string): Proposal {
    return this.setStatus(id, 'accepted')
  }

  dismiss(id: string, mute = false): Proposal {
    const proposal = this.get(id)
    if (!proposal) throw new Error(`proposal not found: ${id}`)
    if (mute) {
      this.db.prepare('INSERT OR REPLACE INTO initiative_mutes(pattern_hash, pattern, created_at) VALUES (?, ?, ?)')
        .run(hashOf(`${proposal.botId}:${proposal.title}`), proposal.title, Date.now())
    }
    return this.setStatus(id, 'dismissed')
  }

  /** Built-in scan: failed jobs + stale tasks. */
  scan(): Proposal[] {
    const created: Proposal[] = []
    const store = this.storeDb
    if (store) {
      const failed = store.prepare(
        `SELECT job_id, COUNT(*) AS c FROM job_runs WHERE status IN ('failed','budget') AND started_at > ? GROUP BY job_id`,
      ).all(Date.now() - 86_400_000) as any[]
      for (const row of failed) {
        const r = this.ingest({
          kind: 'job-failure',
          title: `任务 ${row.job_id} 失败了`,
          reason: `过去 24h 内失败/超预算 ${row.c} 次`,
          impact: 0.8, urgency: 0.7, confidence: 0.9,
          evidence: { jobId: row.job_id, count: row.c },
        })
        if (r.created) created.push(r.created)
      }
      const stale = store.prepare(
        `SELECT id, title FROM tasks WHERE status IN ('todo','claimed') AND updated_at < ? LIMIT 2`,
      ).all(Date.now() - 3 * 86_400_000) as any[]
      for (const row of stale) {
        const r = this.ingest({
          kind: 'stale-task',
          title: `任务「${row.title}」停滞了`,
          reason: '超过 3 天没有更新',
          impact: 0.6, urgency: 0.6, confidence: 0.8,
          evidence: { taskId: row.id },
        })
        if (r.created) created.push(r.created)
      }
      created.push(...this.scanGoalStalls(store))
    }
    created.push(...this.scanCalendar())
    created.push(...this.scanConnectorHealth())
    created.push(...this.scanUnreadEmail())
    return created
  }

  /** Goals stuck in active with no journal progress for a week. */
  private scanGoalStalls(store: any): Proposal[] {
    const out: Proposal[] = []
    try {
      const rows = store.prepare(
        "SELECT id, objective, rounds, updated_at FROM goals WHERE status = 'active' AND updated_at < ? LIMIT 2",
      ).all(Date.now() - 7 * 86_400_000) as any[]
      for (const row of rows) {
        const r = this.ingest({
          kind: 'goal-stall',
          title: `目标「${String(row.objective).slice(0, 30)}」停滞了`,
          reason: `已进行 ${row.rounds} 轮，7 天无更新`,
          impact: 0.7, urgency: 0.6, confidence: 0.85,
          evidence: { goalId: row.id, rounds: row.rounds },
        })
        if (r.created) out.push(r.created)
      }
    } catch { /* goals table optional */ }
    return out
  }

  /** Calendar items starting within the next 45 minutes. */
  scanCalendar(now = new Date()): Proposal[] {
    const out: Proposal[] = []
    for (const event of this.calendarEvents) {
      const start = new Date(event.startsAt).getTime()
      const delta = start - now.getTime()
      if (Number.isNaN(start) || delta < 0 || delta > 45 * 60_000) continue
      const r = this.ingest({
        kind: 'calendar-soon',
        title: `「${event.title}」${Math.round(delta / 60_000)} 分钟后开始`,
        reason: '日历事件临近，建议准备材料',
        impact: 0.7, urgency: 0.9, confidence: 0.95,
        evidence: { event: event.title, startsAt: event.startsAt },
      })
      if (r.created) out.push(r.created)
    }
    return out
  }

  /** Connectors whose last call failed recently. */
  scanConnectorHealth(): Proposal[] {
    const out: Proposal[] = []
    for (const failure of this.connectorFailures) {
      if (Date.now() - failure.at > 86_400_000) continue
      const r = this.ingest({
        kind: 'connector-failure',
        title: `连接器 ${failure.id} 调用失败`,
        reason: failure.message.slice(0, 120),
        impact: 0.7, urgency: 0.6, confidence: 0.9,
        evidence: { connector: failure.id, message: failure.message },
      })
      if (r.created) out.push(r.created)
    }
    return out
  }

  /** Unread mail older than a day. */
  scanUnreadEmail(): Proposal[] {
    const out: Proposal[] = []
    for (const mail of this.unreadMail) {
      if (Date.now() - mail.receivedAt < 86_400_000) continue
      const r = this.ingest({
        kind: 'email-unread',
        title: `未读邮件：${mail.subject.slice(0, 40)}`,
        reason: `来自 ${mail.from}，已放置超过 1 天`,
        impact: 0.5, urgency: 0.5, confidence: 0.8,
        evidence: { uid: mail.uid, from: mail.from },
      })
      if (r.created) out.push(r.created)
    }
    return out
  }

  /** Feeders fill these from connectors/email/calendar plugins. */
  calendarEvents: { title: string; startsAt: string }[] = []
  connectorFailures: { id: string; message: string; at: number }[] = []
  unreadMail: { uid: string; from: string; subject: string; receivedAt: number }[] = []

  storeDb?: any

  private expire(): void {
    this.db.prepare(`UPDATE initiative_proposals SET status = 'expired' WHERE status = 'pending' AND expires_at < ?`).run(Date.now())
  }

  private setStatus(id: string, status: Proposal['status']): Proposal {
    const proposal = this.get(id)
    if (!proposal) throw new Error(`proposal not found: ${id}`)
    if (proposal.status !== 'pending') throw new Error(`proposal ${id} is ${proposal.status}`)
    this.db.prepare('UPDATE initiative_proposals SET status = ? WHERE id = ?').run(status, id)
    return this.get(id)!
  }
}

function hashOf(text: string): string {
  return createHash('sha256').update(text).digest('hex')
}

function toProposal(row: any): Proposal {
  return {
    id: row.id, botId: row.bot_id, kind: row.kind, title: row.title, reason: row.reason,
    score: row.score, evidence: row.evidence_json ? JSON.parse(row.evidence_json) : undefined,
    status: row.status, createdAt: row.created_at, expiresAt: row.expires_at,
  }
}

export interface TeachConfig {
  home?: string
}

export class TeachService {
  private dir: string
  constructor(home: string) {
    this.dir = join(home, 'skills')
    mkdirSync(this.dir, { recursive: true })
  }

  draft(input: { title: string; steps: string[] }): string {
    return [`# ${input.title}`, '', '## Steps', ...input.steps.map((s, i) => `${i + 1}. ${s}`), ''].join('\n')
  }

  save(input: { title: string; markdown?: string; steps?: string[] }): { path: string } {
    const slug = input.title.toLowerCase().replace(/[^\w\u4e00-\u9fa5-]+/g, '-').replace(/^-+|-+$/g, '') || `skill-${Date.now()}`
    const dir = join(this.dir, slug)
    mkdirSync(dir, { recursive: true })
    const markdown = input.markdown ?? this.draft({ title: input.title, steps: input.steps ?? [] })
    const path = join(dir, 'SKILL.md')
    writeFileSync(path, markdown)
    return { path }
  }

  list(): { name: string }[] {
    return readdirSync(this.dir, { withFileTypes: true }).filter((d) => d.isDirectory()).map((d) => ({ name: d.name }))
  }

  /** Read a skill's SKILL.md by name. */
  load(name: string): string {
    const safe = name.replace(/[^\w\u4e00-\u9fa5-]/g, '')
    const path = join(this.dir, safe, 'SKILL.md')
    return readFileSync(path, 'utf8')
  }

  /** Short catalog for the system prompt (names + first heading only). */
  catalog(limit = 12): string {
    const skills = this.list().slice(0, limit)
    if (skills.length === 0) return ''
    const lines = skills.map((s) => {
      try {
        const text = readFileSync(join(this.dir, s.name, 'SKILL.md'), 'utf8')
        const title = text.match(/^#\s+(.+)$/m)?.[1]?.trim() ?? s.name
        const steps = (text.match(/^\d+\.\s+(.+)$/gm) ?? []).length
        return `- ${title} (${steps} steps, path skills/${s.name}/SKILL.md)`
      } catch {
        return `- ${s.name}`
      }
    })
    return `Available skills (load with fs.read on the path when relevant):\n${lines.join('\n')}`
  }
}

export interface InitiativePluginConfig extends InitiativeConfig {
  scanEveryMs?: number
}

export function initiativePlugin(cfg: InitiativePluginConfig = {}): Plugin<InitiativePluginConfig> {
  return definePlugin({
    name: '@jaryn/initiative',
    provides: ['initiative', 'teach'],
    inject: ['store'],
    apply(ctx, config = {}) {
      const store = ctx.get<any>('store')
      const service = new InitiativeService(store.db, { ...cfg, ...config })
      service.storeDb = store.db
      service.emit = (event, payload) => ctx.emit(event, payload)
      ctx.provide('initiative', service)
      const scanEvery = config.scanEveryMs ?? cfg.scanEveryMs
      if (scanEvery && scanEvery > 0) {
        const timer = setInterval(() => { try { service.scan() } catch { /* best effort */ } }, Math.max(60_000, scanEvery))
        timer.unref?.()
        ctx.effect(() => () => clearInterval(timer))
      }
      const home = process.env.JARY_HOME ?? join(process.cwd(), 'data')
      const teachService = new TeachService(home)
      ctx.provide('teach', teachService)
      ctx.provide('skills', { catalog: (limit?: number) => teachService.catalog(limit), list: () => teachService.list() })
    },
  })
}

export function initiativeToolsPlugin(): Plugin {
  return definePlugin({
    name: '@jaryn/initiative/tools',
    inject: ['initiative', 'teach', 'tools'],
    optional: ['tasks'],
    apply(ctx) {
      const initiative = ctx.get<InitiativeService>('initiative')!
      const teach = ctx.get<TeachService>('teach')!
      const tools = ctx.get<{ register(t: Tool): () => void }>('tools')!
      const list: Tool[] = [
        {
          name: 'initiative.list', description: 'List pending proactive proposals.', risk: 'read',
          schema: { type: 'object', properties: { botId: { type: 'string' } } },
          async execute(args) { return initiative.list(args.botId ? String(args.botId) : undefined) },
        },
        {
          name: 'initiative.scan', description: 'Scan for proactive proposals (failed jobs, stale tasks).', risk: 'read',
          schema: { type: 'object', properties: {} },
          async execute() { return initiative.scan() },
        },
        {
          name: 'initiative.accept',
          description: 'Accept a proposal, create the task and run it now (pass run=false to only create it).',
          risk: 'execute',
          schema: { type: 'object', properties: { id: { type: 'string' }, run: { type: 'boolean' } }, required: ['id'] },
          async execute(args) {
            const proposal = initiative.accept(String(args.id))
            const tasks = ctx.get<any>('tasks')
            const task = tasks ? tasks.create({ sessionId: `initiative:${proposal.id}`, title: proposal.title, body: proposal.reason }) : undefined
            const shouldRun = args.run !== false
            if (!shouldRun) return { proposal, task, executed: false }
            const agent = ctx.get<any>('agent')
            if (!agent?.runTurn) return { proposal, task, executed: false, note: 'agent not mounted' }
            // Background provenance: tools needing a human will fail closed instead of hanging.
            const result = await agent.runTurn({
              sessionId: `initiative:${proposal.id}`,
              text: `主动提议已获批准，请执行：${proposal.title}\n\n背景：${proposal.reason}\n\n完成后简要汇报结果。`,
              provenance: 'system',
            })
            tasks?.update?.(task?.id, { status: result.finishReason === 'completed' ? 'done' : 'blocked' })
            return { proposal, task, executed: true, finishReason: result.finishReason, summary: String(result.text ?? '').slice(0, 500) }
          },
        },
        {
          name: 'initiative.dismiss', description: 'Dismiss a proposal (optionally mute this type).', risk: 'write',
          schema: { type: 'object', properties: { id: { type: 'string' }, mute: { type: 'boolean' } }, required: ['id'] },
          async execute(args) { return initiative.dismiss(String(args.id), !!args.mute) },
        },
        {
          name: 'teach.draft', description: 'Draft a SKILL.md from a title and steps.', risk: 'write',
          schema: { type: 'object', properties: { title: { type: 'string' }, steps: { type: 'array', items: { type: 'string' } } }, required: ['title', 'steps'] },
          async execute(args) { return { markdown: teach.draft({ title: String(args.title), steps: (args.steps as string[]) ?? [] }) } },
        },
        {
          name: 'teach.save', description: 'Save a taught skill to the workspace skills directory.', risk: 'write',
          schema: { type: 'object', properties: { title: { type: 'string' }, markdown: { type: 'string' }, steps: { type: 'array', items: { type: 'string' } } }, required: ['title'] },
          async execute(args) { return teach.save({ title: String(args.title), markdown: args.markdown ? String(args.markdown) : undefined, steps: (args.steps as string[]) ?? [] }) },
        },
        {
          name: 'skill.load', description: 'Load the full SKILL.md for a taught skill by name.', risk: 'read',
          schema: { type: 'object', properties: { name: { type: 'string' } }, required: ['name'] },
          async execute(args) { return { markdown: teach.load(String(args.name ?? '')) } },
        },
        {
          name: 'teach.record_start', description: 'Start recording user/bot actions on the computer to turn into a skill.', risk: 'write',
          schema: { type: 'object', properties: { botId: { type: 'string' } } },
          async execute(args) {
            const computer = ctx.get<any>('computer')
            if (!computer) throw new Error('computer not mounted')
            return computer.startRecording(String(args.botId ?? 'default'))
          },
        },
        {
          name: 'teach.record_stop', description: 'Stop recording and draft a SKILL.md from the captured steps.', risk: 'write',
          schema: { type: 'object', properties: { botId: { type: 'string' }, title: { type: 'string' } }, required: ['title'] },
          async execute(args) {
            const computer = ctx.get<any>('computer')
            if (!computer) throw new Error('computer not mounted')
            const rec = computer.stopRecording(String(args.botId ?? 'default'))
            if (!rec) throw new Error('no recording in progress')
            return { title: String(args.title), steps: rec.steps, durationMs: rec.durationMs, markdown: teach.draft({ title: String(args.title), steps: rec.steps }) }
          },
        },
        {
          name: 'teach.list', description: 'List taught skills.', risk: 'read',
          schema: { type: 'object', properties: {} },
          async execute() { return teach.list() },
        },
      ]
      for (const tool of list) ctx.effect(() => tools.register(tool))
    },
  })
}
