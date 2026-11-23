import { test } from 'node:test'
import assert from 'node:assert/strict'
import { DatabaseSync } from 'node:sqlite'
import { NotificationService, inQuietHours } from '../src/index.ts'

const newService = (cfg: any = {}) => new NotificationService(new DatabaseSync(':memory:'), cfg)

test('notify, list, unread count and mark read', () => {
  const service = newService()
  const a = service.notify({ kind: 'job', title: '例程完成', body: '摘要' })
  service.notify({ kind: 'email', title: '新邮件' })
  assert.equal(service.list().length, 2)
  assert.equal(service.unreadCount(), 2)
  assert.equal(service.markRead(a.id), true)
  assert.equal(service.unreadCount(), 1)
  assert.equal(service.markAllRead(), 1)
  assert.equal(service.list({ unreadOnly: true }).length, 0)
})

test('quiet hours detection handles overnight windows', () => {
  const quiet = { start: '22:00', end: '08:00', tz: 'UTC' }
  assert.equal(inQuietHours(quiet, new Date('2026-01-01T23:30:00Z')), true)
  assert.equal(inQuietHours(quiet, new Date('2026-01-01T07:59:00Z')), true)
  assert.equal(inQuietHours(quiet, new Date('2026-01-01T08:00:00Z')), false)
  assert.equal(inQuietHours(quiet, new Date('2026-01-01T12:00:00Z')), false)
  assert.equal(inQuietHours(undefined), false)
})

test('quiet hours mark notifications suppressed but still stored', () => {
  const service = newService({ quietHours: { start: '00:00', end: '23:59', tz: 'UTC' } })
  const note = service.notify({ kind: 'job', title: '夜间任务' })
  assert.equal(note.suppressed, true)
  assert.equal(service.list().length, 1)
})
