import { test } from 'node:test'
import assert from 'node:assert/strict'
import { DatabaseSync } from 'node:sqlite'
import { PagesService } from '../src/index.ts'

const newService = () => new PagesService(new DatabaseSync(':memory:'))

test('updates create versions and rollback restores content', () => {
  const pages = newService()
  const page = pages.create({ title: '周报', html: '<p>v1</p>' })
  pages.update(page.id, { html: '<p>v2</p>' })
  pages.update(page.id, { html: '<p>v3</p>' })
  const versions = pages.versions(page.id)
  assert.equal(versions.length, 2)
  assert.deepEqual(versions.map((v) => v.version), [2, 1])
  const restored = pages.rollback(page.id, 1)
  assert.match(restored.html, /v1/)
  assert.equal(pages.versions(page.id).length, 3)
})

test('version history is capped at 20 snapshots', () => {
  const pages = newService()
  const page = pages.create({ title: 't', html: '<p>0</p>' })
  for (let i = 1; i <= 30; i++) pages.update(page.id, { html: `<p>${i}</p>` })
  assert.equal(pages.versions(page.id).length, 20)
})

test('share links expire after the requested ttl', async () => {
  const pages = newService()
  const page = pages.create({ title: 't', html: '<p>x</p>' })
  const { token, expiresAt } = pages.share(page.id, true, 30)
  assert.ok(token)
  assert.ok(expiresAt! > Date.now())
  assert.ok(pages.byToken(token!))
  await new Promise((r) => setTimeout(r, 60))
  assert.equal(pages.byToken(token!), undefined)
})

test('revoking a share removes access', () => {
  const pages = newService()
  const page = pages.create({ title: 't', html: '<p>x</p>' })
  const { token } = pages.share(page.id)
  pages.share(page.id, false)
  assert.equal(pages.byToken(token!), undefined)
})
