import { definePlugin } from '@jaryn/kernel'
import type { Plugin } from '@jaryn/kernel'
import type { Tool } from '@jaryn/agent-core'
import { ImapClient } from './imap.ts'
import type { ImapConfig } from './imap.ts'

export { SmtpClient, buildMessage, toAttachments } from './smtp.ts'
export type { MailAttachment, MailInput, SmtpConfig } from './smtp.ts'
import { SmtpClient, toAttachments } from './smtp.ts'
import type { SmtpConfig } from './smtp.ts'

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
            const initiative = ctx.get<any>('initiative')
            initiative?.unreadMail?.push?.({ uid: mail.uid, from: mail.from, subject: mail.subject, receivedAt: Date.now() })
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
        description: 'Send an email via the configured SMTP account (optional html + attachments).',
        risk: 'external',
        schema: {
          type: 'object',
          properties: {
            to: { type: 'string' },
            subject: { type: 'string' },
            body: { type: 'string' },
            html: { type: 'string' },
            attachments: {
              type: 'array',
              items: {
                type: 'object',
                properties: {
                  filename: { type: 'string' },
                  content: { type: 'string', description: 'UTF-8 text content' },
                  base64: { type: 'string', description: 'base64 bytes (overrides content)' },
                  contentType: { type: 'string' },
                },
                required: ['filename'],
              },
            },
          },
          required: ['to', 'subject', 'body'],
        },
        async execute(args) {
          await email.send({
            to: String(args.to),
            subject: String(args.subject),
            body: String(args.body),
            html: args.html ? String(args.html) : undefined,
            attachments: toAttachments(args.attachments),
          })
          return { sent: true, attachments: toAttachments(args.attachments).length }
        },
      }))
    },
  })
}
