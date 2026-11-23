import { test } from 'node:test'
import assert from 'node:assert/strict'
import { GrantStore } from '../src/rules.ts'

test('always grants survive via persistence and pre-approve', () => {
  const saved: { sessionId: string; tool: string }[] = []
  const store = new GrantStore()
  store.attachPersistence({
    load: () => saved,
    save: (g) => { saved.push(g) },
    remove: () => {},
  })
  store.grantAlways('shell.run', 's1')
  assert.equal(store.consume('s2', 'shell.run'), true)
  const restored = new GrantStore()
  restored.attachPersistence({ load: () => saved, save: () => {}, remove: () => {} })
  assert.equal(restored.consume('s9', 'shell.run'), true)
  assert.equal(restored.consume('s9', 'other.tool'), false)
})
