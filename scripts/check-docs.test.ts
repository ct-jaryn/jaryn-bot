import { test } from 'node:test'
import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { join } from 'node:path'

test('docs are structurally consistent', () => {
  const root = join(import.meta.dirname, '..')
  const res = spawnSync(process.execPath, [join(root, 'scripts/check-docs.ts')], { encoding: 'utf8' })
  assert.equal(res.status, 0, res.stdout + res.stderr)
  assert.match(res.stdout, /docs check ok/)
})
