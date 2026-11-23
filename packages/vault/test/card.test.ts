import { test } from 'node:test'
import assert from 'node:assert/strict'
import { fillCard } from '@jaryn/secrets'

const page = () => {
  const expressions: string[] = []
  return {
    expressions,
    client: { evaluate: async <T,>(expr: string) => { expressions.push(expr); return true as T } },
  }
}

test('card filling is disabled unless explicitly enabled', async () => {
  const { client } = page()
  await assert.rejects(() => fillCard({ number: '4242' }, client), /disabled/)
})

test('card filling writes fields and never returns values', async () => {
  const { client, expressions } = page()
  const result = await fillCard({ number: '4242 4242 4242 4242', expiry: '12/30', cvc: '123', holder: 'ALICE' }, client, { enabled: true })
  assert.equal(result.ok, true)
  assert.deepEqual(result.fields.sort(), ['cvc', 'expiry', 'holder', 'number'])
  assert.equal(JSON.stringify(result).includes('4242'), false)
  assert.ok(expressions.some((e) => e.includes('4242')))
})
