import { definePlugin } from '@jaryn/kernel'
import type { Plugin } from '@jaryn/kernel'

export interface MaintenanceConfig {
  /** Archive sessions untouched for N days (0 disables). */
  archiveSessionsAfterDays?: number
  /** Run interval in ms (default 6h). */
  everyMs?: number
  /** Optional memory store to maintain. */
  maintainMemory?: boolean
}

export interface MaintenanceResult {
  archivedSessions: number
  archivedGoals: number
  ranAt: number
}

/** Periodic housekeeping: archive idle sessions, expire stale goals. */
export class MaintenanceService {
  private db: any
  private cfg: Required<Pick<MaintenanceConfig, 'archiveSessionsAfterDays'>>
  last?: MaintenanceResult
  constructor(db: any, cfg: MaintenanceConfig = {}) {
    this.db = db
    this.cfg = { archiveSessionsAfterDays: cfg.archiveSessionsAfterDays ?? 30 }
  }

  run(now = Date.now()): MaintenanceResult {
    let archivedSessions = 0
    let archivedGoals = 0
    const days = this.cfg.archiveSessionsAfterDays
    if (days > 0) {
      archivedSessions = this.db.prepare(
        'UPDATE sessions SET archived = 1 WHERE archived = 0 AND updated_at < ?',
      ).run(now - days * 86_400_000).changes
    }
    try {
      archivedGoals = this.db.prepare(
        "UPDATE goals SET status = 'blocked' WHERE status = 'active' AND updated_at < ?",
      ).run(now - 14 * 86_400_000).changes
    } catch { /* goals table optional */ }
    this.last = { archivedSessions, archivedGoals, ranAt: now }
    return this.last
  }
}

export function maintenancePlugin(cfg: MaintenanceConfig = {}): Plugin<MaintenanceConfig> {
  return definePlugin({
    name: '@jaryn/maintenance',
    provides: ['maintenance'],
    inject: ['store'],
    optional: ['memory'],
    apply(ctx, config = {}) {
      const store = ctx.get<any>('store')
      const service = new MaintenanceService(store.db, { ...cfg, ...config })
      ctx.provide('maintenance', service)
      const every = config.everyMs ?? cfg.everyMs ?? 6 * 3600_000
      const timer = setInterval(() => {
        service.run()
        try { ctx.get<any>('memory')?.maintain?.() } catch { /* best effort */ }
      }, Math.max(60_000, every))
      timer.unref?.()
      ctx.effect(() => () => clearInterval(timer))
    },
  })
}
