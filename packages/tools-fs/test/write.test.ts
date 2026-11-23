import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fsTools } from '../src/index.ts'

const ctxFor = (cwd: string) => ({ signal: new AbortController().signal, sessionId: 's', cwd })
const tool = (name: string) => fsTools().find((t) => t.name === name)!

test('write creates nested files inside workspace', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'jary-fsw-'))
  const result = await tool('fs.write').execute({ path: 'out/report.md', content: '# hi' }, ctxFor(dir))
  assert.deepEqual(result, { path: 'out/report.md', bytes: 4 })
  assert.equal(readFileSync(join(dir, 'out/report.md'), 'utf8'), '# hi')
})

test('write rejects traversal', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'jary-fsw-'))
  await assert.rejects(() => tool('fs.write').execute({ path: '../escape.txt', content: 'x' }, ctxFor(dir)), /escapes workspace/)
})

test('edit replaces unique and requires all for multiple', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'jary-fsw-'))
  await tool('fs.write').execute({ path: 'a.txt', content: 'one X two' }, ctxFor(dir))
  assert.deepEqual(await tool('fs.edit').execute({ path: 'a.txt', old: 'X', new: 'Y' }, ctxFor(dir)), { path: 'a.txt', replaced: 1 })
  assert.equal(readFileSync(join(dir, 'a.txt'), 'utf8'), 'one Y two')
  await tool('fs.write').execute({ path: 'b.txt', content: 'X X' }, ctxFor(dir))
  await assert.rejects(() => tool('fs.edit').execute({ path: 'b.txt', old: 'X', new: 'Y' }, ctxFor(dir)), /appears 2 times/)
  assert.deepEqual(await tool('fs.edit').execute({ path: 'b.txt', old: 'X', new: 'Y', all: true }, ctxFor(dir)), { path: 'b.txt', replaced: 2 })
  await assert.rejects(() => tool('fs.edit').execute({ path: 'b.txt', old: 'nope', new: 'z' }, ctxFor(dir)), /not found/)
})
