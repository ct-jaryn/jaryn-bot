import { test } from 'node:test'
import assert from 'node:assert/strict'
import { createServer } from 'node:http'
import { Context } from '@jaryn/kernel'
import { toolRegistryPlugin } from '@jaryn/agent-core'
import { ConnectorService, buildAuthorizeUrl, connectorsPlugin, exchangeOAuthCode } from '../src/index.ts'

test('authorize url carries client, scope and state', () => {
  const url = buildAuthorizeUrl({
    id: 'github', name: 'GitHub', baseUrl: 'https://api.github.com', tools: [],
    auth: { type: 'oauth2', authorizeUrl: 'https://github.com/login/oauth/authorize', clientId: 'cid', redirectUri: 'http://localhost/cb', scopes: ['repo', 'read:user'] },
  } as any, 'state-1')
  const parsed = new URL(url)
  assert.equal(parsed.searchParams.get('client_id'), 'cid')
  assert.equal(parsed.searchParams.get('state'), 'state-1')
  assert.equal(parsed.searchParams.get('scope'), 'repo read:user')
})

test('oauth code exchange posts form and returns tokens', async () => {
  const server = createServer((req, res) => {
    let body = ''
    req.on('data', (c) => body += c)
    req.on('end', () => {
      assert.match(body, /grant_type=authorization_code/)
      assert.match(body, /code=abc/)
      res.writeHead(200, { 'content-type': 'application/json' })
      res.end(JSON.stringify({ access_token: 'tok-1', refresh_token: 'r-1' }))
    })
  })
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', r))
  const port = (server.address() as any).port
  try {
    const tokens = await exchangeOAuthCode({ tokenUrl: `http://127.0.0.1:${port}/token`, clientId: 'cid', clientSecret: 'sec', redirectUri: 'http://x/cb', code: 'abc' })
    assert.equal(tokens.access_token, 'tok-1')
  } finally { server.close() }
})

test('connector uses a stored oauth token', async () => {
  const ctx = new Context({ scope: 'root' })
  await ctx.mount(toolRegistryPlugin())
  const service = new ConnectorService({ servers: [{ id: 'demo', name: 'Demo', baseUrl: 'https://example.com', tools: [] }] })
  service.setToken('demo', 'oauth-token')
  assert.equal(service.getToken('demo'), 'oauth-token')
  await ctx.mount(connectorsPlugin({ servers: [] }))
  await ctx.dispose()
})
