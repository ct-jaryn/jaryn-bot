import { test } from 'node:test'
import assert from 'node:assert/strict'
import { createServer } from 'node:http'
import { refreshOAuthToken } from '../src/index.ts'

test('refresh token exchange posts grant_type=refresh_token', async () => {
  const server = createServer((req, res) => {
    let body = ''
    req.on('data', (c) => body += c)
    req.on('end', () => {
      assert.match(body, /grant_type=refresh_token/)
      assert.match(body, /refresh_token=r-1/)
      assert.match(body, /client_id=cid/)
      res.writeHead(200, { 'content-type': 'application/json' })
      res.end(JSON.stringify({ access_token: 'new-token', expires_in: 3600 }))
    })
  })
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', r))
  const port = (server.address() as any).port
  try {
    const tokens = await refreshOAuthToken({ tokenUrl: `http://127.0.0.1:${port}/token`, clientId: 'cid', clientSecret: 'sec', refreshToken: 'r-1' })
    assert.equal(tokens.access_token, 'new-token')
  } finally { server.close() }
})
