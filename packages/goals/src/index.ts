import { randomUUID } from 'node:crypto'
import { definePlugin } from '@jaryn/kernel'
import type { Plugin } from '@jaryn/kernel'
import type { Tool } from '@jaryn/agent-core'

export type GoalStatus = 'active' | 'paused' | 'completed' | 'blocked' | 'cleared'

export interface Goal {
  id: string
  sessionId: string
  objective: string
  status: GoalStatus
  rounds: number
  maxRounds: number
  journal: { round: number; note: string; at: number }[]
  createdAt: number
  updatedAt: number
}

const SCHEMA = `
CREATE TABLE IF NOT EXISTS goals (
  id TEXT PRIMARY KEY,
  session_id TEXT NOT NULL,
  objective TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'active',
  rounds INTEGER NOT NULL DEFAULT 0,
  max_rounds INTEGER NOT NULL DEFAULT 12,
  journal_json TEXT NOT NULL DEFAULT '[]',
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS goals_session ON goals(session_id, updated_at);
`

export class GoalService {
  private db: any
  constructor(db: any) {
    this.db = db
    this.db.exec(SCHEMA)
  }

  set(input: { sessionId: string; objective: string; maxRounds?: number }): Goal {
    const existing = this.active(input.sessionId)
    if (existing) {
      this.db.prepare('UPDATE goals SET objective = ?, updated_at = ? WHERE id = ?').run(input.objective, Date.now(), existing.id)
      return this.get(existing.id)!
    }
    const id = `goal_${randomUUID()}`
    const now = Date.now()
    this.db.prepare(
      'INSERT INTO goals(id, session_id, objective, status, rounds, max_rounds, journal_json, created_at, updated_at) VALUES (?, ?, ?, ?, 0, ?, ?, ?, ?)',
    ).run(id, input.sessionId, input.objective, 'active', Math.max(1, Math.min(input.maxRounds ?? 8, 20)), '[]', now, now)
    return this.get(id)!
  }

  get(id: string): Goal | undefined {
    const row = this.db.prepare('SELECT * FROM goals WHERE id = ?').get(id) as any
    return row ? toGoal(row) : undefined
  }

  active(sessionId: string): Goal | undefined {
    const row = this.db.prepare(`SELECT * FROM goals WHERE session_id = ? AND status = 'active' ORDER BY updated_at DESC LIMIT 1`).get(sessionId) as any
    return row ? toGoal(row) : undefined
  }

  list(): Goal[] {
    return (this.db.prepare('SELECT * FROM goals ORDER BY updated_at DESC').all() as any[]).map(toGoal)
  }

  update(id: string, patch: { status?: GoalStatus; rounds?: number; note?: string }): Goal {
    const goal = this.get(id)
    if (!goal) throw new Error(`goal not found: ${id}`)
    const journal = [...goal.journal]
    if (patch.note) journal.push({ round: patch.rounds ?? goal.rounds, note: patch.note, at: Date.now() })
    this.db.prepare('UPDATE goals SET status = ?, rounds = ?, journal_json = ?, updated_at = ? WHERE id = ?')
      .run(patch.status ?? goal.status, patch.rounds ?? goal.rounds, JSON.stringify(journal.slice(-20)), Date.now(), id)
    return this.get(id)!
  }

