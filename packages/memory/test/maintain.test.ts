import { test } from 'node:test'
import assert from 'node:assert/strict'
import { DatabaseSync } from 'node:sqlite'
import { MemoryStore } from '../src/store.ts'

const memoryWith = (limits: any) => new MemoryStore(new DatabaseSync(':memory:'), limits)

function ageRow(store: MemoryStore, id: string, days: number) {
  const at = Date.now() - days * 86_400_000
  store.db.prepare('UPDATE memories SET created_at = ?, last_used_at = NULL, use_count = 0 WHERE id = ?').run(at, id)
}

test('episode TTL deletes stale episodes only', () => {
  const store = memoryWith({ episodeTtlDays: 30 })
  const oldEpisode = store.remember({ ns: 'g', text: 'old episode', kind: 'episode' })
  const newEpisode = store.remember({ ns: 'g', text: 'new episode', kind: 'episode' })
  const fact = store.remember({ ns: 'g', text: 'durable fact', kind: 'fact' })
  ageRow(store, oldEpisode.id, 40)
  ageRow(store, fact.id, 400)
  const result = store.maintain()
  assert.equal(result.expired, 1)
  assert.equal(store.get(oldEpisode.id), undefined)
  assert.ok(store.get(newEpisode.id))
  assert.ok(store.get(fact.id), 'facts are not subject to episode TTL')
})

test('capacity limit evicts lowest-value unpinned memories', () => {
  const store = memoryWith({ maxEntries: 10, episodeTtlDays: 0, decayDays: 0 })
  const pinned = store.remember({ ns: 'g', text: 'pinned rule', kind: 'rule', pinned: true })
  for (let i = 0; i < 20; i++) store.remember({ ns: 'g', text: `fact ${i}`, kind: 'fact' })
  const result = store.maintain()
  assert.ok(result.evicted > 0)
  assert.ok(store.get(pinned.id), 'pinned memories survive eviction')
  assert.ok(store.stats('g').total <= 10)
})

test('decay archives old unused memories', () => {
  const store = memoryWith({ maxEntries: 1000, episodeTtlDays: 0, decayDays: 30 })
  const stale = store.remember({ ns: 'g', text: 'stale fact', kind: 'fact', confidence: 0.5 })
  const fresh = store.remember({ ns: 'g', text: 'fresh fact', kind: 'fact' })
  ageRow(store, stale.id, 365)
  const result = store.maintain()
  assert.ok(result.archived >= 1)
  assert.ok(store.get(fresh.id))
})
