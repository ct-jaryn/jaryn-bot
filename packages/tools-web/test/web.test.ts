import { test } from 'node:test'
import assert from 'node:assert/strict'
import { createServer } from 'node:http'
import { fetchPage, htmlToText, searchWeb, stripTags } from '../src/index.ts'
import { assertSafeUrl, isPrivateAddress } from '../src/ssrf.ts'

test('private address detection and url guard', async () => {
  assert.equal(isPrivateAddress('127.0.0.1'), true)
  assert.equal(isPrivateAddress('10.1.2.3'), true)
  assert.equal(isPrivateAddress('192.168.1.1'), true)
  assert.equal(isPrivateAddress('172.16.0.1'), true)
  assert.equal(isPrivateAddress('169.254.169.254'), true)
  assert.equal(isPrivateAddress('8.8.8.8'), false)
  await assert.rejects(() => assertSafeUrl('http://127.0.0.1/secret'), /blocked private/)
  await assert.rejects(() => assertSafeUrl('file:///etc/passwd'), /blocked protocol/)
  await assert.rejects(() => assertSafeUrl('http://user:pw@example.com'), /credentials/)
})

test('html to text strips scripts and tags', () => {
  const text = htmlToText('<html><head><title>T</title><script>evil()</script><style>.a{}</style></head><body><h1>Hi</h1><p>Hello <b>world</b></p></body></html>')
  assert.match(text, /Hi/)
  assert.match(text, /Hello world/)
  assert.doesNotMatch(text, /evil/)
  assert.equal(stripTags('<a href="x">link &amp; text</a>'), 'link & text')
})

test('fetchPage reads a public page and rejects loopback', async () => {
  const server = createServer((req, res) => {
    res.writeHead(200, { 'content-type': 'text/html' })
    res.end('<html><head><title>Local</title></head><body><p>hello page</p></body></html>')
  })
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', r))
  const port = (server.address() as any).port
  try {
    await assert.rejects(() => fetchPage(`http://127.0.0.1:${port}/`), /blocked private/)
  } finally {
    server.close()
  }
})

test('searxng provider parses results', async () => {
  const server = createServer((req, res) => {
    res.writeHead(200, { 'content-type': 'application/json' })
    res.end(JSON.stringify({ results: [
      { title: 'Result A', url: 'https://a.example', content: 'snippet a' },
      { title: 'Result B', url: 'https://b.example', content: 'snippet b' },
    ] }))
  })
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', r))
  const port = (server.address() as any).port
  try {
    const out = await searchWeb('jaryn', { search: { provider: 'searxng', baseUrl: `http://127.0.0.1:${port}` } })
    assert.equal(out.provider, 'searxng')
    assert.equal(out.results.length, 2)
    assert.equal(out.results[0]!.title, 'Result A')
  } finally {
    server.close()
  }
})
