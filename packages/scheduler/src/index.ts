import { createHmac, randomUUID, timingSafeEqual } from 'node:crypto'
import { join } from 'node:path'
import { definePlugin } from '@jaryn/kernel'
import type { Context, Plugin } from '@jaryn/kernel'
import type { BudgetLimits, Tool, TurnResult } from '@jaryn/agent-core'
import { nextCron } from './cron.ts'

export type Trigger =
  | { kind: 'cron'; expr: string; tz: string }
  | { kind: 'every'; seconds: number }
  | { kind: 'webhook'; path: string; secret?: string }
  | { kind: 'rss'; url: string; everySeconds?: number }

export interface JobBudget extends Partial<BudgetLimits> {
  maxRounds?: number
}

export interface Job {
  id: string
  botId: string
  name: string
  trigger: Trigger
  mission: string
  enabled: boolean
  budget: JobBudget
  deliverySessionId?: string
  lastRunAt?: number
  nextRunAt?: number
  runCount: number
}

export interface JobRun {
  id: string
  jobId: string
  sessionId: string
  status: 'running' | 'done' | 'failed' | 'budget'
  startedAt: number
  endedAt?: number
  summary?: string
  rounds: number
}

const SCHEMA = `
CREATE TABLE IF NOT EXISTS jobs (
  id TEXT PRIMARY KEY,
  bot_id TEXT NOT NULL,
  name TEXT NOT NULL,
  trigger_json TEXT NOT NULL,
  mission TEXT NOT NULL,
  enabled INTEGER NOT NULL DEFAULT 1,
  budget_json TEXT NOT NULL DEFAULT '{}',
  delivery_session TEXT,
  last_run_at INTEGER,
  next_run_at INTEGER,
  run_count INTEGER NOT NULL DEFAULT 0
);
CREATE TABLE IF NOT EXISTS job_runs (
  id TEXT PRIMARY KEY,
  job_id TEXT NOT NULL,
  session_id TEXT NOT NULL,
  status TEXT NOT NULL,
  started_at INTEGER NOT NULL,
  ended_at INTEGER,
  summary TEXT,
  rounds INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS job_runs_job ON job_runs(job_id, started_at);
`

export class JobScheduler {
  private db: any
  private running = new Set<string>()
  private timer?: NodeJS.Timeout
  private stopped = false
  private ctx: Context

  constructor(ctx: Context) {
    this.ctx = ctx
    const store = ctx.get<any>('store')
    if (!store) throw new Error('scheduler needs a store service')
    this.db = store.db
    this.db.exec(SCHEMA)
  }

  add(input: { botId?: string; name?: string; trigger: Trigger; mission: string; budget?: JobBudget; deliverySessionId?: string }): Job {
    const id = `job_${randomUUID()}`
    const next = this.nextRun(input.trigger)
    this.db.prepare(
      `INSERT INTO jobs(id, bot_id, name, trigger_json, mission, enabled, budget_json, delivery_session, next_run_at, run_count)
       VALUES (?, ?, ?, ?, ?, 1, ?, ?, ?, 0)`,
    ).run(id, input.botId ?? 'default', input.name ?? id, JSON.stringify(input.trigger), input.mission,
      JSON.stringify(input.budget ?? {}), input.deliverySessionId ?? null, next ?? null)
    return this.get(id)!
  }

  get(id: string): Job | undefined {
    const row = this.db.prepare('SELECT * FROM jobs WHERE id = ?').get(id) as any
    return row ? toJob(row) : undefined
  }

  list(): Job[] {
    return (this.db.prepare('SELECT * FROM jobs ORDER BY run_count DESC').all() as any[]).map(toJob)
  }

  remove(id: string): boolean {
    return this.db.prepare('DELETE FROM jobs WHERE id = ?').run(id).changes > 0
  }

  enable(id: string, enabled = true): Job {
    const job = this.require(id)
    const next = enabled ? this.nextRun(job.trigger) : null
    this.db.prepare('UPDATE jobs SET enabled = ?, next_run_at = ? WHERE id = ?').run(enabled ? 1 : 0, next ?? null, id)
    return this.get(id)!
  }

