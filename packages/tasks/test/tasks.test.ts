import { test } from 'node:test'
import assert from 'node:assert/strict'
import { DatabaseSync } from 'node:sqlite'
import { TaskService } from '../src/index.ts'

const newService = () => new TaskService(new DatabaseSync(':memory:'))

test('create, get, list and status transitions', () => {
  const tasks = newService()
  const task = tasks.create({ sessionId: 's1', title: '写周报', body: '本周进度' })
  assert.equal(task.status, 'todo')
  assert.equal(tasks.get(task.id)!.title, '写周报')
  tasks.create({ sessionId: 's2', title: '别的任务' })
  assert.equal(tasks.list('s1').length, 1)
  assert.equal(tasks.list().length, 2)

  const claimed = tasks.claim(task.id, 'bot-a', 's1')
  assert.equal(claimed.status, 'claimed')
  assert.equal(claimed.ownerBot, 'bot-a')
  assert.equal(claimed.version, 2)

  const done = tasks.complete(task.id, 'bot-a')
  assert.equal(done.status, 'done')
  assert.equal(done.version, 3)
})

test('claim uses CAS on the expected version', () => {
  const tasks = newService()
  const task = tasks.create({ sessionId: 's', title: 't' })
  tasks.claim(task.id, 'bot-a', 's', 1)
  assert.throws(() => tasks.claim(task.id, 'bot-b', 's', 1), /is claimed/)
})

test('only the owner may complete, and not twice', () => {
  const tasks = newService()
  const task = tasks.create({ sessionId: 's', title: 't' })
  tasks.claim(task.id, 'bot-a', 's')
  assert.throws(() => tasks.complete(task.id, 'bot-b'), /not the owner|owner/i)
  tasks.complete(task.id, 'bot-a')
  assert.throws(() => tasks.complete(task.id, 'bot-a'), /already|done|status/i)
})
