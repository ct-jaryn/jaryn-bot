import { connect as netConnect, type Socket } from 'node:net'
import { connect as tlsConnect, type TLSSocket } from 'node:tls'

export interface SmtpConfig {
  host: string
  port?: number
  user?: string
  pass?: string
  from: string
  /** 'auto' (STARTTLS when offered), 'starttls' (require), 'tls' (implicit), 'none'. */
  security?: 'auto' | 'starttls' | 'tls' | 'none'
  secure?: boolean
  timeoutMs?: number
  rejectUnauthorized?: boolean
}

export interface MailAttachment {
  filename: string
  content: Buffer | string
  contentType?: string
}

export interface MailInput {
  to: string
  subject: string
  body: string
  html?: string
  attachments?: MailAttachment[]
}

interface SmtpConfigInternal extends SmtpConfig {
  security: 'auto' | 'starttls' | 'tls' | 'none'
}

export class SmtpClient {
  private cfg: SmtpConfigInternal
  private buffer = ''
  private current?: (line: string) => boolean
  private socket?: Socket

  constructor(cfg: SmtpConfig) {
    const security = cfg.security ?? (cfg.port === 465 || cfg.secure ? 'tls' : 'auto')
    this.cfg = { ...cfg, security }
  }

  async send(input: MailInput): Promise<void> {
    let socket = await this.open()
    this.socket = socket
    this.attach(socket)
    try {
      await this.expect(220)
      let capabilities = await this.command('EHLO jaryn-bot', 250)
      if (this.cfg.security === 'starttls' || (this.cfg.security === 'auto' && /STARTTLS/i.test(capabilities))) {
        if (!/STARTTLS/i.test(capabilities)) throw new Error('SMTP server does not offer STARTTLS')
        await this.command('STARTTLS', 220)
        socket = this.upgrade(socket)
        this.socket = socket
        capabilities = await this.command('EHLO jaryn-bot', 250)
      }
      if (this.cfg.user && this.cfg.pass) await this.authenticate(capabilities)
      await this.command(`MAIL FROM:<${this.cfg.from}>`, 250)
      await this.command(`RCPT TO:<${input.to}>`, 250)
      await this.command('DATA', 354)
      socket.write(buildMessage(this.cfg.from, input) + '\r\n.\r\n')
      await this.expect(250)
      socket.write('QUIT\r\n')
    } finally {
      socket.destroy()
      this.socket = undefined
    }
  }

  private async authenticate(capabilities: string): Promise<void> {
    const user = this.cfg.user!
    const pass = this.cfg.pass!
    if (/AUTH[^\n]*PLAIN/i.test(capabilities)) {
      await this.command(`AUTH PLAIN ${Buffer.from(`\0${user}\0${pass}`).toString('base64')}`, 235)
      return
    }
    await this.command('AUTH LOGIN', 334)
    await this.command(Buffer.from(user).toString('base64'), 334)
    await this.command(Buffer.from(pass).toString('base64'), 235)
  }

  private open(): Promise<Socket> {
    const security = this.cfg.security
    const port = this.cfg.port ?? (security === 'tls' ? 465 : 25)
    return new Promise((resolve, reject) => {
      const socket = security === 'tls'
        ? tlsConnect({ host: this.cfg.host, port, servername: this.cfg.host, rejectUnauthorized: this.cfg.rejectUnauthorized ?? true })
        : netConnect({ host: this.cfg.host, port })
      socket.setTimeout(this.cfg.timeoutMs ?? 20_000)
      socket.once(security === 'tls' ? 'secureConnect' : 'connect', () => {
        socket.setTimeout(0)
        resolve(socket as unknown as Socket)
      })
      socket.once('error', reject)
      socket.once('timeout', () => reject(new Error('SMTP timeout')))
    })
  }

