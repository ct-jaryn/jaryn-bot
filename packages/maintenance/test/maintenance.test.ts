import { test } from 'node:test'
import assert from 'node:assert/strict'
import { Context } from '@jaryn/kernel'
import { Store } from '@jaryn/store-sqlite'
import { MaintenanceService, maintenancePlugin } from '../src/index.ts'

test('archives idle sessions', () => {
  const store = new Store(':memory:')
  store.createSession('old', 'default', '/tmp')
  store.createSession('fresh', 'default', '/tmp')
  store.db.prepare('UPDATE sessions SET updated_at = ? WHERE id = ?').run(Date.now() - 40 * 86_400_000, 'old')
  const service = new MaintenanceService(store.db, { archiveSessionsAfterDays: 30 })
  const result = service.run()
  assert.equal(result.archivedSessions, 1)
  assert.equal(store.getSession('old')!.archived, true)
  assert.equal(store.getSession('fresh')!.archived, false)
})

test('maintenance plugin runs on interval and exposes service', async () => {
  const ctx = new Context({ scope: 'root' })
  const store = new Store(':memory:')
  ctx.provide('store', store)
  await ctx.mount(maintenancePlugin({ everyMs: 60_000 }))
  const service = ctx.get<MaintenanceService>('maintenance')
  assert.equal(service.run().archivedSessions, 0)
  await ctx.dispose()
})
