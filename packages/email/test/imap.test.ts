import { test } from 'node:test'
import assert from 'node:assert/strict'
import { createServer } from 'node:net'
import { Context } from '@jaryn/kernel'
import { Store } from '@jaryn/store-sqlite'
import { ImapClient, parseMessage } from '../src/imap.ts'
import { imapInboxPlugin } from '../src/index.ts'

const RAW = 'From: Alice <alice@example.com>\r\nSubject: Hello jaryn\r\n\r\nHi there, this is the body.\r\n'

function fakeImapServer(): { port: Promise<number>; close: () => void } {
  const server = createServer((socket) => {
    socket.on('error', () => {})
    socket.write('* OK fake imap ready\r\n')
    socket.on('data', (chunk) => {
      const lines = chunk.toString('utf8').split('\r\n').filter(Boolean)
      for (const line of lines) {
        const [tag, ...rest] = line.split(' ')
        const cmd = rest[0]?.toUpperCase()
        if (cmd === 'LOGIN') socket.write(`${tag} OK logged in\r\n`)
        else if (cmd === 'SELECT') socket.write(`* 1 EXISTS\r\n${tag} OK [READ-WRITE] selected\r\n`)
        else if (cmd === 'SEARCH') socket.write(`* SEARCH 1\r\n${tag} OK search done\r\n`)
        else if (cmd === 'FETCH') {
          socket.write(`* 1 FETCH (RFC822 {${Buffer.byteLength(RAW)}}\r\n${RAW})\r\n${tag} OK fetch done\r\n`)
        } else if (cmd === 'STORE') socket.write(`${tag} OK stored\r\n`)
        else if (cmd === 'LOGOUT') socket.end(`* BYE bye\r\n${tag} OK logout\r\n`)
        else socket.write(`${tag} OK\r\n`)
      }
    })
  })
  const port = new Promise<number>((resolve) => server.listen(0, '127.0.0.1', () => resolve((server.address() as any).port)))
  return { port, close: () => server.close() }
}

test('parse raw message headers and body', () => {
  const mail = parseMessage('1', Buffer.from(RAW))
  assert.equal(mail.from, 'Alice <alice@example.com>')
  assert.equal(mail.subject, 'Hello jaryn')
  assert.match(mail.text, /this is the body/)
})

test('IMAP client fetches unseen mail', async () => {
  const server = fakeImapServer()
  const port = await server.port
  const client = new ImapClient({ host: '127.0.0.1', port, user: 'me', pass: 'pw', secure: false })
  try {
    await client.connect()
    const mails = await client.fetchUnseen()
    assert.equal(mails.length, 1)
    assert.equal(mails[0]!.subject, 'Hello jaryn')
  } finally {
    await client.close()
    server.close()
  }
})

test('inbox plugin appends input.email events', async () => {
  const server = fakeImapServer()
  const port = await server.port
  const ctx = new Context({ scope: 'root' })
  const store = new Store(':memory:')
  ctx.provide('store', store)
  try {
    await ctx.mount(imapInboxPlugin({ imap: { host: '127.0.0.1', port, user: 'me', pass: 'pw', secure: false }, pollMs: 50 }))
    for (let i = 0; i < 40; i++) {
      if (store.events('email').some((e: any) => e.type === 'input.email')) break
      await new Promise((r) => setTimeout(r, 50))
    }
    const events = store.events('email')
    assert.ok(events.some((e: any) => e.type === 'input.email' && /Hello jaryn/.test(JSON.stringify(e.data))))
  } finally {
    await ctx.dispose()
    server.close()
  }
})
