import { test } from 'node:test'
import crypto from 'node:crypto'
import assert from 'node:assert/strict'
import { Context } from '@jaryn/kernel'
import { agentPlugin, toolRegistryPlugin } from '@jaryn/agent-core'
import { FakeProvider } from '@jaryn/testing'
import { Store } from '@jaryn/store-sqlite'
import { devicesPlugin } from '@jaryn/devices'
import { pagesPlugin } from '@jaryn/pages'
import { startWebServer } from '../src/index.ts'

async function setup() {
  const ctx = new Context({ scope: 'root' })
  const store = new Store(':memory:')
  ctx.provide('store', store)
  ctx.provide('tools', { register: () => () => {}, list: () => [], get: () => undefined, execute: async () => undefined } as any)
  ctx.provide('llm', new FakeProvider([]))
  await ctx.mount(agentPlugin())
  await ctx.mount(devicesPlugin())
  await ctx.mount(pagesPlugin())
  const server = await startWebServer(ctx, { port: 0, apiToken: 'owner-secret' })
  return { ctx, server }
}

const auth = { authorization: 'Bearer owner-secret' }

test('creating a pair code requires authentication (no auth bypass)', async () => {
  const { ctx, server } = await setup()
  try {
    const unauth = await fetch(`${server.url}/api/devices/pair-code`, { method: 'POST' })
    assert.equal(unauth.status, 401)

    const created = await fetch(`${server.url}/api/devices/pair-code`, { method: 'POST', headers: auth })
    assert.equal(created.status, 201)
    const { code } = await created.json() as any
    assert.match(code, /^\d{6}$/)

    // Pairing itself stays public: the device only knows the one-time code.
    const paired = await fetch(`${server.url}/api/devices/pair`, {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ code, name: 'phone' }),
    })
    assert.equal(paired.status, 201)
    const { token, deviceId } = await paired.json() as any
    assert.match(token, /^[0-9a-f]{64}$/)

    // Device token works on HTTP ...
    const ok = await fetch(`${server.url}/api/sessions`, { headers: { authorization: `Bearer ${token}` } })
    assert.equal(ok.status, 200)
    // ... and can be revoked.
    const revoked = await fetch(`${server.url}/api/devices/${deviceId}/revoke`, { method: 'POST', headers: auth })
    assert.equal(revoked.status, 200)
    const denied = await fetch(`${server.url}/api/sessions`, { headers: { authorization: `Bearer ${token}` } })
    assert.equal(denied.status, 401)
  } finally { await server.close(); await ctx.dispose() }
})

test('stream tickets are short-lived and only valid for stream paths', async () => {
  const { ctx, server } = await setup()
  try {
    const issued = await fetch(`${server.url}/api/stream-ticket`, { method: 'POST', headers: auth })
    assert.equal(issued.status, 201)
    const { ticket, expiresAt } = await issued.json() as any
    assert.ok(expiresAt > Date.now())
    assert.equal(ticket.length, 48)

    // stream path accepts the ticket
    const stream = await fetch(`${server.url}/api/stream?sessionId=web&ticket=${ticket}`, { headers: { accept: 'text/event-stream' } })
    assert.equal(stream.status, 200)
    await stream.body?.cancel()

    // same ticket must not authorize normal API calls
    const api = await fetch(`${server.url}/api/sessions?ticket=${ticket}`)
    assert.equal(api.status, 401)

    // unknown ticket is rejected
    const bad = await fetch(`${server.url}/api/stream?sessionId=web&ticket=deadbeef`)
    assert.equal(bad.status, 401)
  } finally { await server.close(); await ctx.dispose() }
})

test('security headers are set', async () => {
  const { ctx, server } = await setup()
  try {
    const res = await fetch(`${server.url}/`)
    assert.match(res.headers.get('content-security-policy') ?? '', /default-src 'self'/)
    assert.equal(res.headers.get('x-content-type-options'), 'nosniff')
    assert.equal(res.headers.get('x-frame-options'), 'DENY')
  } finally { await server.close(); await ctx.dispose() }
})

test('oauth callback rejects requests without a valid state', async () => {
  const { ctx, server } = await setup()
  process.env.JARY_OAUTH_CLIENT_ID_DEMO = 'cid'
  process.env.JARY_OAUTH_TOKEN_URL_DEMO = 'http://127.0.0.1:1/token'
  try {
    // no state at all
    const noState = await fetch(`${server.url}/api/oauth/callback/demo?code=abc`)
    assert.equal(noState.status, 400)
    // made-up state
    const badState = await fetch(`${server.url}/api/oauth/callback/demo?code=abc&state=forged`)
    assert.equal(badState.status, 400)
  } finally {
    delete process.env.JARY_OAUTH_CLIENT_ID_DEMO
    delete process.env.JARY_OAUTH_TOKEN_URL_DEMO
    await server.close()
    await ctx.dispose()
  }
})

test('tunnel upgrade requires authentication', async () => {
  const { ctx, server } = await setup()
  const { connect } = await import('node:net')
  const port = Number(new URL(server.url).port)
  const key = Buffer.from(crypto.randomBytes(16)).toString('base64')
  const tryUpgrade = (query: string) => new Promise<number>((resolve) => {
    const socket = connect({ host: '127.0.0.1', port })
    let status = 0
    socket.on('connect', () => {
      socket.write([
        'GET /tunnel' + query + ' HTTP/1.1',
        `Host: 127.0.0.1:${port}`,
        'Upgrade: websocket',
        'Connection: Upgrade',
        `Sec-WebSocket-Key: ${key}`,
        'Sec-WebSocket-Version: 13',
        '', '',
      ].join('\r\n'))
    })
    socket.on('data', (chunk) => {
      const match = chunk.toString('latin1').match(/^HTTP\/1\.1 (\d{3})/)
      if (match) status = Number(match[1])
      socket.destroy()
      resolve(status)
    })
    socket.on('error', () => { socket.destroy(); resolve(status) })
    setTimeout(() => { socket.destroy(); resolve(status) }, 2000)
  })
  try {
    assert.equal(await tryUpgrade(''), 401)
    assert.equal(await tryUpgrade('?token=owner-secret'), 101)
  } finally {
    await server.close()
    await ctx.dispose()
  }
})

test('private /pages/:id requires auth while /p/:token share link stays public', async () => {
  const { ctx, server } = await setup()
  try {
    const pages = ctx.get<any>('pages')
    const page = pages.create({ title: 'Secret Brief', html: '<p>confidential</p>' })
    const unauth = await fetch(`${server.url}/pages/${page.id}`)
    assert.equal(unauth.status, 401)

    const authed = await fetch(`${server.url}/pages/${page.id}`, { headers: auth })
    assert.equal(authed.status, 200)

    const { token } = pages.share(page.id)
    const shared = await fetch(`${server.url}/p/${token}`)
    assert.equal(shared.status, 200)
  } finally {
    await server.close()
    await ctx.dispose()
  }
})

test('repeated failed auth attempts trigger 429 rate limiting', async () => {
  const { ctx, server } = await setup()
  try {
    let lastStatus = 0
    for (let i = 0; i < 21; i++) {
      const res = await fetch(`${server.url}/api/sessions`, { headers: { authorization: 'Bearer wrong-token' } })
      lastStatus = res.status
    }
    assert.equal(lastStatus, 429)
  } finally {
    await server.close()
    await ctx.dispose()
  }
})
