import { definePlugin } from '@jaryn/kernel'
import type { Plugin } from '@jaryn/kernel'

export interface Notification {
  id: number
  ts: number
  kind: string
  title: string
  body: string
  sessionId?: string
  read: boolean
  suppressed: boolean
}

export interface NotifyInput {
  kind: string
  title: string
  body?: string
  sessionId?: string
}

export interface QuietHours {
  start: string // "22:00"
  end: string // "08:00"
  tz?: string
}

const SCHEMA = `
CREATE TABLE IF NOT EXISTS notifications (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  ts INTEGER NOT NULL,
  kind TEXT NOT NULL,
  title TEXT NOT NULL,
  body TEXT NOT NULL DEFAULT '',
  session_id TEXT,
  read INTEGER NOT NULL DEFAULT 0,
  suppressed INTEGER NOT NULL DEFAULT 0
);
`

function minutesOf(hhmm: string): number {
  const [h, m] = hhmm.split(':').map(Number)
  return (h ?? 0) * 60 + (m ?? 0)
}

export function inQuietHours(quiet: QuietHours | undefined, now = new Date()): boolean {
  if (!quiet) return false
  const tz = quiet.tz ?? 'UTC'
  const parts = new Intl.DateTimeFormat('en-GB', { timeZone: tz, hour: '2-digit', minute: '2-digit', hour12: false }).format(now)
  const [h, m] = parts.split(':').map(Number)
  const current = (h ?? 0) * 60 + (m ?? 0)
  const start = minutesOf(quiet.start)
  const end = minutesOf(quiet.end)
  if (start === end) return false
  return start < end ? current >= start && current < end : current >= start || current < end
}

export class NotificationService {
  private db: any
  quiet?: QuietHours
  constructor(db: any, cfg: { quietHours?: QuietHours } = {}) {
    this.db = db
    this.db.exec(SCHEMA)
    this.quiet = cfg.quietHours
  }

  notify(input: NotifyInput): Notification {
    const suppressed = inQuietHours(this.quiet)
    const result = this.db.prepare(
      'INSERT INTO notifications(ts, kind, title, body, session_id, read, suppressed) VALUES (?, ?, ?, ?, ?, 0, ?)',
    ).run(Date.now(), input.kind, input.title.slice(0, 200), (input.body ?? '').slice(0, 2000), input.sessionId ?? null, suppressed ? 1 : 0)
    return this.get(Number(result.lastInsertRowid))!
  }

  get(id: number): Notification | undefined {
    const row = this.db.prepare('SELECT * FROM notifications WHERE id = ?').get(id) as any
    return row ? toNotification(row) : undefined
  }

  list(opts: { limit?: number; unreadOnly?: boolean } = {}): Notification[] {
    const limit = Math.min(opts.limit ?? 50, 200)
    const rows = opts.unreadOnly
      ? this.db.prepare('SELECT * FROM notifications WHERE read = 0 ORDER BY id DESC LIMIT ?').all(limit)
      : this.db.prepare('SELECT * FROM notifications ORDER BY id DESC LIMIT ?').all(limit)
    return (rows as any[]).map(toNotification)
  }

  unreadCount(): number {
    return (this.db.prepare('SELECT COUNT(*) AS c FROM notifications WHERE read = 0').get() as any).c
  }

  markRead(id: number): boolean {
    return this.db.prepare('UPDATE notifications SET read = 1 WHERE id = ?').run(id).changes > 0
  }

  markAllRead(): number {
    return this.db.prepare('UPDATE notifications SET read = 1 WHERE read = 0').run().changes
  }
}

function toNotification(row: any): Notification {
  return {
    id: row.id, ts: row.ts, kind: row.kind, title: row.title, body: row.body,
    sessionId: row.session_id ?? undefined, read: !!row.read, suppressed: !!row.suppressed,
  }
}

export function notificationsPlugin(cfg: { quietHours?: QuietHours } = {}): Plugin<{ quietHours?: QuietHours }> {
  return definePlugin({
    name: '@jaryn/notifications',
    provides: ['notifications'],
    inject: ['store'],
    apply(ctx, config = {}) {
      const store = ctx.get<any>('store')
      const service = new NotificationService(store.db, { quietHours: config.quietHours ?? cfg.quietHours })
      ctx.provide('notifications', service)
      ctx.on('job/finished', (payload: any) => {
        service.notify({ kind: 'job', title: `例程 ${payload.jobId} ${payload.status}`, body: payload.summary ?? '', sessionId: payload.sessionId })
      })
      ctx.on('initiative/proposal', (payload: any) => {
        service.notify({ kind: 'initiative', title: payload.title, body: payload.reason ?? '' })
      })
      ctx.on('email/received', (payload: any) => {
        service.notify({ kind: 'email', title: `新邮件：${payload.subject}`, body: String(payload.from ?? '') })
      })
    },
  })
}
