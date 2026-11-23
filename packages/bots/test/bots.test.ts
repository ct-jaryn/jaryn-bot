import { test } from 'node:test'
import assert from 'node:assert/strict'
import { DatabaseSync } from 'node:sqlite'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { BotsService } from '../src/index.ts'
import { TaskService } from '@jaryn/tasks'

const db = () => new DatabaseSync(':memory:')

test('bot roster and workspace creation', () => {
  const home = mkdtempSync(join(tmpdir(), 'jary-bots-'))
  const bots = new BotsService(db(), home)
  bots.add({ id: 'researcher', name: '研究员' })
  bots.add({ id: 'writer', name: '写手' })
  assert.equal(bots.list().length, 2)
  assert.equal(bots.get('researcher')!.memoryNs, 'bot:researcher')
  assert.equal(bots.remove('writer'), true)
})

test('bot messages enforce hop limit', () => {
  const home = mkdtempSync(join(tmpdir(), 'jary-bots-'))
  const bots = new BotsService(db(), home)
  bots.add({ id: 'alpha' }); bots.add({ id: 'beta' })
  assert.doesNotThrow(() => bots.send('alpha', 'beta', 'hi', 't1', 0))
  assert.doesNotThrow(() => bots.send('alpha', 'beta', 'hi', 't1', 2))
  assert.throws(() => bots.send('alpha', 'beta', 'hi', 't1', 3), /hop limit/)
  assert.equal(bots.inbox('beta').length, 2)
})

test('two bots collaborate through the task board', () => {
  const tasks = new TaskService(db())
  const task = tasks.create({ sessionId: 'root', title: '研究三家竞品', body: '带来源' })
  const claimed = tasks.claim(task.id, 'researcher', 'child-1')
  assert.equal(claimed.status, 'claimed')
  assert.equal(claimed.ownerBot, 'researcher')
  assert.throws(() => tasks.claim(task.id, 'writer'), /cannot claim/)
  const done = tasks.complete(task.id, 'researcher')
  assert.equal(done.status, 'done')
  assert.equal(tasks.list('root').length, 1)
})
