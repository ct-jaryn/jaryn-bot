import { test } from 'node:test'
import assert from 'node:assert/strict'
import { DatabaseSync } from 'node:sqlite'
import { DeviceService } from '../src/index.ts'

test('pair code is one-time and token verifies, revoke invalidates', () => {
  const service = new DeviceService(new DatabaseSync(':memory:'))
  const { code } = service.createPairCode()
  const { deviceId, token } = service.pair(code, 'phone')
  assert.equal(service.verify(token)?.id, deviceId)
  assert.throws(() => service.pair(code, 'again'), /already used/)
  assert.equal(service.list().length, 1)
  assert.equal(service.revoke(deviceId), true)
  assert.equal(service.verify(token), undefined)
})

test('expired pair code is rejected', () => {
  const service = new DeviceService(new DatabaseSync(':memory:'))
  const { code } = service.createPairCode(-1)
  assert.throws(() => service.pair(code, 'late'), /expired/)
})
