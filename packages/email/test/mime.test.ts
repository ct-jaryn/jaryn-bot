import { test } from 'node:test'
import assert from 'node:assert/strict'
import { extractAttachments, htmlToText, parseMessage } from '../src/imap.ts'

test('html body is converted to text', () => {
  const raw = Buffer.from('From: a@b.c\r\nSubject: hi\r\nContent-Type: text/html; charset=utf-8\r\n\r\n<html><body><p>Hello <b>world</b></p><script>x()</script></body></html>')
  const mail = parseMessage('1', raw)
  assert.match(mail.text, /Hello world/)
  assert.doesNotMatch(mail.text, /x\(\)/)
  assert.equal(htmlToText('<p>a</p><p>b</p>'), 'a\nb')
})

test('base64 attachments are extracted from multipart bodies', () => {
  const boundary = 'XYZ'
  const body = [
    `--${boundary}`,
    'Content-Type: text/plain',
    '',
    'see attached',
    `--${boundary}`,
    'Content-Type: application/pdf; name="report.pdf"',
    'Content-Transfer-Encoding: base64',
    'Content-Disposition: attachment; filename="report.pdf"',
    '',
    Buffer.from('PDFDATA').toString('base64'),
    `--${boundary}--`,
  ].join('\r\n')
  const { clean, attachments } = extractAttachments(body, `multipart/mixed; boundary="${boundary}"`)
  assert.match(clean, /see attached/)
  assert.equal(attachments.length, 1)
  assert.equal(attachments[0]!.filename, 'report.pdf')
  assert.equal(attachments[0]!.bytes.toString(), 'PDFDATA')
})
