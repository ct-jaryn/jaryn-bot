import { test } from 'node:test'
import assert from 'node:assert/strict'
import { DatabaseSync } from 'node:sqlite'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { decrypt, encrypt } from '../src/crypto.ts'
import { VaultService } from '../src/store.ts'

const newVault = () => new VaultService(new DatabaseSync(':memory:'), { keyPath: join(mkdtempSync(join(tmpdir(), 'jary-vault-')), 'vault.key') })

test('crypto roundtrip and tamper detection', () => {
  const key = Buffer.alloc(32, 7)
  const blob = encrypt({ password: 's3cret' }, key)
  assert.deepEqual(decrypt(blob, key), { password: 's3cret' })
  const tampered = Buffer.from(blob, 'base64'); tampered[tampered.length - 1] ^= 1
  assert.throws(() => decrypt(tampered.toString('base64'), key))
})

test('list never exposes secrets; fill injects without returning them', async () => {
  const vault = newVault()
  const item = vault.add({ name: 'GitHub', origin: 'https://github.com', username: 'me', secret: { username: 'me', password: 'pw123' } })
  const list = vault.list()
  assert.equal(list.length, 1)
  assert.equal(JSON.stringify(list).includes('pw123'), false)

  const expressions: string[] = []
  const client = { evaluate: async <T,>(expr: string) => { expressions.push(expr); return true as T } }
  const result = await vault.fill(item.id, { client, botId: 'bot-a', origin: 'https://github.com/login' })
  assert.equal(result.ok, true)
  assert.deepEqual(result.filled, ['username', 'password'])
  assert.equal(JSON.stringify(result).includes('pw123'), false)
  assert.ok(expressions.some((e) => e.includes('pw123')))
  assert.equal(vault.events()[0].action, 'fill')
})

test('origin mismatch is denied', async () => {
  const vault = newVault()
  const item = vault.add({ name: 'GitHub', origin: 'https://github.com', username: 'me', secret: { password: 'pw' } })
  await assert.rejects(() => vault.fill(item.id, { client: { evaluate: async () => true }, origin: 'https://evil.com' }), /origin mismatch/)
})

test('secure form is one-time', () => {
  const vault = newVault()
  const token = vault.createSecureForm({ origin: 'https://example.com', purpose: '登录' })
  const item = vault.consumeSecureForm(token, { username: 'me', secret: { password: 'pw' } })
  assert.equal(item.origin, 'https://example.com')
  assert.throws(() => vault.consumeSecureForm(token, { secret: { password: 'x' } }), /already used/)
})
