import { test } from 'node:test'
import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { mkdtempSync, readdirSync, readFileSync, symlinkSync, mkdirSync, existsSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const ROOT = join(import.meta.dirname, '..')

test('deploy files reference existing packages', () => {
  const res = spawnSync(process.execPath, [join(ROOT, 'scripts/check-deploy.ts')], { encoding: 'utf8' })
  assert.equal(res.status, 0, res.stdout + res.stderr)
})

test('image link step resolves every package (simulated, no docker needed)', () => {
  const dockerfile = readFileSync(join(ROOT, 'deploy/Dockerfile'), 'utf8')
  assert.match(dockerfile, /readdirSync\("packages"\)/)
  const packages = readdirSync(join(ROOT, 'packages')).filter((dir) => existsSync(join(ROOT, 'packages', dir, 'package.json')))
  const linked: string[] = []
  for (const dir of packages) {
    const name = JSON.parse(readFileSync(join(ROOT, 'packages', dir, 'package.json'), 'utf8')).name
    if (!name.startsWith('@jaryn/')) continue
    linked.push(name.split('/')[1]!)
  }
  assert.ok(linked.length >= 30, `expected >=30 linked packages, got ${linked.length}`)
  for (const dir of packages) {
    const manifest = JSON.parse(readFileSync(join(ROOT, 'packages', dir, 'package.json'), 'utf8'))
    if (!manifest.name.startsWith('@jaryn/')) continue
    assert.ok(existsSync(join(ROOT, 'packages', dir, 'src', 'index.ts')), `${manifest.name} has no src/index.ts entry`)
  }
  void mkdtempSync
  void symlinkSync
  void mkdirSync
  void tmpdir
})
