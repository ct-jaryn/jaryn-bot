import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import { InitiativeService, TeachService } from '../src/index.ts'

const db = () => new DatabaseSync(':memory:')

test('threshold, dedupe, cap, accept and dismiss+mute', () => {
  const service = new InitiativeService(db(), { threshold: 0.2, maxPerDay: 2, dedupeMs: 60_000 })
  // score = 0.1*0.1*0.1-0.15 < 0.2
  assert.equal(service.ingest({ title: 'low', reason: 'x', impact: 0.1, urgency: 0.1, confidence: 0.1 }).created, null)
  const first = service.ingest({ title: 'GitHub 授权过期', reason: '需要重连', impact: 0.9, urgency: 0.9, confidence: 0.9 })
  assert.ok(first.created)
  assert.equal(service.ingest({ title: 'GitHub 授权过期', reason: 'dup', impact: 0.9, urgency: 0.9, confidence: 0.9 }).skipped, 'duplicate')
  const second = service.ingest({ title: '下午客户会', reason: '准备背景', impact: 0.8, urgency: 0.8, confidence: 0.8 }).created
  assert.ok(second)
  assert.equal(service.ingest({ title: 'third', reason: 'cap', impact: 1, urgency: 1, confidence: 1 }).skipped, 'daily-cap')

  const accepted = service.accept(first.created!.id)
  assert.equal(accepted.status, 'accepted')
  const third = service.ingest({ title: '第四', reason: 'dismiss test', impact: 1, urgency: 1, confidence: 1 })
  // daily-cap still applies (2 already)
  assert.equal(third.skipped, 'daily-cap')

  const service2 = new InitiativeService(db(), { threshold: 0.2 })
  const p = service2.ingest({ title: 'mute-me', reason: 'x', impact: 1, urgency: 1, confidence: 1 }).created!
  service2.dismiss(p.id, true)
  assert.equal(service2.ingest({ title: 'mute-me', reason: 'x', impact: 1, urgency: 1, confidence: 1 }).skipped, 'muted')
})

test('teach draft and save', () => {
  const teach = new TeachService(mkdtempSync(join(tmpdir(), 'jary-skills-')))
  const markdown = teach.draft({ title: '生成周报', steps: ['打开看板', '导出数据', '写总结'] })
  assert.match(markdown, /生成周报/)
  assert.match(markdown, /2\. 导出数据/)
  const saved = teach.save({ title: '周报技能', markdown })
  assert.ok(saved.path.endsWith('SKILL.md'))
  assert.deepEqual(teach.list().map((s) => s.name), ['周报技能'])
})
