import { createHmac, randomUUID, timingSafeEqual } from 'node:crypto'
import { join } from 'node:path'
import { definePlugin } from '@jaryn/kernel'
import type { Context, Plugin } from '@jaryn/kernel'
import type { BudgetLimits, TurnResult } from '@jaryn/agent-core'
import { nextCron } from './cron.ts'

export type Trigger =
  | { kind: 'cron'; expr: string; tz: string }
  | { kind: 'every'; seconds: number }
  | { kind: 'webhook'; path: string; secret?: string }

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
    if (job.trigger.secret) {
      const expected = createHmac('sha256', job.trigger.secret).update(body).digest('hex')
      const given = (signature ?? '').replace(/^sha256=/, '')
      const a = Buffer.from(expected)
      const b = Buffer.from(given)
      if (a.length !== b.length || !timingSafeEqual(a, b)) throw new Error('invalid webhook signature')
    }
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
    const now = Date.now()
    const due = (this.db.prepare('SELECT * FROM jobs WHERE enabled = 1 AND next_run_at IS NOT NULL AND next_run_at <= ?').all(now) as any[]).map(toJob)
    for (const job of due) {
      if (this.running.has(job.id)) continue
      await this.dispatch(job)
    }
  }

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
    }
    return run
  }

  private nextRun(trigger: Trigger): number | undefined {
    if (trigger.kind === 'cron') return nextCron(trigger.expr, trigger.tz).getTime()
    if (trigger.kind === 'every') return Date.now() + Math.max(60, trigger.seconds) * 1000
    return undefined
  }

  private require(id: string): Job {
    const job = this.get(id)
    if (!job) throw new Error(`job not found: ${id}`)
    return job
  }
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

export { parseCron, nextCron } from './cron.ts'