  runs(jobId?: string): JobRun[] {
    const rows = jobId
      ? this.db.prepare('SELECT * FROM job_runs WHERE job_id = ? ORDER BY started_at DESC LIMIT 50').all(jobId)
      : this.db.prepare('SELECT * FROM job_runs ORDER BY started_at DESC LIMIT 50').all()
    return (rows as any[]).map(toRun)
  }

  async runNow(id: string): Promise<JobRun> {
    const job = this.require(id)
    return this.dispatch(job)
  }

  async triggerWebhook(id: string, body: string, signature?: string): Promise<JobRun> {
    const job = this.require(id)
    if (job.trigger.kind !== 'webhook') throw new Error('job is not a webhook trigger')
    // Fail closed: a webhook without a secret has no authentication at all, so refuse it
    // rather than letting anyone on the network trigger the job.
    if (!job.trigger.secret) throw new Error('webhook job has no secret; refusing unauthenticated trigger')
    const expected = createHmac('sha256', job.trigger.secret).update(body).digest('hex')
    const given = (signature ?? '').replace(/^sha256=/, '')
    const a = Buffer.from(expected)
    const b = Buffer.from(given)
    if (a.length !== b.length || !timingSafeEqual(a, b)) throw new Error('invalid webhook signature')
    return this.dispatch(job)
  }

  start(intervalMs = 5000): void {
    this.stopped = false
    if (this.timer) clearInterval(this.timer)
    this.timer = setInterval(() => { void this.tick() }, intervalMs)
    this.timer.unref?.()
  }

  async tick(): Promise<void> {
    if (this.stopped) return
    await this.pollFeeds()
    const now = Date.now()
    const due = (this.db.prepare('SELECT * FROM jobs WHERE enabled = 1 AND next_run_at IS NOT NULL AND next_run_at <= ?').all(now) as any[]).map(toJob)
    for (const job of due) {
      if (this.running.has(job.id)) continue
      await this.dispatch(job)
    }
  }

  /** Poll RSS/Atom feeds and dispatch jobs when a new item appears. */
  async pollFeeds(opts: { force?: boolean } = {}): Promise<void> {
    const jobs = this.list().filter((job) => job.enabled && job.trigger.kind === 'rss')
    for (const job of jobs) {
      const trigger = job.trigger as { kind: 'rss'; url: string; everySeconds?: number }
      const every = Math.max(60, trigger.everySeconds ?? 600) * 1000
      if (!opts.force && job.lastRunAt && Date.now() - job.lastRunAt < every) continue
      try {
        const items = await fetchFeed(trigger.url)
        const latest = items[0]
        if (!latest) continue
        const seenKey = `rss:${job.id}`
        const previous = this.seen.get(seenKey)
        this.seen.set(seenKey, latest.link)
        if (previous === latest.link) continue
        if (this.running.has(job.id)) continue
        const originalMission = job.mission
        const enriched = `${originalMission}\n\nNew feed item: ${latest.title} <${latest.link}>`
        this.running.add(job.id)
        this.running.delete(job.id)
        await this.dispatch({ ...job, mission: enriched })
      } catch (err) {
        this.ctx.emit?.('rss/error', { job: job.id, message: (err as Error).message })
      }
    }
  }

  private seen = new Map<string, string>()

  /** Stop ticking and cancel active job turns. */
  stopAll(): void {
    this.stopped = true
    if (this.timer) clearInterval(this.timer)
    this.timer = undefined
    const agent = this.ctx.get<any>('agent')
    for (const id of this.running) {
      const run = this.runs().find((r) => r.status === 'running')
      if (run) agent?.cancel?.(run.sessionId)
      void id
    }
    this.running.clear()
  }

