import { randomUUID } from 'node:crypto'
import { definePlugin } from '@jaryn/kernel'
import type { Plugin } from '@jaryn/kernel'
import type { Tool } from '@jaryn/agent-core'

export interface TaskRecord {
  id: string
  sessionId: string
  title: string
  body: string
  status: 'todo' | 'claimed' | 'doing' | 'done' | 'blocked'
  ownerBot?: string
  ownerSession?: string
  version: number
  createdAt: number
  updatedAt: number
}

const SCHEMA = `
CREATE TABLE IF NOT EXISTS tasks (
  id TEXT PRIMARY KEY,
  session_id TEXT NOT NULL,
  title TEXT NOT NULL,
  body TEXT NOT NULL DEFAULT '',
  status TEXT NOT NULL DEFAULT 'todo',
  owner_bot TEXT,
  owner_session TEXT,
  version INTEGER NOT NULL DEFAULT 1,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS tasks_session ON tasks(session_id, created_at);
`

export class TaskService {
  private db: any
  constructor(db: any) {
    this.db = db
    this.db.exec(SCHEMA)
  }

  create(input: { sessionId: string; title: string; body?: string }): TaskRecord {
    const id = `task_${randomUUID()}`
    const now = Date.now()
    this.db.prepare(
      `INSERT INTO tasks(id, session_id, title, body, status, version, created_at, updated_at)
       VALUES (?, ?, ?, ?, 'todo', 1, ?, ?)`,
    ).run(id, input.sessionId, input.title.slice(0, 200), (input.body ?? '').slice(0, 4000), now, now)
    return this.get(id)!
  }

  get(id: string): TaskRecord | undefined {
    const row = this.db.prepare('SELECT * FROM tasks WHERE id = ?').get(id) as any
    return row ? toTask(row) : undefined
  }

  list(sessionId?: string): TaskRecord[] {
    const rows = sessionId
      ? this.db.prepare('SELECT * FROM tasks WHERE session_id = ? ORDER BY created_at').all(sessionId)
      : this.db.prepare('SELECT * FROM tasks ORDER BY created_at').all()
    return (rows as any[]).map(toTask)
  }

  claim(id: string, ownerBot: string, ownerSession?: string, expectedVersion?: number): TaskRecord {
    const task = this.get(id)
    if (!task) throw new Error(`task not found: ${id}`)
    if (task.status !== 'todo') throw new Error(`task ${id} is ${task.status}, cannot claim`)
    if (expectedVersion && task.version !== expectedVersion) throw new Error(`task version conflict`)
    const changes = this.db.prepare(
      `UPDATE tasks SET status = 'claimed', owner_bot = ?, owner_session = ?, version = version + 1, updated_at = ?
       WHERE id = ? AND status = 'todo' AND version = ?`,
    ).run(ownerBot, ownerSession ?? null, Date.now(), id, task.version).changes
    if (!changes) throw new Error('claim conflict')
    return this.get(id)!
  }

  complete(id: string, ownerBot: string): TaskRecord {
    const task = this.get(id)
    if (!task) throw new Error(`task not found: ${id}`)
    if (task.ownerBot && task.ownerBot !== ownerBot) throw new Error('only the owner can complete this task')
    const changes = this.db.prepare(
      `UPDATE tasks SET status = 'done', version = version + 1, updated_at = ? WHERE id = ? AND status IN ('claimed','doing')`,
    ).run(Date.now(), id).changes
    if (!changes) throw new Error(`task ${id} cannot be completed from ${task.status}`)
    return this.get(id)!
  }
}

function toTask(row: any): TaskRecord {
  return {
    id: row.id,
    sessionId: row.session_id,
    title: row.title,
    body: row.body,
    status: row.status,
    ownerBot: row.owner_bot ?? undefined,
    ownerSession: row.owner_session ?? undefined,
    version: row.version,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  }
}

export function tasksPlugin(): Plugin {
  return definePlugin({
    name: '@jaryn/tasks',
    provides: ['tasks'],
    inject: ['store'],
    apply(ctx) {
      const store = ctx.get<any>('store')
      ctx.provide('tasks', new TaskService(store.db))
    },
  })
}

export function taskToolsPlugin(): Plugin {
  return definePlugin({
    name: '@jaryn/tasks/tools',
    inject: ['tasks', 'tools'],
    apply(ctx) {
      const tasks = ctx.get<TaskService>('tasks')!
      const tools = ctx.get<{ register(t: Tool): () => void }>('tools')!
      const list: Tool[] = [
        {
          name: 'task.create',
          description: 'Create a shared task on the session task board.',
          risk: 'write',
          schema: { type: 'object', properties: { title: { type: 'string' }, body: { type: 'string' } }, required: ['title'] },
          async execute(args, runCtx) {
            return tasks.create({ sessionId: runCtx.sessionId, title: String(args.title ?? ''), body: args.body ? String(args.body) : '' })
          },
        },
        {
          name: 'task.list',
          description: 'List tasks on the board.',
          risk: 'read',
          schema: { type: 'object', properties: {} },
          async execute() {
            return tasks.list()
          },
        },
        {
          name: 'task.claim',
          description: 'Claim a task (compare-and-set).',
          risk: 'write',
          schema: { type: 'object', properties: { id: { type: 'string' }, bot: { type: 'string' } }, required: ['id'] },
          async execute(args) {
            return tasks.claim(String(args.id), String(args.bot ?? 'default'))
          },
        },
        {
          name: 'task.complete',
          description: 'Mark a claimed task done.',
          risk: 'write',
          schema: { type: 'object', properties: { id: { type: 'string' }, bot: { type: 'string' } }, required: ['id'] },
          async execute(args) {
            return tasks.complete(String(args.id), String(args.bot ?? 'default'))
          },
        },
      ]
      for (const tool of list) ctx.effect(() => tools.register(tool))
    },
  })
}
