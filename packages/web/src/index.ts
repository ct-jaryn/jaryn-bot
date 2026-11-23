import { createServer } from 'node:http'
import type { IncomingMessage, Server, ServerResponse } from 'node:http'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { basename, join, resolve } from 'node:path'
import type { Context } from '@jaryn/kernel'
import { newApprovalId } from '@jaryn/agent-core'
import type { ApprovalDecision, ApprovalRequest, ApprovalService } from '@jaryn/agent-core'

export interface WebOptions {
  host?: string
  port?: number
  approvalTimeoutMs?: number
}

export interface WebServer {
  url: string
  server: Server
  close(): Promise<void>
}

const PUBLIC = join(import.meta.dirname, 'public')
const ASK_RISKS = new Set(['execute', 'external', 'destructive'])

export async function startWebServer(ctx: Context, opts: WebOptions = {}): Promise<WebServer> {
  const host = opts.host ?? '127.0.0.1'
  const port = opts.port ?? 8787
  const approvalTimeout = opts.approvalTimeoutMs ?? 30 * 60_000

  const clients = new Set<{ res: ServerResponse; sessionId: string }>()
  const pending = new Map<string, { req: ApprovalRequest; resolve: (d: ApprovalDecision) => void; timer: NodeJS.Timeout }>()

  const broadcast = (sessionId: string, event: unknown) => {
    const payload = `data: ${JSON.stringify(event)}\n\n`
    for (const client of clients) {
      if (client.sessionId === sessionId || sessionId === '*') client.res.write(payload)
    }
  }

  const approvals: ApprovalService = {
    async request(req, signal) {
      const id = req.id || newApprovalId()
      const request = { ...req, id }
      return await new Promise<ApprovalDecision>((resolve) => {
        const finish = (decision: ApprovalDecision) => {
          const entry = pending.get(id)
          if (!entry) return
          clearTimeout(entry.timer)
          pending.delete(id)
          signal?.removeEventListener('abort', onAbort)
          broadcast(request.sessionId, { type: 'approval.resolved', id, decision })
          resolve(decision)
        }
        const onAbort = () => finish('denied')
        const timer = setTimeout(() => finish('denied'), approvalTimeout)
        pending.set(id, { req: request, resolve: finish, timer })
        broadcast(request.sessionId, { type: 'approval', request })
        signal?.addEventListener('abort', onAbort, { once: true })
      })
    },
  }

  // Register only when the composition does not provide one (tests/local).
  if (!ctx.has('approvals')) {
    ctx.provide('approvals', {
      request: async (req: ApprovalRequest, signal?: AbortSignal) => {
        if (!ASK_RISKS.has(req.risk)) return 'allowed'
        return approvals.request(req, signal)
      },
    } satisfies ApprovalService)
  }

  const server = createServer(async (req, res) => {
    try {
      await route(req, res)
    } catch (err) {
      sendJson(res, 500, { error: (err as Error).message })
    }
  })

  async function route(req: IncomingMessage, res: ServerResponse): Promise<void> {
    const url = new URL(req.url ?? '/', `http://${req.headers.host ?? `${host}:${port}`}`)
    const path = url.pathname

    if (req.method === 'GET' && (path === '/' || path === '/index.html')) return sendFile(res, 'index.html', 'text/html')
    if (req.method === 'GET' && path === '/app.js') return sendFile(res, 'app.js', 'text/javascript')
    if (req.method === 'GET' && path === '/style.css') return sendFile(res, 'style.css', 'text/css')
    if (req.method === 'GET' && path === '/healthz') return sendJson(res, 200, { ok: true })

    if (req.method === 'GET' && path === '/api/sessions') {
      const store = ctx.get<any>('store')
      return sendJson(res, 200, { sessions: store.listSessions() })
    }
    if (req.method === 'POST' && path === '/api/sessions') {
      const body = await readBody(req)
      const store = ctx.get<any>('store')
      const id = body.id ?? `s_${Date.now().toString(36)}`
      const session = store.createSession(id, body.botId ?? 'default', body.cwd ?? process.cwd())
      return sendJson(res, 201, { session })
    }
    if (req.method === 'GET' && path === '/api/events') {
      const store = ctx.get<any>('store')
      const sessionId = url.searchParams.get('sessionId') ?? ''
      const fromSeq = Number(url.searchParams.get('fromSeq') ?? 0)
      return sendJson(res, 200, { events: store.events(sessionId, fromSeq) })
    }
    if (req.method === 'POST' && path === '/api/files') {
      const store = ctx.get<any>('store')
      const sessionId = url.searchParams.get('sessionId') ?? 'web'
      const session = store.getSession(sessionId) ?? store.createSession(sessionId, 'default', process.cwd())
      const name = basename(url.searchParams.get('name') ?? `file-${Date.now()}`)
      const chunks: Buffer[] = []
      let size = 0
      for await (const chunk of req) {
        size += (chunk as Buffer).length
        if (size > 20 * 1024 * 1024) return sendJson(res, 413, { error: 'file too large (20MB)' })
        chunks.push(chunk as Buffer)
      }
      const dir = resolve(session.cwd, 'inbox')
      await mkdir(dir, { recursive: true })
      const target = join(dir, name)
      await writeFile(target, Buffer.concat(chunks))
      return sendJson(res, 201, { path: target, name, bytes: size })
    }
    if (req.method === 'GET' && path === '/api/files') {
      const store = ctx.get<any>('store')
      const sessionId = url.searchParams.get('sessionId') ?? 'web'
      const session = store.getSession(sessionId) ?? { cwd: process.cwd() }
      const requested = String(url.searchParams.get('path') ?? '')
      const target = resolve(session.cwd, requested)
      if (!target.startsWith(resolve(session.cwd))) return sendJson(res, 400, { error: 'path escapes workspace' })
      const data = await readFile(target)
      res.writeHead(200, { 'content-type': 'application/octet-stream', 'content-disposition': `attachment; filename="${basename(target)}"` })
      return void res.end(data)
    }
    if (req.method === 'GET' && path === '/api/approvals') {
      return sendJson(res, 200, { approvals: [...pending.values()].map((p) => p.req) })
    }
    if (req.method === 'POST' && path.startsWith('/api/approvals/')) {
      const id = path.slice('/api/approvals/'.length)
      const body = await readBody(req)
      const entry = pending.get(id)
      if (!entry) return sendJson(res, 404, { error: 'approval not found' })
      const decision: ApprovalDecision = body.decision === 'allowed' ? 'allowed' : 'denied'
      const sessionId = entry.req.sessionId
      entry.resolve(decision)
      return sendJson(res, 200, { ok: true, decision, sessionId })
    }
    if (req.method === 'POST' && path === '/api/message') {
      const body = await readBody(req)
      const text = String(body.text ?? '').trim()
      if (!text) return sendJson(res, 400, { error: 'text required' })
      const store = ctx.get<any>('store')
      const sessionId = String(body.sessionId ?? 'web')
      if (!store.getSession(sessionId)) store.createSession(sessionId, 'default', body.cwd ?? process.cwd())
      const agent = ctx.get<any>('agent')
      res.writeHead(202, { 'content-type': 'application/json' })
      res.end(JSON.stringify({ accepted: true, sessionId }))
      agent
        .runTurn({
          sessionId,
          text,
          onDelta: (delta: unknown) => broadcast(sessionId, { type: 'delta', delta }),
        })
        .then((result: unknown) => broadcast(sessionId, { type: 'turn.end', result }))
        .catch((err: Error) => broadcast(sessionId, { type: 'error', message: err.message }))
      return
    }
    if (req.method === 'GET' && path === '/api/stream') {
      const sessionId = url.searchParams.get('sessionId') ?? '*'
      res.writeHead(200, {
        'content-type': 'text/event-stream',
        'cache-control': 'no-cache',
        connection: 'keep-alive',
      })
      res.write(`data: ${JSON.stringify({ type: 'hello', sessionId })}\n\n`)
      const client = { res, sessionId }
      clients.add(client)
      req.on('close', () => clients.delete(client))
      return
    }

    sendJson(res, 404, { error: 'not found' })
  }

  await new Promise<void>((resolve) => server.listen(port, host, resolve))
  const address = server.address()
  const actualPort = typeof address === 'object' && address ? address.port : port
  const url = `http://${host}:${actualPort}`
  return {
    url,
    server,
    async close() {
      for (const client of clients) client.res.end()
      clients.clear()
      for (const p of pending.values()) {
        clearTimeout(p.timer)
        p.resolve('denied')
      }
      pending.clear()
      await new Promise<void>((resolve) => server.close(() => resolve()))
    },
  }
}

async function sendFile(res: ServerResponse, name: string, type: string): Promise<void> {
  const data = await readFile(join(PUBLIC, name))
  res.writeHead(200, { 'content-type': `${type}; charset=utf-8` })
  res.end(data)
}

function sendJson(res: ServerResponse, status: number, body: unknown): void {
  res.writeHead(status, { 'content-type': 'application/json; charset=utf-8' })
  res.end(JSON.stringify(body))
}

async function readBody(req: IncomingMessage): Promise<any> {
  const chunks: Buffer[] = []
  let size = 0
  for await (const chunk of req) {
    size += (chunk as Buffer).length
    if (size > 1_000_000) throw new Error('body too large')
    chunks.push(chunk as Buffer)
  }
  if (chunks.length === 0) return {}
  return JSON.parse(Buffer.concat(chunks).toString('utf8'))
}
