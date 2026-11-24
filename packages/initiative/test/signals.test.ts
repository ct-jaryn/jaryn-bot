import { test } from 'node:test'
import assert from 'node:assert/strict'
import { DatabaseSync } from 'node:sqlite'
import { InitiativeService } from '../src/index.ts'

function service() {
  return new InitiativeService(new DatabaseSync(':memory:'), { threshold: 0, dailyLimit: 20, ttlMs: 86_400_000 })
}

test('calendar signals only surface events within 45 minutes', () => {
  const svc = service()
  const soon = new Date(Date.now() + 20 * 60_000).toISOString()
  const later = new Date(Date.now() + 3 * 3600_000).toISOString()
  svc.calendarEvents = [{ title: '站会', startsAt: soon }, { title: '晚点', startsAt: later }]
  const created = svc.scan()
  assert.equal(created.length, 1)
  assert.match(created[0]!.title, /站会/)
  assert.equal(created[0]!.kind, 'calendar-soon')
})

test('connector failures and unread mail produce proposals', () => {
  const svc = service()
  svc.connectorFailures = [{ id: 'gmail', message: 'HTTP 401', at: Date.now() }]
  svc.unreadMail = [{ uid: '1', from: 'a@b.c', subject: '报价单', receivedAt: Date.now() - 2 * 86_400_000 }]
  const created = svc.scan()
  const kinds = created.map((p) => p.kind).sort()
  assert.deepEqual(kinds, ['connector-failure', 'email-unread'])
})

test('dedupe prevents duplicate proposals for the same signal', () => {
  const svc = service()
  svc.connectorFailures = [{ id: 'gmail', message: 'HTTP 401', at: Date.now() }]
  svc.scan()
  const second = svc.scan()
  assert.equal(second.length, 0)
})
