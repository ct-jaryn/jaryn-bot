import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { ComputerService, type ComputerBackend, type ComputerInstance } from '../src/index.ts'

class FakeBackend implements ComputerBackend {
  readonly kind = 'fake'
  stopped: string[] = []
  async start(botId: string): Promise<ComputerInstance> {
    const dir = mkdtempSync(join(tmpdir(), 'jary-idle-'))
    return { botId, baseUrl: 'http://127.0.0.1:1', workspace: dir, profile: dir, startedAt: Date.now() }
  }
  async stop(instance: ComputerInstance) { this.stopped.push(instance.botId) }
}

test('idle timeout stops the computer', async () => {
  const backend = new FakeBackend()
  const service = new ComputerService({ dataDir: mkdtempSync(join(tmpdir(), 'jary-idle-data-')), idleMs: 50 }, backend)
  await service.start('bot-a')
  assert.equal(service.status('bot-a').state, 'running')
  await new Promise((r) => setTimeout(r, 250))
  assert.equal(service.status('bot-a').state, 'stopped')
  assert.deepEqual(backend.stopped, ['bot-a'])
})

test('touch extends the idle window', async () => {
  const backend = new FakeBackend()
  const service = new ComputerService({ dataDir: mkdtempSync(join(tmpdir(), 'jary-idle-data-')), idleMs: 400 }, backend)
  await service.start('bot-b')
  for (let i = 0; i < 4; i++) { await new Promise((r) => setTimeout(r, 120)); service.touch('bot-b') }
  assert.equal(service.status('bot-b').state, 'running')
  await service.stop('bot-b')
})