  /** Multi-round drive: run agent turns until DONE, blocked, budget or max rounds. */
  async run(id: string): Promise<Goal> {
    const goal = this.get(id)
    if (!goal) throw new Error(`goal not found: ${id}`)
    const agent = this.agent
    if (!agent) throw new Error('agent not mounted; cannot run goal')
    let current = goal
    for (let round = current.rounds + 1; round <= current.maxRounds; round++) {
      const prompt = round === 1
        ? current.objective
        : `Continue toward the goal. Round ${round}/${current.maxRounds}. Reply DONE when finished, or BLOCKED: <reason> if you cannot proceed.\n\nGoal: ${current.objective}`
      const result = await agent.runTurn({ sessionId: current.sessionId, text: prompt, provenance: 'system' })
      const text = result.text.trim()
      if (/^BLOCKED\b/i.test(text)) { current = this.update(id, { status: 'blocked', rounds: round, note: text.slice(0, 200) }); break }
      if (/\bDONE\b/i.test(text) || result.finishReason === 'completed' && round === current.maxRounds) {
        current = this.update(id, { status: 'completed', rounds: round, note: text.slice(0, 200) })
        break
      }
      current = this.update(id, { status: 'active', rounds: round, note: text.slice(0, 200) })
      if (result.finishReason !== 'completed') { current = this.update(id, { status: 'blocked', note: `turn ${result.finishReason}` }); break }
    }
    return this.get(id)!
  }

  agent?: { runTurn(input: { sessionId: string; text: string; provenance?: string }): Promise<{ text: string; finishReason: string }> }

  promptSection(sessionId: string): string {
    const goal = this.active(sessionId)
    if (!goal) return ''
    return `Active goal (round ${goal.rounds}/${goal.maxRounds}): ${goal.objective}`
  }
}

function toGoal(row: any): Goal {
  return {
    id: row.id, sessionId: row.session_id, objective: row.objective, status: row.status,
    rounds: row.rounds, maxRounds: row.max_rounds, journal: JSON.parse(row.journal_json),
    createdAt: row.created_at, updatedAt: row.updated_at,
  }
}

export function goalsPlugin(): Plugin {
  return definePlugin({
    name: '@jaryn/goals',
    provides: ['goals'],
    inject: ['store', 'agent'],
    apply(ctx) {
      const store = ctx.get<any>('store')
      const service = new GoalService(store.db)
      service.agent = ctx.get<any>('agent')
      ctx.provide('goals', service)
    },
  })
}

export function goalToolsPlugin(): Plugin {
  return definePlugin({
    name: '@jaryn/goals/tools',
    inject: ['goals', 'tools'],
    apply(ctx) {
      const goals = ctx.get<GoalService>('goals')!
      const tools = ctx.get<{ register(t: Tool): () => void }>('tools')!
      const list: Tool[] = [
        {
          name: 'goal.set',
          description: 'Set (or replace) the persistent goal for this session.',
          risk: 'write',
          schema: { type: 'object', properties: { objective: { type: 'string' }, maxRounds: { type: 'number' } }, required: ['objective'] },
          async execute(args, runCtx) { return goals.set({ sessionId: runCtx.sessionId, objective: String(args.objective), maxRounds: args.maxRounds ? Number(args.maxRounds) : undefined }) },
        },
        {
          name: 'goal.status',
          description: 'Show the active goal and its progress.',
          risk: 'read',
          schema: { type: 'object', properties: {} },
          async execute(_args, runCtx) { return goals.active(runCtx.sessionId) ?? { status: 'none' } },
        },
        {
          name: 'goal.run',
          description: 'Drive the active goal for up to maxRounds turns until DONE/BLOCKED.',
          risk: 'execute',
          schema: { type: 'object', properties: { id: { type: 'string' } } },
          async execute(args, runCtx) {
            const goal = args.id ? goals.get(String(args.id)) : goals.active(runCtx.sessionId)
            if (!goal) throw new Error('no active goal')
            return goals.run(goal.id)
          },
        },
        {
          name: 'goal.pause',
          description: 'Pause or clear the active goal.',
          risk: 'write',
          schema: { type: 'object', properties: { id: { type: 'string' }, clear: { type: 'boolean' } } },
          async execute(args, runCtx) {
            const goal = args.id ? goals.get(String(args.id)) : goals.active(runCtx.sessionId)
            if (!goal) throw new Error('no active goal')
            return goals.update(goal.id, { status: args.clear ? 'cleared' : 'paused' })
          },
        },
      ]
      for (const tool of list) ctx.effect(() => tools.register(tool))
    },
  })
}
