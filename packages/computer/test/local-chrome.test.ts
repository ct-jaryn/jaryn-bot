import { test } from 'node:test'
import assert from 'node:assert/strict'
import { existsSync, mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { ComputerService } from '../src/index.ts'

const CHROME = process.env.CHROME_PATH ?? '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'
const available = existsSync(CHROME) || process.env.CHROME_PATH !== undefined

test('local Chrome: navigate, extract text, screenshot, stop', { skip: !available }, async () => {
  const service = new ComputerService({ dataDir: mkdtempSync(join(tmpdir(), 'jary-lc-')), chromePath: CHROME })
  try {
    const inst = await service.start('bot-live')
    assert.match(inst.baseUrl, /^http:\/\/127\.0\.0\.1:\d+$/)
    const client = await service.client('bot-live')
    await client.navigate('data:text/html,<h1>hello jaryn</h1>')
    const text = await client.text()
    assert.match(text, /hello jaryn/)
    const shot = await client.screenshot()
    assert.ok(shot.length > 100)
  } finally {
    await service.shutdown()
  }
})
