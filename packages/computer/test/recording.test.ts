import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { ComputerService, type ComputerBackend, type ComputerInstance } from '../src/index.ts'

class FakeBackend implements ComputerBackend {
  readonly kind = 'fake'
  async start(botId: string): Promise<ComputerInstance> {
    const dir = mkdtempSync(join(tmpdir(), 'jary-rec-'))
    return { botId, baseUrl: 'http://127.0.0.1:1', workspace: dir, profile: dir, startedAt: Date.now() }
  }
  async stop() {}
}

test('records and returns action steps', () => {
  const service = new ComputerService({ dataDir: mkdtempSync(join(tmpdir(), 'jary-rec-data-')) }, new FakeBackend())
  assert.equal(service.isRecording('b'), false)
  service.startRecording('b')
  service.record('b', 'goto https://example.com')
  service.record('b', 'click at (10, 20)')
  const rec = service.stopRecording('b')!
  assert.deepEqual(rec.steps, ['goto https://example.com', 'click at (10, 20)'])
  assert.equal(service.isRecording('b'), false)
  assert.equal(service.stopRecording('b'), undefined)
})