  private async dispatch(job: Job): Promise<JobRun> {
    if (this.running.has(job.id)) throw new Error(`job already running: ${job.id}`)
    this.running.add(job.id)
    const sessionId = job.deliverySessionId ?? `job:${job.id}`
    const store = this.ctx.get<any>('store')
    const bots = this.ctx.get<any>('bots')
    const bot = bots?.get(job.botId)
    const cwd = bot?.workspace ?? join(process.cwd(), 'data', 'jobs', job.id)
    if (!store.getSession(sessionId)) store.createSession(sessionId, job.botId, cwd)
    const agent = this.ctx.get<any>('agent')
    const run: JobRun = {
      id: `run_${randomUUID()}`, jobId: job.id, sessionId, status: 'running', startedAt: Date.now(), rounds: 0,
    }
    this.db.prepare(
      'INSERT INTO job_runs(id, job_id, session_id, status, started_at, rounds) VALUES (?, ?, ?, ?, ?, 0)',
    ).run(run.id, run.jobId, run.sessionId, run.status, run.startedAt)

    const maxRounds = Math.max(1, Math.min(job.budget.maxRounds ?? 1, 20))
    let last: TurnResult | undefined
    try {
      for (let round = 1; round <= maxRounds; round++) {
        const text = round === 1
          ? job.mission
          : `Continue toward the goal. Round ${round}/${maxRounds}. Reply DONE when complete.\n\nGoal: ${job.mission}`
        last = await agent.runTurn({
          sessionId,
          text,
          provenance: 'system',
          limits: {
            maxSteps: job.budget.maxSteps,
            maxToolCalls: job.budget.maxToolCalls,
            maxWallMs: job.budget.maxWallMs,
          },
        })
        run.rounds = round
        if (maxRounds === 1 || /\bDONE\b/i.test(last.text) || last.finishReason !== 'completed') break
      }
      run.status = last?.finishReason === 'completed' ? 'done' : last?.finishReason === 'aborted' ? 'failed' : 'budget'
      run.summary = (last?.text ?? '').slice(0, 500)
    } catch (err) {
      run.status = 'failed'
      run.summary = (err as Error).message
    } finally {
      run.endedAt = Date.now()
      this.running.delete(job.id)
      this.db.prepare('UPDATE job_runs SET status = ?, ended_at = ?, summary = ?, rounds = ? WHERE id = ?')
        .run(run.status, run.endedAt, run.summary ?? '', run.rounds, run.id)
      const next = job.trigger.kind === 'webhook' ? null : this.nextRun(job.trigger)
      this.db.prepare('UPDATE jobs SET last_run_at = ?, next_run_at = ?, run_count = run_count + 1 WHERE id = ?')
        .run(run.endedAt, next ?? null, job.id)
      this.ctx.emit?.('job/finished', { jobId: job.id, sessionId, status: run.status, summary: run.summary })
    }
    return run
  }

  private nextRun(trigger: Trigger): number | undefined {
    if (trigger.kind === 'cron') return nextCron(trigger.expr, trigger.tz).getTime()
    if (trigger.kind === 'every') return Date.now() + Math.max(60, trigger.seconds) * 1000
    if (trigger.kind === 'rss') return Date.now() + Math.max(60, trigger.everySeconds ?? 600) * 1000
    return undefined
  }

  private require(id: string): Job {
    const job = this.get(id)
    if (!job) throw new Error(`job not found: ${id}`)
    return job
  }
}

export interface FeedItem {
  title: string
  link: string
}

/** Minimal RSS/Atom reader via regex (no XML dependency). */
export async function fetchFeed(url: string): Promise<FeedItem[]> {
  const res = await fetch(url, { headers: { 'user-agent': 'jaryn-bot/1.1' }, signal: AbortSignal.timeout(15_000) })
  if (!res.ok) throw new Error(`feed HTTP ${res.status}`)
  const xml = await res.text()
  const items: FeedItem[] = []
  for (const match of xml.matchAll(/<(?:item|entry)[\s>][\s\S]*?<\/(?:item|entry)>/g)) {
    const block = match[0]
    const title = block.match(/<title[^>]*>([\s\S]*?)<\/title>/)?.[1]?.replace(/<!\[CDATA\[|\]\]>/g, '').trim() ?? ''
    const linkRaw = block.match(/<link[^>]*>([\s\S]*?)<\/link>/)?.[1]?.trim() ?? block.match(/<link[^>]*href="([^"]+)"/)?.[1] ?? ''
    if (title) items.push({ title, link: linkRaw })
  }
  return items
}

