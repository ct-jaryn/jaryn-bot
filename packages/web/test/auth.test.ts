import { test } from 'node:test'
import assert from 'node:assert/strict'
import { Context } from '@jaryn/kernel'
import { agentPlugin, toolRegistryPlugin } from '@jaryn/agent-core'
import { FakeProvider } from '@jaryn/testing'
import { Store } from '@jaryn/store-sqlite'
import { startWebServer } from '../src/index.ts'

async function setup() {
  const ctx = new Context({ scope: 'root' })
  const store = new Store(':memory:')
  ctx.provide('store', store)
  ctx.provide('tools', { register: () => () => {}, list: () => [], get: () => undefined, execute: async () => undefined } as any)
  ctx.provide('llm', new FakeProvider([]))
  await ctx.mount(agentPlugin())
  const server = await startWebServer(ctx, { port: 0, apiToken: 'secret' })
  return { ctx, store, server }
}

test('api requires the token', async () => {
  const { ctx, server } = await setup()
  try {
    assert.equal((await fetch(`${server.url}/api/sessions`)).status, 401)
    assert.equal((await fetch(`${server.url}/api/sessions`, { headers: { authorization: 'Bearer secret' } })).status, 200)
  } finally { await server.close(); await ctx.dispose() }
})

test('oauth callback is reachable without a bearer token', async () => {
  const { ctx, server } = await setup()
  try {
    // No connector configured: handler must run and report the config error (not 401).
    const res = await fetch(`${server.url}/api/oauth/callback/gmail?code=abc&state=x`)
    assert.notEqual(res.status, 401)
    const body = await res.json()
    assert.match(body.error, /oauth not configured/)
  } finally { await server.close(); await ctx.dispose() }
})

test('email inbound accepts its own shared secret', async () => {
  const { ctx, store, server } = await setup()
  process.env.JARY_EMAIL_SECRET = 'mail-secret'
  try {
    const payload = JSON.stringify({ from: 'a@b.c', subject: 'hi', text: 'hello' })
    const denied = await fetch(`${server.url}/api/email/inbound`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: payload })
    assert.equal(denied.status, 401)
    const ok = await fetch(`${server.url}/api/email/inbound`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-jary-email-secret': 'mail-secret' },
      body: payload,
    })
    assert.equal(ok.status, 202)
    assert.ok(store.events('email').some((event: any) => event.type === 'input.email'))
  } finally {
    delete process.env.JARY_EMAIL_SECRET
    await server.close()
    await ctx.dispose()
  }
})
