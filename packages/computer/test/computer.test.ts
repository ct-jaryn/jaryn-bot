import { test } from 'node:test'
import assert from 'node:assert/strict'
import { existsSync, mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Context } from '@jaryn/kernel'
import { toolRegistryPlugin } from '@jaryn/agent-core'
import { ComputerService, computerToolsPlugin, type ComputerBackend, type ComputerInstance } from '../src/index.ts'

class FakeBackend implements ComputerBackend {
  readonly kind = 'fake'
  started: string[] = []
  stopped: string[] = []
  async start(botId: string): Promise<ComputerInstance> {
    this.started.push(botId)
    const dir = mkdtempSync(join(tmpdir(), 'jary-comp-'))
    return { botId, baseUrl: 'http://127.0.0.1:1', workspace: join(dir, 'workspace'), profile: join(dir, 'profile'), startedAt: Date.now() }
  }
  async stop(instance: ComputerInstance) { this.stopped.push(instance.botId) }
}

test('lifecycle, snapshot and restore with fake backend', async () => {
  const backend = new FakeBackend()
  const dataDir = mkdtempSync(join(tmpdir(), 'jary-cdata-'))
  const service = new ComputerService({ dataDir }, backend)
  assert.equal(service.status('bot-a').state, 'stopped')
  const inst = await service.start('bot-a')
  assert.equal(service.status('bot-a').state, 'running')
  const { mkdirSync, writeFileSync } = await import('node:fs')
  mkdirSync(inst.workspace, { recursive: true })
  mkdirSync(inst.profile, { recursive: true })
  writeFileSync(join(inst.workspace, 'note.txt'), 'hello')
  const snap = await service.snapshot('bot-a', 's1')
  assert.ok(existsSync(join(snap, 'workspace', 'note.txt')))
  writeFileSync(join(inst.workspace, 'note.txt'), 'changed')
  // restore stops then copies back
  await service.restore('bot-a', snap)
  assert.equal(service.status('bot-a').state, 'stopped')
  assert.equal(backend.stopped.length, 1)
})

test('computer tools are registered', async () => {
  const ctx = new Context({ scope: 'root' })
  await ctx.mount(toolRegistryPlugin())
  const service = new ComputerService({ dataDir: mkdtempSync(join(tmpdir(), 'jary-cdata-')) }, new FakeBackend())
  ctx.provide('computer', service)
  await ctx.mount(computerToolsPlugin())
  const names = ctx.get<any>('tools').list().map((t: any) => t.name)
  assert.ok(names.includes('computer.status'))
  assert.ok(names.includes('browser.goto'))
  const status = await ctx.get<any>('tools').execute('computer.status', { botId: 'bot-a' }, { signal: new AbortController().signal, sessionId: 's', cwd: '/tmp' })
  assert.equal(status.state, 'stopped')
  await ctx.dispose()
})
