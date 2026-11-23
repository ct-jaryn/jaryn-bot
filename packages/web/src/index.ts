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
    if (req.method === 'GET' && path === '/healthz') {
      const store = ctx.get<any>('store')
      const checks = {
        store: !!store,
        agent: ctx.has('agent'),
        memory: ctx.has('memory'),
        scheduler: ctx.has('scheduler'),
      }
      const ok = Object.values(checks).every(Boolean)
      return sendJson(res, ok ? 200 : 503, { ok, checks })
    }
    if (req.method === 'GET' && path === '/metrics') {
      const store = ctx.get<any>('store')
      const lines: string[] = []
      if (store) {
        const sessions = store.db.prepare('SELECT COUNT(*) AS c FROM sessions').get().c
        lines.push(`jaryn_sessions_total ${sessions}`)
        const events = store.db.prepare('SELECT type, COUNT(*) AS c FROM events GROUP BY type').all() as any[]
        for (const e of events) lines.push(`jaryn_events_total{type="${e.type}"} ${e.c}`)
      }
      if (ctx.has('scheduler')) {
        const scheduler = ctx.get<any>('scheduler')
        lines.push(`jaryn_jobs_total ${scheduler.list().length}`)
        lines.push(`jaryn_job_runs_total ${scheduler.runs().length}`)
      }
      if (ctx.has('memory')) {
        const memory = ctx.get<any>('memory')
        const stats = memory.stats('global')
        lines.push(`jaryn_memory_total{ns="global"} ${stats.total}`)
      }
      res.writeHead(200, { 'content-type': 'text/plain; charset=utf-8' })
      return void res.end(lines.join('\n') + '\n')
    }

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
    if (req.method === 'POST' && path.startsWith('/hooks/')) {
      const id = path.slice('/hooks/'.length)
      const scheduler = ctx.get<any>('scheduler')
      if (!scheduler) return sendJson(res, 404, { error: 'scheduler not mounted' })
      const raw = (await readRaw(req)).toString('utf8')
      const signature = String(req.headers['x-jary-signature'] ?? '')
      try {
        const run = await scheduler.triggerWebhook(id, raw, signature)
        return sendJson(res, 202, { run })
      } catch (err) {
        return sendJson(res, 401, { error: (err as Error).message })
      }
    }
    if (req.method === 'GET' && path === '/api/jobs') {
      const scheduler = ctx.get<any>('scheduler')
      if (!scheduler) return sendJson(res, 404, { error: 'scheduler not mounted' })
      return sendJson(res, 200, { jobs: scheduler.list(), runs: scheduler.runs() })
    }
    if (req.method === 'POST' && path === '/api/jobs') {
      const scheduler = ctx.get<any>('scheduler')
      if (!scheduler) return sendJson(res, 404, { error: 'scheduler not mounted' })
      const body = await readBody(req)
      if (!body.mission || !body.trigger) return sendJson(res, 400, { error: 'mission and trigger required' })
      return sendJson(res, 201, { job: scheduler.add(body) })
    }
    if (req.method === 'POST' && /^\/api\/jobs\/[^/]+\/(run|enable|disable)$/.test(path)) {
      const scheduler = ctx.get<any>('scheduler')
      if (!scheduler) return sendJson(res, 404, { error: 'scheduler not mounted' })
      const [, , , id, action] = path.split('/')
      if (action === 'run') return sendJson(res, 200, { run: await scheduler.runNow(id) })
      return sendJson(res, 200, { job: scheduler.enable(id, action === 'enable') })
    }
    if (req.method === 'GET' && /^\/api\/jobs\/[^/]+\/runs$/.test(path)) {
      const scheduler = ctx.get<any>('scheduler')
      if (!scheduler) return sendJson(res, 404, { error: 'scheduler not mounted' })
      const id = path.split('/')[3]
      return sendJson(res, 200, { runs: scheduler.runs(id) })
    }
    if (req.method === 'GET' && path === '/api/vault') {
      const vault = ctx.get<any>('vault')
      if (!vault) return sendJson(res, 404, { error: 'vault not mounted' })
      return sendJson(res, 200, { items: vault.list() })
    }
    if (req.method === 'POST' && path === '/api/vault') {
      const vault = ctx.get<any>('vault')
      if (!vault) return sendJson(res, 404, { error: 'vault not mounted' })
      const body = await readBody(req)
      if (!body.name || !body.secret) return sendJson(res, 400, { error: 'name and secret required' })
      return sendJson(res, 201, { item: vault.add({ kind: body.kind ?? 'login', name: body.name, origin: body.origin, username: body.username, secret: body.secret }) })
    }
    if (req.method === 'DELETE' && path.startsWith('/api/vault/')) {
      const vault = ctx.get<any>('vault')
      if (!vault) return sendJson(res, 404, { error: 'vault not mounted' })
      const id = path.slice('/api/vault/'.length)
      return sendJson(res, 200, { removed: vault.remove(id) })
    }
    if (req.method === 'POST' && /^\/api\/vault\/[^/]+\/fill$/.test(path)) {
      const vault = ctx.get<any>('vault')
      const computer = ctx.get<any>('computer')
      if (!vault || !computer) return sendJson(res, 404, { error: 'vault or computer not mounted' })
      const id = path.split('/')[3]
      const body = await readBody(req)
      const botId = body.botId ?? 'default'
      const client = await computer.client(botId)
      const origin = body.origin ?? await client.evaluate<string>('location.origin')
      return sendJson(res, 200, await vault.fill(id, { client, botId, origin }))
    }
    if (req.method === 'POST' && path === '/api/vault/secure-form') {
      const vault = ctx.get<any>('vault')
      if (!vault) return sendJson(res, 404, { error: 'vault not mounted' })
      const body = await readBody(req)
      if (!body.origin || !body.purpose) return sendJson(res, 400, { error: 'origin and purpose required' })
      const token = vault.createSecureForm({ origin: body.origin, purpose: body.purpose, kind: body.kind })
      return sendJson(res, 201, { token, url: `/secure/${token}` })
    }
    if (req.method === 'GET' && path.startsWith('/secure/')) {
      const vault = ctx.get<any>('vault')
      if (!vault) return sendJson(res, 404, { error: 'vault not mounted' })
      const token = path.slice('/secure/'.length)
      const html = `<!doctype html><html><body style="font-family:system-ui;max-width:420px;margin:60px auto">
<h2>jaryn secure form</h2>
<form method="post" action="/secure/${token}">
  <label>Username <input name="username" autocomplete="username"></label><br><br>
  <label>Password <input name="password" type="password" autocomplete="current-password"></label><br><br>
  <button type="submit">保存到 Vault</button>
</form></body></html>`
      res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' })
      return void res.end(html)
    }
    if (req.method === 'POST' && path.startsWith('/secure/')) {
      const vault = ctx.get<any>('vault')
      if (!vault) return sendJson(res, 404, { error: 'vault not mounted' })
      const token = path.slice('/secure/'.length)
      const raw = (await readRaw(req)).toString('utf8')
      const form = new URLSearchParams(raw)
      try {
        const item = vault.consumeSecureForm(token, {
          username: form.get('username') ?? undefined,
          secret: { username: form.get('username') ?? undefined, password: form.get('password') ?? '' },
        })
        res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' })
        return void res.end(`<!doctype html><html><body style="font-family:system-ui;max-width:420px;margin:60px auto"><h2>已保存</h2><p>${item.name} 已写入 Vault。</p></body></html>`)
      } catch (err) {
        return sendJson(res, 400, { error: (err as Error).message })
      }
    }
    if (req.method === 'GET' && path === '/api/computer') {
      const computer = ctx.get<any>('computer')
      if (!computer) return sendJson(res, 404, { error: 'computer not mounted' })
      return sendJson(res, 200, { status: computer.status(url.searchParams.get('botId') ?? 'default') })
    }
    if (req.method === 'POST' && /^\/api\/computer\/(start|stop|snapshot)$/.test(path)) {
      const computer = ctx.get<any>('computer')
      if (!computer) return sendJson(res, 404, { error: 'computer not mounted' })
      const action = path.split('/').at(-1)
      const botId = url.searchParams.get('botId') ?? 'default'
      if (action === 'start') return sendJson(res, 200, { instance: await computer.start(botId) })
      if (action === 'stop') { await computer.stop(botId); return sendJson(res, 200, { ok: true }) }
      return sendJson(res, 200, { path: await computer.snapshot(botId, url.searchParams.get('label') ?? undefined) })
    }
    if (req.method === 'GET' && path === '/api/computer/screenshot') {
      const computer = ctx.get<any>('computer')
      if (!computer) return sendJson(res, 404, { error: 'computer not mounted' })
      const client = await computer.client(url.searchParams.get('botId') ?? 'default')
      const png = Buffer.from(await client.screenshot(), 'base64')
      res.writeHead(200, { 'content-type': 'image/png' })
      return void res.end(png)
    }
    if (req.method === 'GET' && path === '/api/memory') {
      const memory = ctx.get<any>('memory')
      if (!memory) return sendJson(res, 404, { error: 'memory not mounted' })
      const ns = url.searchParams.get('ns') ?? 'global'
      const query = url.searchParams.get('query')
      const kind = url.searchParams.get('kind')
      if (query) return sendJson(res, 200, { memories: memory.search({ ns, query, limit: 10 }) })
      if (kind) return sendJson(res, 200, { memories: memory.list({ ns, kind, limit: 50 }) })
      return sendJson(res, 200, { categories: memory.catalog(ns), stats: memory.stats(ns) })
    }
    if (req.method === 'POST' && path === '/api/memory') {
      const memory = ctx.get<any>('memory')
      if (!memory) return sendJson(res, 404, { error: 'memory not mounted' })
      const body = await readBody(req)
      if (!body.text) return sendJson(res, 400, { error: 'text required' })
      const item = memory.remember({ ns: body.ns ?? 'global', text: String(body.text), kind: body.kind ?? 'fact', pinned: !!body.pinned })
      return sendJson(res, 201, { item })
    }
    if (req.method === 'DELETE' && path.startsWith('/api/memory/')) {
      const memory = ctx.get<any>('memory')
      if (!memory) return sendJson(res, 404, { error: 'memory not mounted' })
      const id = path.slice('/api/memory/'.length)
      return sendJson(res, 200, { removed: memory.forget({ id, ns: url.searchParams.get('ns') ?? 'global' }) })
    }
    if (req.method === 'GET' && path === '/api/bots') {
      const bots = ctx.get<any>('bots')
      if (!bots) return sendJson(res, 404, { error: 'bots not mounted' })
      return sendJson(res, 200, { bots: bots.list() })
    }
    if (req.method === 'POST' && path === '/api/bots') {
      const bots = ctx.get<any>('bots')
      if (!bots) return sendJson(res, 404, { error: 'bots not mounted' })
      const body = await readBody(req)
      if (!body.id) return sendJson(res, 400, { error: 'id required' })
      return sendJson(res, 201, { bot: bots.add({ id: String(body.id), name: body.name, persona: body.persona }) })
    }
    if (req.method === 'GET' && path === '/api/tasks') {
      const tasks = ctx.get<any>('tasks')
      if (!tasks) return sendJson(res, 404, { error: 'tasks not mounted' })
      return sendJson(res, 200, { tasks: tasks.list() })
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

async function readRaw(req: IncomingMessage): Promise<Buffer> {
  const chunks: Buffer[] = []
  let size = 0
  for await (const chunk of req) {
    size += (chunk as Buffer).length
    if (size > 1_000_000) throw new Error('body too large')
    chunks.push(chunk as Buffer)
  }
  return Buffer.concat(chunks)
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
