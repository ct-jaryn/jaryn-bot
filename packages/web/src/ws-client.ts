import type { IncomingMessage } from 'node:http'
import type { Duplex } from 'node:stream'
import type { Context } from '@jaryn/kernel'
import { handleUpgrade } from '@jaryn/tunnel'
import type { WsConnection } from '@jaryn/tunnel'

/**
 * `/ws/client` JSON-RPC channel (docs/02 §10).
 * Request:  {"id": 1, "method": "session.list", "params": {...}}
 * Response: {"id": 1, "result": ...}  or  {"id": 1, "error": "..."}
 * Events:   {"event": "turn.delta", "data": {...}}
 */
export interface WsClientOptions {
  authorize?: (req: IncomingMessage, url: URL) => boolean
}

export class WsClientServer {
  private sockets = new Set<WsConnection>()
  private sessions = new Map<string, { unsubscribe: () => void }>()
  private ctx: Context
  private opts: WsClientOptions

  constructor(ctx: Context, opts: WsClientOptions = {}) {
    this.ctx = ctx
    this.opts = opts
  }

  attach(server: { on(event: 'upgrade', fn: (req: IncomingMessage, socket: Duplex) => void): void }): void {
    server.on('upgrade', (req, socket) => {
      const url = new URL(req.url ?? '/', 'http://localhost')
      if (url.pathname !== '/ws/client') {
        // Let other handlers (tunnel) deal with their own paths.
        return
      }
      if (this.opts.authorize && !this.opts.authorize(req, url)) {
        socket.write('HTTP/1.1 401 Unauthorized\r\n\r\n')
        socket.destroy()
        return
      }
      const conn = handleUpgrade(req, socket as Duplex)
      this.wire(conn)
    })
  }

  private wire(conn: WsConnection): void {
    this.sockets.add(conn)
    const store = this.ctx.get<any>('store')
    conn.send(JSON.stringify({ event: 'ready', data: { version: 1, methods: METHODS } }))
    conn.onMessage((raw) => { void this.handle(conn, raw) })
    conn.onClose(() => {
      this.sockets.delete(conn)
      for (const [, sub] of this.sessions) sub.unsubscribe()
      this.sessions.clear()
    })
    void store
  }

  private async handle(conn: WsConnection, raw: string): Promise<void> {
    let message: any
    try {
      message = JSON.parse(raw)
    } catch {
      conn.send(JSON.stringify({ error: 'invalid json' }))
      return
    }
    const id = message.id
    try {
      const result = await this.dispatch(message.method, message.params ?? {}, conn)
      conn.send(JSON.stringify({ id, result }))
    } catch (err) {
      conn.send(JSON.stringify({ id, error: (err as Error).message }))
    }
  }

  private async dispatch(method: string, params: Record<string, unknown>, conn: WsConnection): Promise<unknown> {
    const store = this.ctx.get<any>('store')
    const agent = this.ctx.get<any>('agent')
    switch (method) {
      case 'ping':
        return { pong: Date.now() }
      case 'session.list':
        return { sessions: store?.listSessions?.() ?? [] }
      case 'session.create': {
        const id = String(params.id ?? `ws_${Date.now().toString(36)}`)
        const botId = String(params.botId ?? 'default')
        const bots = this.ctx.get<any>('bots')
        const cwd = bots?.workspaceFor?.(botId, process.cwd()) ?? process.cwd()
        store?.createSession?.(id, botId, cwd)
        return { session: store?.getSession?.(id) }
      }
      case 'session.subscribe': {
        const sessionId = String(params.sessionId ?? '')
        const events = store?.events?.(sessionId) ?? []
        this.sessions.set(sessionId, {
          unsubscribe: () => {
            this.sessions.delete(sessionId)
          },
        })
        return { sessionId, events: events.slice(-50) }
      }
      case 'turn.send': {
        const sessionId = String(params.sessionId ?? '')
        const text = String(params.text ?? '')
        if (!agent?.runTurn) throw new Error('agent not mounted')
        // Stream deltas to this connection while keeping a normal HTTP turn possible.
        void this.streamTurn(conn, { sessionId, text, provenance: String(params.provenance ?? 'owner') })
        return { accepted: true, sessionId }
      }
      case 'turn.cancel': {
        const { cancelTurn } = await import('@jaryn/agent-core')
        return { cancelled: cancelTurn(String(params.sessionId ?? '')) }
      }
      case 'approval.respond': {
        const pending = this.ctx.get<any>('pendingApprovals')
        if (!pending?.resolve) throw new Error('approval bridge not mounted')
        const decision = String(params.decision ?? 'denied') === 'allowed' ? 'allowed' : 'denied'
        return { resolved: pending.resolve(String(params.id ?? ''), decision) }
      }
      case 'approval.list': {
        const pending = this.ctx.get<any>('pendingApprovals')
        return { approvals: pending?.list?.() ?? [] }
      }
      case 'usage.total': {
        return store?.usageTotal?.(params.sessionId ? String(params.sessionId) : undefined) ?? {}
      }
      default:
        throw new Error(`unknown method: ${method}`)
    }
  }

  private async streamTurn(conn: WsConnection, input: { sessionId: string; text: string; provenance: string }): Promise<void> {
    const agent = this.ctx.get<any>('agent')
    try {
      const result = await agent.runTurn({
        ...input,
        onDelta: (delta: any) => conn.send(JSON.stringify({ event: 'turn.delta', data: delta })),
      })
      conn.send(JSON.stringify({ event: 'turn.end', data: { finishReason: result.finishReason, text: result.text } }))
    } catch (err) {
      conn.send(JSON.stringify({ event: 'turn.error', data: { message: (err as Error).message } }))
    }
  }

  broadcast(event: string, data: unknown): void {
    const payload = JSON.stringify({ event, data })
    for (const conn of this.sockets) {
      try { conn.send(payload) } catch { /* closed */ }
    }
  }

  close(): void {
    for (const conn of this.sockets) conn.close()
    this.sockets.clear()
  }
}

const METHODS = [
  'ping', 'session.list', 'session.create', 'session.subscribe',
  'turn.send', 'turn.cancel', 'approval.list', 'approval.respond', 'usage.total',
]
