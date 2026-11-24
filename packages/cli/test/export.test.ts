import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Store } from '@jaryn/store-sqlite'
import { main } from '../src/index.ts'

function home() {
  const dir = mkdtempSync(join(tmpdir(), 'jary-export-'))
  writeFileSync(join(dir, 'profile.json'), JSON.stringify({ name: 'default', bundles: [], patches: [] }))
  return dir
}

test('session export writes redacted jsonl by default', async () => {
  const dir = home()
  const store = new Store(join(dir, 'data', 'jary.db'))
  store.createSession('s1', 'default', '/tmp')
  store.append({
    sessionId: 's1', type: 'tool.call', actorKind: 'system',
    data: { name: 'vault.fill', args: { password: 'super-secret', token: 'abc123', path: '/tmp/x' } },
  })
  store.close()

  const out = join(dir, 'export.jsonl')
  const code = await main(['session', 'export', 's1', '--home', dir, '--out', out])
  assert.equal(code, 0)
  const text = readFileSync(out, 'utf8')
  assert.doesNotMatch(text, /super-secret/)
  assert.doesNotMatch(text, /abc123/)
  assert.match(text, /\[redacted\]/)
  assert.match(text, /\/tmp\/x/)
})
