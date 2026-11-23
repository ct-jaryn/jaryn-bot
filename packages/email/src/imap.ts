import { connect as netConnect, type Socket } from 'node:net'
import { connect as tlsConnect } from 'node:tls'

export interface ImapConfig {
  host: string
  port?: number
  user: string
  pass: string
  secure?: boolean
  mailbox?: string
}

export interface InboundEmail {
  uid: string
  from: string
  subject: string
  text: string
}

/** Minimal IMAP client: LOGIN → SELECT → SEARCH UNSEEN → FETCH RFC822 → mark seen. */
export class ImapClient {
  private cfg: ImapConfig
  private socket?: Socket
  private buffer = Buffer.alloc(0)
  private lines: string[] = []
  private waiters: ((line: string) => void)[] = []
  private tag = 0
  private literalResolver?: (data: Buffer) => void

  constructor(cfg: ImapConfig) {
    this.cfg = cfg
  }

  async connect(): Promise<void> {
    const port = this.cfg.port ?? (this.cfg.secure === false ? 143 : 993)
    this.socket = this.cfg.secure === false
      ? netConnect({ host: this.cfg.host, port })
      : tlsConnect({ host: this.cfg.host, port, servername: this.cfg.host })
    this.socket.on('data', (chunk) => this.onData(chunk as Buffer))
    await new Promise<void>((resolve, reject) => {
      this.socket!.once('connect', () => resolve())
      this.socket!.once('secureConnect', () => resolve())
      this.socket!.once('error', reject)
    })
    await this.readLine() // greeting
  }

  async fetchUnseen(): Promise<InboundEmail[]> {
    await this.command(`LOGIN "${this.cfg.user}" "${this.cfg.pass}"`)
    await this.command(`SELECT "${this.cfg.mailbox ?? 'INBOX'}"`)
    const search = await this.command('SEARCH UNSEEN')
    const ids = search.match(/\* SEARCH ([0-9 ]*)/)?.[1]?.trim().split(/\s+/).filter(Boolean) ?? []
    const out: InboundEmail[] = []
    for (const id of ids) {
      const raw = await this.fetchOne(id)
      if (raw) out.push(parseMessage(id, raw))
      await this.command(`STORE ${id} +FLAGS (\\Seen)`).catch(() => '')
    }
    return out
  }

  async close(): Promise<void> {
    try { await this.command('LOGOUT') } catch { /* ignore */ }
    this.socket?.destroy()
  }

  private async fetchOne(id: string): Promise<Buffer | undefined> {
    const tag = `a${++this.tag}`
    let literal: Buffer | undefined
    this.literalResolver = (data) => { literal = data }
    this.socket!.write(`${tag} FETCH ${id} (RFC822)\r\n`)
    while (true) {
      const line = await this.readLine()
      if (line.startsWith(tag)) break
    }
    this.literalResolver = undefined
    return literal
  }

  private async command(cmd: string): Promise<string> {
    const tag = `a${++this.tag}`
    this.socket!.write(`${tag} ${cmd}\r\n`)
    let collected = ''
    while (true) {
      const line = await this.readLine()
      collected += line + '\n'
      if (line.startsWith(tag)) return collected
    }
  }

  private readLine(): Promise<string> {
    const queued = this.lines.shift()
    if (queued !== undefined) return Promise.resolve(queued)
    return new Promise((resolve) => this.waiters.push(resolve))
  }

  private pushLine(line: string): void {
    const waiter = this.waiters.shift()
    if (waiter) waiter(line)
    else this.lines.push(line)
  }

  private onData(chunk: Buffer): void {
    this.buffer = Buffer.concat([this.buffer, chunk])
    while (true) {
      const idx = this.buffer.indexOf(Buffer.from('\r\n'))
      if (idx < 0) return
      const line = this.buffer.subarray(0, idx).toString('utf8')
      this.buffer = this.buffer.subarray(idx + 2)
      const literalMatch = line.match(/\{(\d+)\}$/)
      if (literalMatch) {
        const size = Number(literalMatch[1])
        if (this.buffer.length < size) {
          // put the line back and wait for the literal bytes
          this.buffer = Buffer.concat([Buffer.from(line + '\r\n'), this.buffer])
          return
        }
        const data = this.buffer.subarray(0, size)
        this.buffer = this.buffer.subarray(size)
        if (this.buffer.subarray(0, 2).toString() === '\r\n') this.buffer = this.buffer.subarray(2)
        this.literalResolver?.(Buffer.from(data))
        this.pushLine(line)
        continue
      }
      this.pushLine(line)
    }
  }
}

export function parseMessage(uid: string, raw: Buffer): InboundEmail {
  const text = raw.toString('utf8')
  const split = text.split(/\r?\n\r?\n/)
  const headers = split.shift() ?? ''
  const body = split.join('\n\n')
  const header = (name: string) => headers.match(new RegExp(`^${name}:\\s*(.*)$`, 'im'))?.[1]?.trim() ?? ''
  return { uid, from: header('From'), subject: header('Subject'), text: body.slice(0, 20_000) }
}
