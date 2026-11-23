import { test } from 'node:test'
import assert from 'node:assert/strict'
import { DatabaseSync } from 'node:sqlite'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { ArtifactService } from '../src/index.ts'

test('save, list and read artifacts', () => {
  const service = new ArtifactService(new DatabaseSync(':memory:'), mkdtempSync(join(tmpdir(), 'jary-art-')))
  const a = service.save({ name: 'report.md', content: '# hello', mime: 'text/markdown', sessionId: 's1' })
  assert.equal(a.bytes, 7)
  assert.equal(service.list().length, 1)
  assert.equal(service.read(a.id).toString('utf8'), '# hello')
})
