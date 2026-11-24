import { test } from 'node:test'
import assert from 'node:assert/strict'
import { createServer } from 'node:net'
import { spawnSync } from 'node:child_process'
import { mkdtempSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { buildMessage, SmtpClient, toAttachments } from '../src/smtp.ts'

function fakeServer(script: Record<string, string>, onData?: (data: string) => void) {
  return createServer((socket) => {
    socket.on('error', () => {})
    socket.write('220 fake ESMTP\r\n')
    let buffer = ''
    socket.on('data', (chunk) => {
      buffer += chunk.toString('utf8')
      let index: number
      while ((index = buffer.indexOf('\r\n')) >= 0) {
        const line = buffer.slice(0, index)
        buffer = buffer.slice(index + 2)
        onData?.(line)
        const upper = line.toUpperCase()
        const reply = Object.entries(script).find(([prefix]) => upper.startsWith(prefix))?.[1]
        if (line === '.') { socket.write(script['.'] ?? '250 queued\r\n'); continue }
        if (line.startsWith('DATA')) { socket.write('354 go\r\n'); continue }
        if (reply) socket.write(reply)
      }
    })
  })
}

async function withServer<T>(server: ReturnType<typeof fakeServer>, fn: (port: number) => Promise<T>): Promise<T> {
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
  const port = (server.address() as any).port
  try { return await fn(port) } finally { await new Promise<void>((resolve) => server.close(() => resolve())) }
}

test('buildMessage encodes body, html and attachments as MIME', () => {
  const message = buildMessage('bot@example.com', {
    to: 'you@example.com',
    subject: '报告', body: 'hello', html: '<b>hello</b>',
    attachments: [{ filename: 'a.txt', content: 'file-body', contentType: 'text/plain' }],
  })
  assert.match(message, /multipart\/mixed/)
  assert.match(message, /Subject: =\?UTF-8\?B\?/)
  assert.match(message, /filename="a.txt"/)
  assert.match(message, new RegExp(Buffer.from('file-body').toString('base64').slice(0, 8)))
  assert.match(message, /Content-Type: text\/html/)
})

test('plain SMTP (no STARTTLS) sends AUTH PLAIN and message', async () => {
  const lines: string[] = []
  const server = fakeServer({
    EHLO: '250-fake\r\n250-AUTH PLAIN LOGIN\r\n250 SIZE 1000000\r\n',
    'AUTH PLAIN': '235 ok\r\n',
    'MAIL FROM': '250 ok\r\n',
    'RCPT TO': '250 ok\r\n',
    QUIT: '221 bye\r\n',
  }, (line) => lines.push(line))
  await withServer(server, async (port) => {
    const client = new SmtpClient({ host: '127.0.0.1', port, from: 'bot@example.com', user: 'me', pass: 'pw', security: 'none' })
    await client.send({ to: 'you@example.com', subject: 'hi', body: 'hello' })
  })
  assert.ok(lines.some((line) => line.startsWith('AUTH PLAIN')))
  assert.ok(lines.includes('.'))
})

test('starttls required fails when server does not offer it', async () => {
  const server = fakeServer({ EHLO: '250 fake plain-text-only\r\n', QUIT: '221 bye\r\n' })
  await withServer(server, async (port) => {
    const client = new SmtpClient({ host: '127.0.0.1', port, from: 'a@b.c', security: 'starttls' })
    await assert.rejects(() => client.send({ to: 'x@y.z', subject: 's', body: 'b' }), /does not offer STARTTLS/)
  })
})

test('implicit TLS (465-style) works with self-signed cert', { skip: !hasOpenssl() }, async () => {
  const dir = mkdtempSync(join(tmpdir(), 'jary-smtp-tls-'))
  const key = join(dir, 'key.pem')
  const cert = join(dir, 'cert.pem')
  generateCert(key, cert)
  const { createServer: createTlsServer } = await import('node:tls')
  const server = createTlsServer({ key: readFileSync(key), cert: readFileSync(cert) }, (socket) => {
    socket.on('error', () => {})
    socket.write('220 fake TLS\r\n')
    let buffer = ''
    socket.on('data', (chunk) => {
      buffer += chunk.toString('utf8')
      let index: number
      while ((index = buffer.indexOf('\r\n')) >= 0) {
        const line = buffer.slice(0, index)
        buffer = buffer.slice(index + 2)
        const upper = line.toUpperCase()
        if (upper.startsWith('EHLO')) socket.write('250-fake\r\n250 AUTH LOGIN\r\n')
        else if (upper.startsWith('AUTH LOGIN')) socket.write('334 VXNlcm5hbWU6\r\n')
        else if (line === Buffer.from('me').toString('base64')) socket.write('334 UGFzc3dvcmQ6\r\n')
        else if (line === Buffer.from('pw').toString('base64')) socket.write('235 ok\r\n')
        else if (upper.startsWith('MAIL FROM') || upper.startsWith('RCPT TO')) socket.write('250 ok\r\n')
        else if (upper.startsWith('DATA')) socket.write('354 go\r\n')
        else if (line === '.') socket.write('250 queued\r\n')
        else if (upper.startsWith('QUIT')) socket.end('221 bye\r\n')
      }
    })
  })
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
  const port = (server.address() as any).port
  try {
    const client = new SmtpClient({ host: '127.0.0.1', port, from: 'a@b.c', user: 'me', pass: 'pw', security: 'tls', rejectUnauthorized: false })
    await client.send({ to: 'x@y.z', subject: 'tls', body: 'hello' })
  } finally {
    await new Promise<void>((resolve) => server.close(() => resolve()))
  }
})

test('toAttachments converts tool args', () => {
  const list = toAttachments([{ filename: 'a.txt', content: 'hi' }, { filename: 'b.bin', base64: Buffer.from('x').toString('base64') }])
  assert.equal(list.length, 2)
  assert.equal(list[0]!.content.toString(), 'hi')
  assert.equal(list[1]!.content.toString(), 'x')
})

function hasOpenssl(): boolean {
  return spawnSync('openssl', ['version'], { encoding: 'utf8' }).status === 0
}

function generateCert(keyPath: string, certPath: string): void {
  const result = spawnSync('openssl', ['req', '-x509', '-newkey', 'rsa:2048', '-nodes', '-keyout', keyPath, '-out', certPath,
    '-days', '1', '-subj', '/CN=127.0.0.1'], { encoding: 'utf8' })
  if (result.status !== 0) throw new Error(`openssl failed: ${result.stderr}`)
}
