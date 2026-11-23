import { test } from 'node:test'
import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { existsSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { Context, applyPatch, composeProfile, loadComposition } from '@jaryn/kernel'
import { agentPlugin, toolRegistryPlugin } from '@jaryn/agent-core'
import { storePlugin } from '@jaryn/store-sqlite'
import { shellPlugin } from '@jaryn/tools-shell'
import { echoProviderPlugin } from '@jaryn/testing'
import { fsPlugin } from '@jaryn/tools-fs'
import { memoryPlugin, memoryToolsPlugin } from '@jaryn/memory'
import { botsPlugin, botToolsPlugin } from '@jaryn/bots'
import { tasksPlugin, taskToolsPlugin } from '@jaryn/tasks'
import { schedulerPlugin } from '@jaryn/scheduler'
import { computerPlugin, computerToolsPlugin } from '@jaryn/computer'

const ROOT = resolve(import.meta.dirname, '../../..')
const CLI = join(ROOT, 'packages/cli/src/index.ts')
const BASE = join(ROOT, 'packages/bundles/base/patch.json')

test('config print works', () => {
  const home = mkdtempSync(join(tmpdir(), 'jary-'))
  const res = spawnSync(process.execPath, [CLI, 'config', 'print', '--home', home], { encoding: 'utf8' })
  assert.equal(res.status, 0, res.stderr)
  assert.match(res.stdout, /agent: @jaryn\/agent-core/)
  assert.match(res.stdout, /shell: @jaryn\/tools-shell/)
})

test('disabled shell is not mounted', async () => {
  const patch = join(mkdtempSync(join(tmpdir(), 'jary-')), 'disable.json')
  writeFileSync(patch, JSON.stringify([{ id: 'shell', disabled: true }]))
  const rows = applyPatch(
    composeProfile({ name: 'test', bundles: [{ name: 'base', patch: JSON.parse(readFileSync(BASE, 'utf8')) }] }),
    JSON.parse(readFileSync(patch, 'utf8')),
  )
  const ctx = new Context({ scope: 'root' })
  const registry = new Map([
    ['@jaryn/store-sqlite', storePlugin()],
    ['@jaryn/testing/echo', echoProviderPlugin()],
    ['@jaryn/agent-core/tools', toolRegistryPlugin()],
    ['@jaryn/tools-shell', shellPlugin()],
    ['@jaryn/tools-fs', fsPlugin()],
    ['@jaryn/memory', memoryPlugin()],
    ['@jaryn/memory/tools', memoryToolsPlugin()],
    ['@jaryn/bots', botsPlugin()],
    ['@jaryn/bots/tools', botToolsPlugin()],
    ['@jaryn/tasks', tasksPlugin()],
    ['@jaryn/tasks/tools', taskToolsPlugin()],
    ['@jaryn/scheduler', schedulerPlugin()],
    ['@jaryn/computer', computerPlugin()],
    ['@jaryn/computer/tools', computerToolsPlugin()],
    ['@jaryn/agent-core', agentPlugin()],
  ])
  const result = await loadComposition(ctx, rows, registry)
  assert.ok(!result.loaded.includes('shell'))
  assert.ok(!ctx.get<any>('tools').list().some((t: any) => t.name === 'shell.run'))
  await ctx.dispose()
})

test('chat then session replay works', () => {
  const home = mkdtempSync(join(tmpdir(), 'jary-'))
  const cwd = mkdtempSync(join(tmpdir(), 'jary-w-'))
  const chat = spawnSync(process.execPath, [CLI, 'chat', '--home', home, 'hello'], { cwd, encoding: 'utf8' })
  assert.equal(chat.status, 0, chat.stderr)
  assert.match(chat.stdout, /echo: hello/)
  const list = spawnSync(process.execPath, [CLI, 'session', 'list', '--home', home], { cwd, encoding: 'utf8' })
  assert.equal(list.status, 0, list.stderr)
  assert.match(list.stdout, /cli\tdefault\tidle/)
  const replay = spawnSync(process.execPath, [CLI, 'session', 'replay', 'cli', '--home', home], { cwd, encoding: 'utf8' })
  assert.equal(replay.status, 0, replay.stderr)
  assert.match(replay.stdout, /input\.owner/)
  assert.match(replay.stdout, /turn\.ended/)
})

test('plugin disable persists into config print', () => {
  const home = mkdtempSync(join(tmpdir(), 'jary-'))
  const disable = spawnSync(process.execPath, [CLI, 'plugin', 'disable', 'shell', '--home', home], { encoding: 'utf8' })
  assert.equal(disable.status, 0, disable.stderr)
  const print = spawnSync(process.execPath, [CLI, 'config', 'print', '--home', home], { encoding: 'utf8' })
  assert.match(print.stdout, /shell: @jaryn\/tools-shell \(disabled\)/)
  const doctor = spawnSync(process.execPath, [CLI, 'plugin', 'doctor', '--home', home], { encoding: 'utf8' })
  assert.equal(doctor.status, 0, doctor.stdout + doctor.stderr)
})

test('backup and restore roundtrip', () => {
  const home = mkdtempSync(join(tmpdir(), 'jary-'))
  const cwd = mkdtempSync(join(tmpdir(), 'jary-w-'))
  spawnSync(process.execPath, [CLI, 'chat', '--home', home, 'hello'], { cwd, encoding: 'utf8' })
  const out = mkdtempSync(join(tmpdir(), 'jary-bak-'))
  const backup = spawnSync(process.execPath, [CLI, 'backup', '--home', home, '--out', out], { encoding: 'utf8' })
  assert.equal(backup.status, 0, backup.stderr)
  assert.ok(existsSync(join(out, 'jary.db')))
  const home2 = mkdtempSync(join(tmpdir(), 'jary-'))
  const restore = spawnSync(process.execPath, [CLI, 'restore', '--home', home2, '--from', out, '--yes'], { encoding: 'utf8' })
  assert.equal(restore.status, 0, restore.stderr)
  const list = spawnSync(process.execPath, [CLI, 'session', 'list', '--home', home2], { cwd, encoding: 'utf8' })
  assert.match(list.stdout, /cli\tdefault/)
})

test('doctor exits 0', () => {
  const home = mkdtempSync(join(tmpdir(), 'jary-'))
  const res = spawnSync(process.execPath, [CLI, 'doctor', '--home', home], { encoding: 'utf8' })
  assert.equal(res.status, 0, res.stdout + res.stderr)
})
