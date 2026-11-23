import { test } from 'node:test'
import assert from 'node:assert/strict'
import { DatabaseSync } from 'node:sqlite'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { ArtifactService, artifactToolsPlugin } from '../src/index.ts'
import { Context } from '@jaryn/kernel'
import { toolRegistryPlugin } from '@jaryn/agent-core'

test('save, list and read artifacts', () => {
  const service = new ArtifactService(new DatabaseSync(':memory:'), mkdtempSync(join(tmpdir(), 'jary-art-')))
  const a = service.save({ name: 'report.md', content: '# hello', mime: 'text/markdown', sessionId: 's1' })
  assert.equal(a.bytes, 7)
  assert.equal(service.list().length, 1)
  assert.equal(service.read(a.id).toString('utf8'), '# hello')
})

test('artifact.present tool returns deliverable metadata', async () => {
  const home = mkdtempSync(join(tmpdir(), 'jary-art-'))
  const service = new ArtifactService(new DatabaseSync(':memory:'), home)
  const a = service.save({ name: 'r.md', content: 'x' })
  const ctx = new Context({ scope: 'root' })
  await ctx.mount(toolRegistryPlugin())
  ctx.provide('artifacts', service)
  await ctx.mount(artifactToolsPlugin())
  const out = await ctx.get<any>('tools').execute('artifact.present', { id: a.id }, { signal: new AbortController().signal, sessionId: 's', cwd: home })
  assert.equal(out.presented, true)
  assert.equal(out.name, 'r.md')
  await ctx.dispose()
})
