import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import { VaultService } from '../src/store.ts'

function vault() {
  return new VaultService(new DatabaseSync(':memory:'), {
    keyPath: join(mkdtempSync(join(tmpdir(), 'jary-vault-')), 'key'),
  })
}

const client = () => ({ evaluate: async <T,>(expr: string) => { void expr; return true as T } })

test('item with no grants is usable by any bot (backwards compatible)', async () => {
  const service = vault()
  const item = service.add({ kind: 'login', name: 'GitHub', origin: 'https://github.com', username: 'me', secret: { username: 'me', password: 'pw' } })
  const result = await service.fill(item.id, { client: client(), botId: 'bot-a', origin: 'https://github.com' })
  assert.deepEqual(result.filled.sort(), ['password', 'username'])
})

test('after granting, only the granted bot may fill', async () => {
  const service = vault()
  const item = service.add({ kind: 'login', name: 'Bank', origin: 'https://bank.example', username: 'me', secret: { username: 'me', password: 'pw' } })
  service.grant(item.id, 'bot-trusted')
  await service.fill(item.id, { client: client(), botId: 'bot-trusted', origin: 'https://bank.example' })
  await assert.rejects(
    () => service.fill(item.id, { client: client(), botId: 'bot-other', origin: 'https://bank.example' }),
    /not granted/,
  )
  service.revoke(item.id, 'bot-trusted')
  await assert.rejects(
    () => service.fill(item.id, { client: client(), botId: 'bot-trusted', origin: 'https://bank.example' }),
    /not granted/,
  )
})

test('wildcard grant allows every bot', async () => {
  const service = vault()
  const item = service.add({ kind: 'api_key', name: 'API', secret: { token: 'tok' } })
  service.grant(item.id, '*')
  await service.fill(item.id, { client: client(), botId: 'anything' })
})

test('origin mismatch is rejected even when granted', async () => {
  const service = vault()
  const item = service.add({ kind: 'login', name: 'x', origin: 'https://good.example', secret: { username: 'me', password: 'pw' } })
  await assert.rejects(
    () => service.fill(item.id, { client: client(), origin: 'https://evil.example' }),
    /origin mismatch/,
  )
})
