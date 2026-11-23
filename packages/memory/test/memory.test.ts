import { test } from 'node:test'
import assert from 'node:assert/strict'
import { DatabaseSync } from 'node:sqlite'
import { MemoryStore } from '../src/store.ts'
import { tokenize } from '../src/tokenizer.ts'

const newStore = () => new MemoryStore(new DatabaseSync(':memory:'))

test('tokenizer emits CJK bigrams and ascii words', () => {
  const t = tokenize('周报要用中文 conclusion-first')
  assert.ok(t.includes('周报'))
  assert.ok(t.includes('中文'))
  assert.ok(t.includes('conclusion-first'))
})

test('remember, search, catalog, forget', () => {
  const m = newStore()
  const a = m.remember({ ns: 'bot:jaryn', text: '以后周报都用中文，结论先行', kind: 'rule', pinned: true })
  m.remember({ ns: 'bot:jaryn', text: '用户住在上海', kind: 'fact' })
  m.remember({ ns: 'bot:other', text: '别的 bot 的记忆', kind: 'fact' })
  assert.equal(m.list({ ns: 'bot:jaryn' }).length, 2)
  const hits = m.search({ ns: 'bot:jaryn', query: '周报 中文' })
  assert.equal(hits[0]!.id, a.id)
  const catalog = m.catalog('bot:jaryn')
  assert.ok(catalog.some((c) => c.kind === 'rule' && c.count === 1))
  assert.equal(m.forget({ ns: 'bot:jaryn', query: '上海' }), 1)
  assert.equal(m.list({ ns: 'bot:jaryn' }).length, 1)
})

test('digest is bounded and contains pinned entries', () => {
  const m = newStore()
  m.remember({ ns: 'global', text: 'pinned rule: 回答用中文', kind: 'rule', pinned: true })
  for (let i = 0; i < 50; i++) m.remember({ ns: 'global', text: `filler memory number ${i} `.repeat(10), kind: 'fact' })
  const digest = m.digest({ ns: 'global', query: '周报', budgetTokens: 200 })
  assert.match(digest, /pinned rule/)
  assert.ok(digest.length <= 200 * 3 + 40)
})

test('observe + consolidate dedupes near duplicates', () => {
  const m = newStore()
  assert.equal(m.observe('global', '记住：周报用中文'), 1)
  assert.equal(m.observe('global', '记住：周报用中文'), 1)
  const result = m.consolidate('global')
  assert.equal(result.candidates, 2)
  assert.equal(result.added, 1)
  assert.equal(result.merged, 1)
  assert.equal(m.list({ ns: 'global' }).length, 1)
})
