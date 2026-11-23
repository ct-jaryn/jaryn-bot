import { createServer } from 'node:http'
import type { Server } from 'node:http'
import { connect as netConnect } from 'node:net'
import type { Socket } from 'node:net'
import { randomUUID } from 'node:crypto'
import { handleUpgrade } from './ws.ts'
import type { WsConnection } from './ws.ts'

interface PendingHttp {
  resolve: (v: { status: number; headers: Record<string, string>; body: string }) => void
  reject: (e: Error) => void
}

export class TunnelServer {
  private connections = new Set<WsConnection>()
  private pending = new Map<string, PendingHttp>()
  private tunnels = new Map<string, { client: Socket; remote: Socket }>()
  private proxy?: Server
  private port = 0
  onConnect?: (proxyUrl: string) => void

  attach(server: Server): void {
    server.on('upgrade', (req, socket) => {
      const url = new URL(req.url ?? '/', 'http://localhost')
      if (url.pathname !== '/tunnel') { socket.destroy(); return }
      const conn = handleUpgrade(req, socket as Socket)
      this.connections.add(conn)
      conn.onMessage((data) => this.onMessage(data))
      conn.onClose(() => this.connections.delete(conn))
      void this.ensureProxy().then((port) => this.onConnect?.(`http://127.0.0.1:${port}`))
    })
  }

  status(): { connected: boolean; proxyPort: number } {
    return { connected: this.connections.size > 0, proxyPort: this.port }
  }

  async ensureProxy(): Promise<number> {
    if (this.proxy) return this.port
    this.proxy = createServer((req, res) => { void this.onRequest(req, res) })
    this.proxy.on('connect', (req, clientSocket, head) => this.onConnectRequest(req, clientSocket, head))
    await new Promise<void>((resolve) => this.proxy!.listen(0, '127.0.0.1', resolve))
    this.port = (this.proxy.address() as any).port
    return this.port
  }

  close(): void {
    for (const conn of this.connections) conn.close()
    this.connections.clear()
    for (const t of this.tunnels.values()) { t.client.destroy(); t.remote.destroy() }
    this.tunnels.clear()
    this.proxy?.close()
  }

  private client(): WsConnection | undefined {
    return [...this.connections][0]
  }

  private async onRequest(req: any, res: any): Promise<void> {
    const conn = this.client()
    if (!conn) { res.writeHead(502); res.end('tunnel offline'); return }
    const id = randomUUID()
    const chunks: Buffer[] = []
    for await (const chunk of req) chunks.push(chunk as Buffer)
    const body = Buffer.concat(chunks).toString('base64')
    const headers: Record<string, string> = {}
    for (const [k, v] of Object.entries(req.headers)) if (typeof v === 'string') headers[k] = v
    conn.send(JSON.stringify({ type: 'http', id, method: req.method, url: req.url, headers, body }))
    try {
      const result = await new Promise<{ status: number; headers: Record<string, string>; body: string }>((resolve, reject) => {
        this.pending.set(id, { resolve, reject })
        setTimeout(() => { if (this.pending.delete(id)) reject(new Error('tunnel timeout')) }, 20_000).unref?.()
      })
      res.writeHead(result.status, result.headers)
      res.end(Buffer.from(result.body, 'base64'))
    } catch (err) {
      res.writeHead(504); res.end((err as Error).message)
    }
  }

  private onConnectRequest(req: any, clientSocket: Socket, head: Buffer): void {
    const conn = this.client()
    if (!conn) { clientSocket.destroy(); return }
    const id = randomUUID()
    const [host, portRaw] = String(req.url ?? '').split(':')
    conn.send(JSON.stringify({ type: 'connect', id, host, port: Number(portRaw ?? 443) }))
    this.tunnels.set(id, { client: clientSocket, remote: undefined as unknown as Socket })
    clientSocket.on('data', (chunk) => conn.send(JSON.stringify({ type: 'data', id, chunk: chunk.toString('base64') })))
    clientSocket.on('error', () => conn.send(JSON.stringify({ type: 'close', id })))
    clientSocket.on('close', () => { conn.send(JSON.stringify({ type: 'close', id })); this.tunnels.delete(id) })
  }

