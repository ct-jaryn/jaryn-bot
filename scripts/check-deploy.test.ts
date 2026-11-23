import { test } from 'node:test'
import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { join } from 'node:path'

test('deploy files reference existing packages', () => {
  const root = join(import.meta.dirname, '..')
  const res = spawnSync(process.execPath, [join(root, 'scripts/check-deploy.ts')], { encoding: 'utf8' })
  assert.equal(res.status, 0, res.stdout + res.stderr)
})
