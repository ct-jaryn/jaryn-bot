import { test } from 'node:test'
import assert from 'node:assert/strict'
import { DatabaseSync } from 'node:sqlite'
import { GoalService } from '../src/index.ts'

function serviceWith(script: { text: string; finishReason?: string }[]) {
  const service = new GoalService(new DatabaseSync(':memory:'))
  const calls: string[] = []
  service.agent = {
    async runTurn(input) {
      calls.push(input.text)
      const next = script.shift() ?? { text: 'done', finishReason: 'completed' }
      return { text: next.text, finishReason: next.finishReason ?? 'completed' }
    },
  }
  return { service, calls }
}

test('goal reaches completion when agent says DONE', async () => {
  const { service, calls } = serviceWith([
    { text: 'working on it' },
    { text: 'DONE' },
  ])
  const goal = service.set({ sessionId: 's', objective: '写一份报告', maxRounds: 5 })
  const result = await service.run(goal.id)
  assert.equal(result.status, 'completed')
  assert.equal(result.rounds, 2)
  assert.equal(calls.length, 2)
  assert.match(calls[1]!, /Continue toward the goal/)
})

test('goal becomes blocked on BLOCKED and stops', async () => {
  const { service, calls } = serviceWith([{ text: 'BLOCKED: 缺少凭据' }])
  const goal = service.set({ sessionId: 's2', objective: '部署服务', maxRounds: 5 })
  const result = await service.run(goal.id)
  assert.equal(result.status, 'blocked')
  assert.equal(calls.length, 1)
})

test('goal prompt section and pause/clear', () => {
  const { service } = serviceWith([])
  const goal = service.set({ sessionId: 's3', objective: '整理资料' })
  assert.match(service.promptSection('s3'), /整理资料/)
  service.update(goal.id, { status: 'paused' })
  assert.equal(service.promptSection('s3'), '')
  service.update(goal.id, { status: 'cleared' })
  assert.equal(service.list().length, 1)
})