  private onMessage(data: string): void {
    let msg: any
    try { msg = JSON.parse(data) } catch { return }
    if (msg.type === 'response') {
      const pending = this.pending.get(msg.id)
      if (pending) { this.pending.delete(msg.id); pending.resolve({ status: msg.status, headers: msg.headers ?? {}, body: msg.body ?? '' }) }
      return
    }
    if (msg.type === 'connect-ok') {
      const tunnel = this.tunnels.get(msg.id)
      if (tunnel) {
        tunnel.remote = netConnect({ host: msg.host, port: msg.port })
        tunnel.remote.on('connect', () => { tunnel.client.write('HTTP/1.1 200 Connection Established\r\n\r\n') })
        tunnel.remote.on('data', (chunk) => { const conn = this.client(); if (conn) conn.send(JSON.stringify({ type: 'data', id: msg.id, chunk: chunk.toString('base64') })) })
        tunnel.remote.on('error', () => tunnel.client.destroy())
      }
      return
    }
    if (msg.type === 'data') {
      const tunnel = this.tunnels.get(msg.id)
      tunnel?.remote?.write?.(Buffer.from(msg.chunk, 'base64'))
      return
    }
    if (msg.type === 'close') {
      const tunnel = this.tunnels.get(msg.id)
      tunnel?.client.destroy(); tunnel?.remote.destroy(); this.tunnels.delete(msg.id)
    }
  }
}

export class TunnelClient {
  private ws?: WebSocket
  private sockets = new Map<string, Socket>()

  private url: string
  constructor(url: string) {
    this.url = url
  }

  connect(): Promise<void> {
    return new Promise((resolve, reject) => {
      this.ws = new WebSocket(this.url)
      this.ws.addEventListener('open', () => resolve(), { once: true })
      this.ws.addEventListener('error', () => reject(new Error('tunnel connect failed')), { once: true })
      this.ws.addEventListener('message', (event) => { void this.onMessage(JSON.parse(String(event.data))) })
    })
  }

  close(): void {
    for (const s of this.sockets.values()) s.destroy()
    this.sockets.clear()
    this.ws?.close()
  }

  private async onMessage(msg: any): Promise<void> {
    if (msg.type === 'http') {
      try {
        const res = await fetch(msg.url, {
          method: msg.method,
          headers: msg.headers,
          body: ['GET', 'HEAD'].includes(msg.method) ? undefined : Buffer.from(msg.body ?? '', 'base64'),
          signal: AbortSignal.timeout(20_000),
        })
        const body = Buffer.from(await res.arrayBuffer()).toString('base64')
        const headers: Record<string, string> = {}
        res.headers.forEach((v, k) => { headers[k] = v })
        this.ws?.send(JSON.stringify({ type: 'response', id: msg.id, status: res.status, headers, body }))
      } catch (err) {
        this.ws?.send(JSON.stringify({ type: 'response', id: msg.id, status: 502, headers: {}, body: Buffer.from(String(err)).toString('base64') }))
      }
      return
    }
    if (msg.type === 'connect') {
      const socket = netConnect({ host: msg.host, port: msg.port })
      this.sockets.set(msg.id, socket)
      socket.on('connect', () => this.ws?.send(JSON.stringify({ type: 'connect-ok', id: msg.id, host: msg.host, port: msg.port })))
      socket.on('data', (chunk) => this.ws?.send(JSON.stringify({ type: 'data', id: msg.id, chunk: chunk.toString('base64') })))
      socket.on('error', () => this.ws?.send(JSON.stringify({ type: 'close', id: msg.id })))
      return
    }
    if (msg.type === 'data') {
      this.sockets.get(msg.id)?.write(Buffer.from(msg.chunk, 'base64'))
      return
    }
    if (msg.type === 'close') {
      this.sockets.get(msg.id)?.destroy()
      this.sockets.delete(msg.id)
    }
  }
}
