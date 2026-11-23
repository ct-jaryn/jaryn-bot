import { connect } from 'node:net'
import type { Socket } from 'node:net'
import { definePlugin } from '@jaryn/kernel'
import type { Plugin } from '@jaryn/kernel'
import type { Tool } from '@jaryn/agent-core'
import { ImapClient } from './imap.ts'
import type { ImapConfig } from './imap.ts'

export interface SmtpConfig {
  host: string
  port?: number
  user?: string
  pass?: string
  from: string
  secure?: boolean
}

export class SmtpClient {
  private cfg: SmtpConfig
  constructor(cfg: SmtpConfig) {
    this.cfg = cfg
  }
  async send(input: { to: string; subject: string; body: string }): Promise<void> {
    const socket = await this.connect()
    try {
      await this.expect(socket, 220)
      await this.command(socket, `EHLO jaryn-bot`, 250)
      if (this.cfg.user && this.cfg.pass) {
        await this.command(socket, 'AUTH LOGIN', 334)
        await this.command(socket, Buffer.from(this.cfg.user).toString('base64'), 334)
        await this.command(socket, Buffer.from(this.cfg.pass).toString('base64'), 235)
      }
      await this.command(socket, `MAIL FROM:<${this.cfg.from}>`, 250)
      await this.command(socket, `RCPT TO:<${input.to}>`, 250)
      await this.command(socket, 'DATA', 354)
      const message = [
        `From: ${this.cfg.from}`,
        `To: ${input.to}`,
        `Subject: ${input.subject}`,
        'MIME-Version: 1.0',
        'Content-Type: text/plain; charset=utf-8',
        '',
        input.body,
        '.',
      ].join('\r\n')
      socket.write(message + '\r\n')
      await this.expect(socket, 250)
      socket.write('QUIT\r\n')
    } finally {
      socket.destroy()
    }
  }

  private connect(): Promise<Socket> {
    return new Promise((resolve, reject) => {
      const socket = connect({ host: this.cfg.host, port: this.cfg.port ?? 25 })
      socket.setTimeout(15_000)
      socket.once('connect', () => resolve(socket))
      socket.once('error', reject)
      socket.once('timeout', () => reject(new Error('SMTP timeout')))
    })
  }

  private buffer = ''
  private waiters: ((line: string) => void)[] = []

  private expect(socket: Socket, code: number): Promise<string> {
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error(`SMTP expected ${code} timeout`)), 10_000)
      const onLine = (line: string) => {
        if (!line.startsWith(String(code))) return
        clearTimeout(timer)
        resolve(line)
      }
      this.waiters.push(onLine)
      if (!socket.listeners('data').length) {
        socket.on('data', (chunk) => {
          this.buffer += chunk.toString('utf8')
          let idx: number
          while ((idx = this.buffer.indexOf('\n')) >= 0) {
            const line = this.buffer.slice(0, idx).replace(/\r$/, '')
            this.buffer = this.buffer.slice(idx + 1)
            const waiters = this.waiters
            this.waiters = []
            for (const w of waiters) w(line)
            for (const w of [...waiters]) w(line)
          }
        })
      }
    })
  }

  private async command(socket: Socket, text: string, code: number): Promise<string> {
    socket.write(text + '\r\n')
    return await this.expect(socket, code)
  }
}

export function imapInboxPlugin(cfg: { imap?: ImapConfig; pollMs?: number; allowFrom?: string[] } = {}): Plugin<{ imap?: ImapConfig; pollMs?: number; allowFrom?: string[] }> {
  return definePlugin({
    name: '@jaryn/email/imap',
    inject: ['store'],
    optional: ['artifacts'],
    apply(ctx, config = {}) {
      const imap = config.imap ?? cfg.imap
      if (!imap) return
      const store = ctx.get<any>('store')
      let timer: NodeJS.Timeout | undefined
      let stopped = false
      const poll = async () => {
        if (stopped) return
        const client = new ImapClient(imap)
        try {
          await client.connect()
          const allow = config.allowFrom ?? cfg.allowFrom ?? []
          const messages = await client.fetchUnseen()
          for (const mail of messages) {
            if (allow.length > 0 && !allow.some((pattern) => mail.from.toLowerCase().includes(pattern.toLowerCase()))) {
              ctx.emit('email/rejected', { from: mail.from })
              continue
            }
            const artifacts = ctx.get<any>('artifacts')
            for (const attachment of mail.attachments ?? []) {
              try {
                artifacts?.save?.({ name: attachment.filename, content: attachment.bytes, mime: attachment.contentType })
              } catch (err) {
                ctx.emit('email/attachment-error', { name: attachment.filename, message: (err as Error).message })
              }
            }
            const sessionId = 'email'
            if (!store.getSession(sessionId)) store.createSession(sessionId, 'default', process.cwd())
            store.append({ sessionId, type: 'input.email', actorKind: 'system', provenance: 'web', data: mail })
            ctx.emit('email/received', mail)
          }
        } catch (err) {
          ctx.emit('email/error', { message: (err as Error).message })
        } finally {
          await client.close()
        }
      }
      timer = setInterval(() => { void poll() }, config.pollMs ?? cfg.pollMs ?? 60_000)
      timer.unref?.()
      void poll()
      ctx.effect(() => () => { stopped = true; if (timer) clearInterval(timer) })
    },
  })
}

export function smtpPlugin(cfg: { smtp?: SmtpConfig } = {}): Plugin<{ smtp?: SmtpConfig }> {
  return definePlugin({
    name: '@jaryn/email',
    provides: ['email'],
    apply(ctx, config = {}) {
      const smtp = config.smtp ?? cfg.smtp
      if (!smtp) return
      ctx.provide('email', new SmtpClient(smtp))
    },
  })
}

export function emailToolsPlugin(): Plugin {
  return definePlugin({
    name: '@jaryn/email/tools',
    inject: ['tools'],
    optional: ['email'],
    apply(ctx) {
      const email = ctx.get<SmtpClient>('email')
      if (!email) return
      const tools = ctx.get<{ register(t: Tool): () => void }>('tools')!
      ctx.effect(() => tools.register({
        name: 'email.send',
        description: 'Send an email via the configured SMTP account.',
        risk: 'external',
        schema: {
          type: 'object',
          properties: { to: { type: 'string' }, subject: { type: 'string' }, body: { type: 'string' } },
          required: ['to', 'subject', 'body'],
        },
        async execute(args) {
          await email.send({ to: String(args.to), subject: String(args.subject), body: String(args.body) })
          return { sent: true }
        },
      }))
    },
  })
}
