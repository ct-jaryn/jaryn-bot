import { test } from 'node:test'
import assert from 'node:assert/strict'
import { Store } from '../src/index.ts'

test('append and replay events', () => {
  const store = new Store(':memory:')
  store.createSession('s1', 'bot', '/tmp')
  store.append({ sessionId: 's1', type: 'input.owner', actorKind: 'owner', provenance: 'owner', data: { text: 'hi' } })
  store.append({ sessionId: 's1', type: 'turn.started', data: { turnId: 't1' } })
  const events = store.replay('s1')
  assert.equal(events.length, 2)
  assert.equal(events[0]!.type, 'input.owner')
  assert.deepEqual(events[0]!.data, { text: 'hi' })
})

test('events survive close and reopen', () => {
  const file = `/tmp/jaryn-store-${Date.now()}.db`
  const a = new Store(file)
  a.createSession('s2', 'bot', '/tmp')
  a.append({ sessionId: 's2', type: 'turn.started', data: {} })
  a.close()
  const b = new Store(file)
  assert.equal(b.replay('s2').length, 1)
  b.close()
})
