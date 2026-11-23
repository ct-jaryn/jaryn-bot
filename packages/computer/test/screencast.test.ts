import { test } from 'node:test'
import assert from 'node:assert/strict'
import { existsSync, mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { ComputerService } from '../src/index.ts'

const CHROME = process.env.CHROME_PATH ?? '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'
const available = existsSync(CHROME)

test('screencast streams frames from real Chrome', { skip: !available, timeout: 30_000 }, async () => {
  const service = new ComputerService({ dataDir: mkdtempSync(join(tmpdir(), 'jary-cast-')), chromePath: CHROME })
  try {
    const client = await service.client('bot-cast')
    await client.navigate('data:text/html,<h1 style="font-size:80px">cast</h1>')
    const frames: string[] = []
    const stop = await service.streamFrames('bot-cast', (frame) => frames.push(frame.image), { quality: 50 })
    for (let i = 0; i < 120 && frames.length < 2; i++) {
      // Force paints so the compositor emits screencast frames even when idle.
      await client.evaluate(`document.body.style.opacity = ${i % 2 === 0 ? '0.999' : '1'}`).catch(() => undefined)
      await new Promise((r) => setTimeout(r, 50))
    }
    stop()
    assert.ok(frames.length >= 1, 'expected at least one screencast frame')
    assert.ok(frames[0]!.length > 100)
  } finally {
    await service.shutdown()
  }
})
