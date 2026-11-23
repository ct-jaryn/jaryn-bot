import { test } from 'node:test'
import assert from 'node:assert/strict'
import { createServer } from 'node:net'
import { SmtpClient } from '../src/index.ts'

test('sends an email over plain SMTP', async () => {
  let received = ''
  const server = createServer((socket) => {
    socket.on('error', () => {})
    let data = ''
    socket.write('220 fake\r\n')
    socket.on('data', (chunk) => {
      const text = chunk.toString('utf8')
      data += text
      received = data
      for (const line of text.split('\r\n').filter(Boolean)) {
        if (/^EHLO/.test(line)) socket.write('250-ok\r\n250 AUTH LOGIN\r\n')
        else if (/^AUTH LOGIN/.test(line)) socket.write('334 VXNlcm5hbWU6\r\n')
        else if (line === Buffer.from('me').toString('base64')) socket.write('334 UGFzc3dvcmQ6\r\n')
        else if (line === Buffer.from('pw').toString('base64')) socket.write('235 ok\r\n')
        else if (/^MAIL FROM/.test(line) || /^RCPT TO/.test(line)) socket.write('250 ok\r\n')
        else if (/^DATA/.test(line)) socket.write('354 go\r\n')
        else if (line === '.') socket.write('250 queued\r\n')
        else if (/^QUIT/.test(line)) socket.end('221 bye\r\n')
      }
    })
  })
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', r))
  const port = (server.address() as any).port
  const client = new SmtpClient({ host: '127.0.0.1', port, from: 'bot@example.com', user: 'me', pass: 'pw' })
  await client.send({ to: 'you@example.com', subject: 'hi', body: 'hello' })
  await new Promise((r) => setTimeout(r, 50))
  await new Promise<void>((r) => server.close(() => r()))
  assert.match(received, /Subject: hi/)
  assert.match(received, /RCPT TO:<you@example.com>/)
  assert.match(received, /To: you@example.com/)
})
