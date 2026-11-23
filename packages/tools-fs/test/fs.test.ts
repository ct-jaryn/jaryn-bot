import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fsTools } from '../src/index.ts'

function workspace() {
  const dir = mkdtempSync(join(tmpdir(), 'jary-fs-'))
  mkdirSync(join(dir, 'src'))
  writeFileSync(join(dir, 'src/a.ts'), 'export const answer = 42\n')
  writeFileSync(join(dir, 'README.md'), 'hello jaryn\n')
  return dir
}

const ctxFor = (cwd: string) => ({ signal: new AbortController().signal, sessionId: 's', cwd })
const tool = (name: string) => fsTools().find((t) => t.name === name)!

test('read resolves inside workspace', async () => {
  const dir = workspace()
  const text = await tool('fs.read').execute({ path: 'src/a.ts' }, ctxFor(dir))
  assert.match(String(text), /answer = 42/)
})

test('read rejects traversal', async () => {
  const dir = workspace()
  await assert.rejects(() => tool('fs.read').execute({ path: '../../etc/passwd' }, ctxFor(dir)), /escapes workspace/)
})

test('glob and grep', async () => {
  const dir = workspace()
  const glob = await tool('fs.glob').execute({ pattern: 'src/**/*.ts' }, ctxFor(dir))
  assert.match(String(glob), /src\/a\.ts/)
  const grep = await tool('fs.grep').execute({ pattern: 'answer' }, ctxFor(dir))
  assert.match(String(grep), /src\/a\.ts:1/)
})