  private upgrade(socket: Socket): TLSSocket {
    const upgraded = tlsConnect({ socket, servername: this.cfg.host, rejectUnauthorized: this.cfg.rejectUnauthorized ?? true })
    this.buffer = ''
    this.attach(upgraded)
    return upgraded
  }

  private attach(socket: Socket): void {
    socket.on('data', (chunk: Buffer) => {
      this.buffer += chunk.toString('utf8')
      let index: number
      while ((index = this.buffer.indexOf('\n')) >= 0) {
        const line = this.buffer.slice(0, index).replace(/\r$/, '')
        this.buffer = this.buffer.slice(index + 1)
        const handler = this.current
        if (handler) handler(line)
      }
    })
  }

  private expect(code: number): Promise<string> {
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error(`SMTP expected ${code} timeout`)), this.cfg.timeoutMs ?? 20_000)
      const collected: string[] = []
      this.current = (line) => {
        const text = String(code)
        const isFinal = line.startsWith(`${text} `) || line === text
        if (line.startsWith(`${text}-`)) {
          collected.push(line)
          return false
        }
        if (!isFinal) return false
        clearTimeout(timer)
        this.current = undefined
        collected.push(line)
        resolve(collected.join('\n'))
        return true
      }
    })
  }

  private async command(text: string, code: number): Promise<string> {
    if (!this.socket) throw new Error('SMTP not connected')
    this.socket.write(text + '\r\n')
    return await this.expect(code)
  }
}

export function buildMessage(from: string, input: MailInput): string {
  const boundary = `jaryn-${Date.now().toString(36)}`
  const attachments = input.attachments ?? []
  const headers = [
    `From: ${from}`,
    `To: ${input.to}`,
    `Subject: ${encodeHeader(input.subject)}`,
    'MIME-Version: 1.0',
    `Date: ${new Date().toUTCString()}`,
  ]
  if (attachments.length === 0 && !input.html) {
    return [...headers, 'Content-Type: text/plain; charset=utf-8', 'Content-Transfer-Encoding: base64', '', encodeBody(input.body)].join('\r\n')
  }
  const parts: string[] = []
  parts.push([`--${boundary}`, 'Content-Type: text/plain; charset=utf-8', 'Content-Transfer-Encoding: base64', '', encodeBody(input.body)].join('\r\n'))
  if (input.html) {
    parts.push([`--${boundary}`, 'Content-Type: text/html; charset=utf-8', 'Content-Transfer-Encoding: base64', '', encodeBody(input.html)].join('\r\n'))
  }
  for (const attachment of attachments) {
    const bytes = typeof attachment.content === 'string' ? Buffer.from(attachment.content) : attachment.content
    parts.push([
      `--${boundary}`,
      `Content-Type: ${attachment.contentType ?? 'application/octet-stream'}; name="${attachment.filename}"`,
      `Content-Disposition: attachment; filename="${attachment.filename}"`,
      'Content-Transfer-Encoding: base64',
      '',
      wrap76(bytes.toString('base64')),
    ].join('\r\n'))
  }
  parts.push(`--${boundary}--`)
  return [...headers, `Content-Type: multipart/mixed; boundary="${boundary}"`, '', parts.join('\r\n')].join('\r\n')
}

export function toAttachments(input: unknown): MailAttachment[] {
  if (!Array.isArray(input)) return []
  return input.map((item: any) => ({
    filename: String(item.filename ?? item.name ?? 'attachment'),
    contentType: item.contentType ? String(item.contentType) : undefined,
    content: item.base64 ? Buffer.from(String(item.base64), 'base64') : String(item.content ?? ''),
  }))
}

function encodeBody(text: string): string {
  return wrap76(Buffer.from(text, 'utf8').toString('base64'))
}

function wrap76(base64: string): string {
  return base64.replace(/(.{76})/g, '$1\r\n')
}

function encodeHeader(value: string): string {
  return /^[\x20-\x7e]*$/.test(value) ? value : `=?UTF-8?B?${Buffer.from(value, 'utf8').toString('base64')}?=`
}
