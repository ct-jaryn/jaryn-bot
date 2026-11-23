import { test } from 'node:test'
import assert from 'node:assert/strict'
import { OnePasswordService, totp } from '../src/index.ts'

test('totp matches RFC 6238 test vector (SHA1, 8 digits)', () => {
  // RFC 6238 appendix B: secret "12345678901234567890" at T=59 => 94287082
  const secret = 'GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ'
  assert.equal(totp(secret, 59_000, 8), '94287082')
})

test('unknown reference is rejected without spawning', () => {
  const service = new OnePasswordService({ references: {} })
  assert.throws(() => service.read('nope'), /unknown 1Password reference/)
})

test('fill injects values into the page', async () => {
  const expressions: string[] = []
  const service = new OnePasswordService({ references: { pw: 'op://x/pw', user: 'op://x/user' } })
  const read = service.read.bind(service)
  service.read = (name: string) => (name === 'pw' ? 'secret-pw' : 'alice')
  await service.fill('user|pw', { evaluate: async <T,>(expr: string) => { expressions.push(expr); return true as T } })
  assert.ok(expressions.some((e) => e.includes('secret-pw')))
  assert.ok(expressions.some((e) => e.includes('alice')))
  void read
})
