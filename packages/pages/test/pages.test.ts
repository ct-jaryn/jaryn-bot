import { test } from 'node:test'
import assert from 'node:assert/strict'
import { DatabaseSync } from 'node:sqlite'
import { PagesService, renderPageDocument } from '../src/index.ts'

test('create, update, share and render pages', () => {
  const pages = new PagesService(new DatabaseSync(':memory:'))
  const page = pages.create({ title: '周报', template: 'table', data: [{ a: 1, b: 2 }] })
  assert.match(page.html, /<table>/)
  const updated = pages.update(page.id, { title: '周报 v2' })
  assert.equal(updated.title, '周报 v2')
  const { token } = pages.share(page.id)
  assert.ok(token)
  assert.equal(pages.byToken(token!)!.id, page.id)
  const doc = renderPageDocument(page)
  assert.match(doc, /Content-Security-Policy/)
  assert.match(doc, /script-src 'none'/)
  assert.ok(pages.list().length === 1)
})