function toJob(row: any): Job {
  return {
    id: row.id,
    botId: row.bot_id,
    name: row.name,
    trigger: JSON.parse(row.trigger_json),
    mission: row.mission,
    enabled: !!row.enabled,
    budget: JSON.parse(row.budget_json),
    deliverySessionId: row.delivery_session ?? undefined,
    lastRunAt: row.last_run_at ?? undefined,
    nextRunAt: row.next_run_at ?? undefined,
    runCount: row.run_count,
  }
}

function toRun(row: any): JobRun {
  return {
    id: row.id, jobId: row.job_id, sessionId: row.session_id, status: row.status,
    startedAt: row.started_at, endedAt: row.ended_at ?? undefined, summary: row.summary ?? undefined, rounds: row.rounds,
  }
}

export function schedulerPlugin(cfg: { tickMs?: number; autostart?: boolean } = {}): Plugin<{ tickMs?: number; autostart?: boolean }> {
  return definePlugin({
    name: '@jaryn/scheduler',
    provides: ['scheduler'],
    inject: ['store', 'agent'],
    apply(ctx, config = {}) {
      const scheduler = new JobScheduler(ctx)
      ctx.provide('scheduler', scheduler)
      if (config.autostart ?? cfg.autostart) scheduler.start(config.tickMs ?? cfg.tickMs ?? 5000)
      ctx.effect(() => () => scheduler.stopAll())
    },
  })
}

export function schedulerToolsPlugin(): Plugin {
  return definePlugin({
    name: '@jaryn/scheduler/tools',
    inject: ['scheduler', 'tools'],
    apply(ctx) {
      const scheduler = ctx.get<JobScheduler>('scheduler')!
      const tools = ctx.get<{ register(t: Tool): () => void }>('tools')!
      const list: Tool[] = [
        {
          name: 'schedule.create',
          description: 'Create a recurring job: mission runs on a cron/every/webhook trigger with a budget.',
          risk: 'write',
          schema: {
            type: 'object',
            properties: {
              mission: { type: 'string' },
              cron: { type: 'string', description: '5-field cron (requires tz)' },
              tz: { type: 'string' },
              everySeconds: { type: 'number' },
              botId: { type: 'string' },
              maxRounds: { type: 'number' },
            },
            required: ['mission'],
          },
          async execute(args) {
            const mission = String(args.mission ?? '')
            if (!mission) throw new Error('mission is required')
            const trigger = args.cron
              ? { kind: 'cron' as const, expr: String(args.cron), tz: String(args.tz ?? 'UTC') }
              : args.everySeconds
                ? { kind: 'every' as const, seconds: Number(args.everySeconds) }
                : null
            if (!trigger) throw new Error('provide cron (with tz) or everySeconds')
            return scheduler.add({
              botId: args.botId ? String(args.botId) : undefined,
              trigger,
              mission,
              budget: { maxRounds: args.maxRounds ? Number(args.maxRounds) : undefined },
            })
          },
        },
        {
          name: 'schedule.list',
          description: 'List scheduled jobs and their next run time.',
          risk: 'read',
          schema: { type: 'object', properties: {} },
          async execute() { return scheduler.list() },
        },
        {
          name: 'schedule.cancel',
          description: 'Disable or remove a scheduled job.',
          risk: 'write',
          schema: { type: 'object', properties: { id: { type: 'string' }, remove: { type: 'boolean' } }, required: ['id'] },
          async execute(args) {
            return args.remove ? { removed: scheduler.remove(String(args.id)) } : scheduler.enable(String(args.id), false)
          },
        },
      ]
      for (const tool of list) ctx.effect(() => tools.register(tool))
    },
  })
}

export { parseCron, nextCron } from './cron.ts'
