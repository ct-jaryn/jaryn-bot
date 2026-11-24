import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { ComputerService, type ComputerBackend, type ComputerInstance } from '../src/index.ts'

class FakeBackend implements ComputerBackend {
  readonly kind = 'fake'
  starts = 0
  async start(botId: string): Promise<ComputerInstance> {
    this.starts++
    const dir = mkdtempSync(join(tmpdir(), 'jary-lim-'))
    return { botId, baseUrl: 'http://127.0.0.1:1', workspace: dir, profile: dir, startedAt: Date.now() }
  }
  async stop() {}
}

test('session length limit throws and restart clears it', async () => {
  const backend = new FakeBackend()
  const service = new ComputerService({ dataDir: mkdtempSync(join(tmpdir(), 'jary-lim-data-')), maxSessionMs: 30 }, backend)
  await service.start('b')
  await new Promise((r) => setTimeout(r, 60))
  assert.throws(() => service.enforceLimits('b'), /exceeded/)
  await service.restart('b')
  assert.doesNotThrow(() => service.enforceLimits('b'))
  assert.equal(backend.starts, 2)
  await service.stop('b')
})

test('daily budget accumulates across sessions', async () => {
  const backend = new FakeBackend()
  const service = new ComputerService({ dataDir: mkdtempSync(join(tmpdir(), 'jary-lim-data-')), maxDailyMs: 50 }, backend)
  await service.start('b')
  await new Promise((r) => setTimeout(r, 80))
  await service.stop('b')
  await service.start('b')
  assert.throws(() => service.enforceLimits('b'), /daily budget/)
  const usage = service.usageFor('b')
  assert.ok(usage.ms >= 50)
  assert.ok(usage.sessionMs >= 0)
})

test('domain allowlist blocks other hosts', () => {
  const service = new ComputerService({ dataDir: mkdtempSync(join(tmpdir(), 'jary-lim-data-')), allowedDomains: ['example.com', '*.trusted.dev'] }, new FakeBackend())
  assert.doesNotThrow(() => service.assertAllowedUrl('https://example.com/a'))
  assert.doesNotThrow(() => service.assertAllowedUrl('https://api.trusted.dev/x'))
  assert.throws(() => service.assertAllowedUrl('https://evil.com'), /domain not allowed/)
  assert.throws(() => service.assertAllowedUrl('not-a-url'), /invalid URL/)
})

test('empty allowlist allows any domain', () => {
  const service = new ComputerService({ dataDir: mkdtempSync(join(tmpdir(), 'jary-lim-data-')) }, new FakeBackend())
  assert.doesNotThrow(() => service.assertAllowedUrl('https://anything.test/x'))
})
