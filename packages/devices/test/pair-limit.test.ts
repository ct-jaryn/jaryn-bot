import { test } from 'node:test'
import assert from 'node:assert/strict'
import { DatabaseSync } from 'node:sqlite'
import { DeviceService } from '../src/index.ts'

test('repeated wrong guesses are throttled', () => {
  const service = new DeviceService(new DatabaseSync(':memory:'), { maxAttemptsPerWindow: 3, windowMs: 60_000 })
  service.createPairCode()
  for (let i = 0; i < 3; i++) assert.throws(() => service.pair('000000', 'x'), /invalid pair code/)
  assert.throws(() => service.pair('000000', 'x'), /too many failed pair attempts/)
})

test('correct code still works within window', () => {
  const service = new DeviceService(new DatabaseSync(':memory:'), { maxAttemptsPerWindow: 5, windowMs: 60_000 })
  const { code } = service.createPairCode()
  assert.throws(() => service.pair('999999', 'x'), /invalid pair code/)
  const paired = service.pair(code, 'phone')
  assert.match(paired.token, /^[0-9a-f]{64}$/)
  assert.equal(service.list().length, 1)
})
