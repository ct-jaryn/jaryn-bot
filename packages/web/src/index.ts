import { createServer } from 'node:http'
import { createHash, randomBytes, timingSafeEqual } from 'node:crypto'
import type { IncomingMessage, Server, ServerResponse } from 'node:http'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { basename, join, resolve } from 'node:path'
import type { Context } from '@jaryn/kernel'
import { newApprovalId } from '@jaryn/agent-core'
import { renderPageDocument } from '@jaryn/pages'
import { TunnelServer } from '@jaryn/tunnel'
import { buildAuthorizeUrl, exchangeOAuthCode, refreshOAuthToken } from '@jaryn/connectors'
import { WsClientServer } from './ws-client.ts'
import type { ApprovalDecision, ApprovalRequest, ApprovalService } from '@jaryn/agent-core'

export interface WebOptions {
  host?: string
  port?: number
  approvalTimeoutMs?: number
  apiToken?: string
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
  const apiToken = opts.apiToken ?? process.env.JARY_API_TOKEN
  if (!apiToken && host !== '127.0.0.1' && host !== 'localhost' && host !== '::1') {
    console.warn(`[jaryn] WARNING: serving on ${host} without JARY_API_TOKEN; anyone who can reach this port has owner access`)
  }

  // Short-lived tickets let browsers put a credential in a stream URL (EventSource/img
  // cannot send headers) without leaking the long-lived API token into proxy logs/history.
  const streamTickets = new Map<string, number>()
  const STREAM_PATHS = new Set(['/api/stream', '/api/computer/screen', '/api/computer/mjpeg'])
  const issueStreamTicket = (): { ticket: string; expiresAt: number } => {
    const now = Date.now()
    for (const [ticket, expiresAt] of streamTickets) if (expiresAt <= now) streamTickets.delete(ticket)
    const ticket = randomBytes(24).toString('hex')
    const expiresAt = now + 10 * 60_000
    streamTickets.set(ticket, expiresAt)
    return { ticket, expiresAt }
  }
  const validStreamTicket = (ticket: string): boolean => (streamTickets.get(ticket) ?? 0) > Date.now()
  const isTicketAllowedPath = (path: string): boolean => STREAM_PATHS.has(path) || path.startsWith('/pages/')

  const safeEqual = (a: string, b: string): boolean => {
    if (!a || !b) return false
    const ha = createHash('sha256').update(a).digest()
    const hb = createHash('sha256').update(b).digest()
    return timingSafeEqual(ha, hb)
  }

  // Per-IP sliding-window guard against token / pairing brute-force on public deployments.
  const authFailures = new Map<string, { count: number; resetAt: number }>()
  const AUTH_FAIL_LIMIT = 20
  const AUTH_WINDOW_MS = 60_000
  const clientIp = (req: IncomingMessage): string => {
    const remote = req.socket.remoteAddress ?? 'unknown'
    if (remote === '127.0.0.1' || remote === '::1' || remote === '::ffff:127.0.0.1') {
      const realIp = String(req.headers['x-real-ip'] ?? '').trim()
      if (realIp) return realIp
    }
    return remote
  }
  const isRateLimited = (ip: string): boolean => {
    const entry = authFailures.get(ip)
    if (!entry) return false
    if (entry.resetAt <= Date.now()) { authFailures.delete(ip); return false }
    return entry.count >= AUTH_FAIL_LIMIT
  }
  const recordAuthAttempt = (ip: string): void => {
    const now = Date.now()
    for (const [k, v] of authFailures) if (v.resetAt <= now) authFailures.delete(k)
    const entry = authFailures.get(ip)
    if (!entry || entry.resetAt <= now) authFailures.set(ip, { count: 1, resetAt: now + AUTH_WINDOW_MS })
    else entry.count++
  }

  // OAuth `state` values created by /api/oauth/authorize/:id (single process, 10 min TTL).
  const oauthStates = new Map<string, number>()

  const authorized = (req: IncomingMessage, url: URL): boolean => {
    if (!apiToken) return true
    const header = String(req.headers.authorization ?? '')
    const bearer = header.startsWith('Bearer ') ? header.slice(7) : ''
    const queryToken = url.searchParams.get('token') ?? ''
    const provided = bearer || queryToken
    if (provided && safeEqual(provided, apiToken)) return true
    const devices = ctx.get<any>('devices')
    return !!(provided && devices?.verify?.(provided))
  }

  const clients = new Set<{ res: ServerResponse; sessionId: string }>()
  const pendingQuestions = new Map<string, { resolve: (answer: string) => void; timer: NodeJS.Timeout }>()
  const pending = new Map<string, { req: ApprovalRequest; resolve: (d: ApprovalDecision) => void; timer: NodeJS.Timeout }>()

  const broadcast = (sessionId: string, event: unknown) => {
    const payload = `data: ${JSON.stringify(event)}\n\n`
    for (const client of clients) {
      if (client.sessionId === '*' || client.sessionId === sessionId || sessionId === '*') client.res.write(payload)
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

  const questionChannel = {
    async ask(input: { sessionId: string; question: string; options?: string[] }, signal?: AbortSignal) {
      const id = `q_${Math.random().toString(36).slice(2, 10)}`
      return await new Promise<string>((resolve) => {
        const finish = (answer: string) => {
          const entry = pendingQuestions.get(id)
          if (!entry) return
          clearTimeout(entry.timer)
          pendingQuestions.delete(id)
          broadcast(input.sessionId, { type: 'question.resolved', id })
          resolve(answer)
        }
        const timer = setTimeout(() => finish('no answer (timed out); proceed with your best judgement'), 10 * 60_000)
        pendingQuestions.set(id, { resolve: finish, timer })
        broadcast(input.sessionId, { type: 'question', id, question: input.question, options: input.options ?? [] })
        signal?.addEventListener('abort', () => finish('cancelled'), { once: true })
      })
    },
  }
  // Lets other transports (e.g. /ws/client JSON-RPC) resolve pending approvals.
  ctx.provide('pendingApprovals', {
    list: () => [...pending.values()].map((entry) => entry.req),
    resolve: (id: string, decision: ApprovalDecision) => {
      const entry = pending.get(id)
      if (!entry) return false
      entry.resolve(decision)
      return true
    },
  })
  if (!ctx.has('questionChannel')) ctx.provide('questionChannel', questionChannel)
  if (!ctx.has('questions')) ctx.provide('questions', questionChannel)

  // Register only when the composition does not provide one (tests/local).
  if (!ctx.has('approvalChannel')) ctx.provide('approvalChannel', approvals)
  if (!ctx.has('approvals')) {
    ctx.provide('approvals', {
      request: async (req: ApprovalRequest, signal?: AbortSignal) => {
        if (!ASK_RISKS.has(req.risk)) return 'allowed'
        return approvals.request(req, signal)
      },
    } satisfies ApprovalService)
  }

  const tunnel = new TunnelServer()
  tunnel.onConnect = (proxyUrl) => {
    const computer = ctx.get<any>('computer')
    computer?.setProxy?.(proxyUrl)
  }
  if (!ctx.has('tunnel')) ctx.provide('tunnel', tunnel)

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

    res.setHeader('x-content-type-options', 'nosniff')
    res.setHeader('referrer-policy', 'no-referrer')
    res.setHeader('x-frame-options', 'DENY')
    res.setHeader(
      'content-security-policy',
      "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; connect-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'self'",
    )

    const publicPaths = new Set(['/healthz', '/', '/index.html', '/app.js', '/style.css', '/manifest.json', '/sw.js', '/icon.svg'])
    const publicApi =
      // Pairing a device is public by design (the device only knows the one-time code);
      // *creating* a code requires owner authentication.
      path === '/api/devices/pair' ||
      // OAuth providers redirect the browser here without our bearer token; the
      // handler validates `state` instead.
      path.startsWith('/api/oauth/callback/')
    // Inbound mail may authenticate with its own shared secret instead of the API token.
    const emailSecret = process.env.JARY_EMAIL_SECRET
    const emailSecretAuth = path === '/api/email/inbound' && !!emailSecret &&
      safeEqual(String(req.headers['x-jary-email-secret'] ?? ''), emailSecret)
    const needsAuth = (path.startsWith('/api/') && !publicApi && !emailSecretAuth) || path === '/metrics' || path.startsWith('/pages/')
    const ip = clientIp(req)
    if (isRateLimited(ip)) return sendJson(res, 429, { error: 'too many failed authentication attempts; try again later' })
    if (path === '/api/devices/pair') recordAuthAttempt(ip)
    const ticket = url.searchParams.get('ticket') ?? ''
    const ticketOk = !!ticket && isTicketAllowedPath(path) && validStreamTicket(ticket)
    if (needsAuth && !ticketOk && !authorized(req, url)) {
      recordAuthAttempt(ip)
      return sendJson(res, 401, { error: 'unauthorized' })
    }
    void publicPaths

    if (req.method === 'GET' && (path === '/' || path === '/index.html')) return sendFile(res, 'index.html', 'text/html')
    if (req.method === 'GET' && path === '/app.js') return sendFile(res, 'app.js', 'text/javascript')
    if (req.method === 'GET' && path === '/style.css') return sendFile(res, 'style.css', 'text/css')
    if (req.method === 'GET' && path === '/manifest.json') return sendFile(res, 'manifest.json', 'application/manifest+json')
    if (req.method === 'GET' && path === '/sw.js') return sendFile(res, 'sw.js', 'text/javascript')
    if (req.method === 'GET' && path === '/icon.svg') return sendFile(res, 'icon.svg', 'image/svg+xml')
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
      return sendJson(res, 200, { sessions: store.listSessions({ includeArchived: url.searchParams.get('archived') === '1' }) })
    }
    if ((req.method === 'PATCH' || req.method === 'POST') && /^\/api\/sessions\/[^/]+$/.test(path) && req.method === 'PATCH') {
      const store = ctx.get<any>('store')
      const id = path.split('/')[3]!
      if (!store.getSession(id)) return sendJson(res, 404, { error: 'not found' })
      const body = await readBody(req)
      if (typeof body.title === 'string') store.setSessionTitle(id, body.title)
      if (typeof body.archived === 'boolean') store.archiveSession(id, body.archived)
      return sendJson(res, 200, { session: store.getSession(id) })
    }
    if (req.method === 'DELETE' && /^\/api\/sessions\/[^/]+$/.test(path)) {
      const store = ctx.get<any>('store')
      const id = path.split('/')[3]!
      return sendJson(res, 200, { deleted: store.deleteSession(id) })
    }
    if (req.method === 'POST' && /^\/api\/sessions\/[^/]+\/fork$/.test(path)) {
      const store = ctx.get<any>('store')
      const id = path.split('/')[3]!
      const body = await readBody(req).catch(() => ({}))
      const newId = body.id ?? `${id}-fork-${Date.now().toString(36)}`
      try {
        const session = store.forkSession(id, newId, { upToSeq: body.upToSeq })
        return sendJson(res, 201, { session })
      } catch (err) {
        return sendJson(res, 400, { error: (err as Error).message })
      }
    }
    if (req.method === 'POST' && path === '/api/sessions') {
      const body = await readBody(req)
      const store = ctx.get<any>('store')
      const id = body.id ?? `s_${Date.now().toString(36)}`
      const botId = body.botId ?? 'default'
      const bots = ctx.get<any>('bots')
      const cwd = body.cwd ?? bots?.workspaceFor?.(botId, process.cwd()) ?? process.cwd()
      const session = store.createSession(id, botId, cwd)
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
      if (body.trigger?.kind === 'webhook' && !body.trigger?.secret) {
        return sendJson(res, 400, { error: 'webhook triggers require a secret (unsigned webhooks are refused)' })
      }
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
    if (req.method === 'POST' && path === '/api/devices/pair-code') {
      const devices = ctx.get<any>('devices')
      if (!devices) return sendJson(res, 404, { error: 'devices not mounted' })
      return sendJson(res, 201, devices.createPairCode())
    }
    if (req.method === 'POST' && path === '/api/devices/pair') {
      const devices = ctx.get<any>('devices')
      if (!devices) return sendJson(res, 404, { error: 'devices not mounted' })
      const body = await readBody(req)
      try {
        return sendJson(res, 201, devices.pair(String(body.code ?? ''), String(body.name ?? 'device')))
      } catch (err) {
        return sendJson(res, 400, { error: (err as Error).message })
      }
    }
    if (req.method === 'POST' && path === '/api/devices/revoke-all') {
      const devices = ctx.get<any>('devices')
      if (!devices) return sendJson(res, 404, { error: 'devices not mounted' })
      return sendJson(res, 200, { revoked: devices.revokeAll() })
    }
    if (req.method === 'POST' && /^\/api\/devices\/[^/]+\/revoke$/.test(path)) {
      const devices = ctx.get<any>('devices')
      if (!devices) return sendJson(res, 404, { error: 'devices not mounted' })
      return sendJson(res, 200, { revoked: devices.revoke(path.split('/')[3]!) })
    }
    if (req.method === 'GET' && path === '/api/devices') {
      const devices = ctx.get<any>('devices')
      if (!devices) return sendJson(res, 404, { error: 'devices not mounted' })
      return sendJson(res, 200, { devices: devices.list() })
    }
    if (req.method === 'POST' && /^\/api\/devices\/[^/]+\/revoke$/.test(path)) {
      const devices = ctx.get<any>('devices')
      if (!devices) return sendJson(res, 404, { error: 'devices not mounted' })
      const id = path.split('/')[3]
      return sendJson(res, 200, { revoked: devices.revoke(id) })
    }
    if (req.method === 'GET' && path === '/api/initiative') {
      const initiative = ctx.get<any>('initiative')
      if (!initiative) return sendJson(res, 404, { error: 'initiative not mounted' })
      return sendJson(res, 200, { proposals: initiative.list(url.searchParams.get('botId') ?? undefined) })
    }
    if (req.method === 'POST' && path === '/api/initiative/scan') {
      const initiative = ctx.get<any>('initiative')
      if (!initiative) return sendJson(res, 404, { error: 'initiative not mounted' })
      return sendJson(res, 200, { created: initiative.scan() })
    }
    if (req.method === 'POST' && /^\/api\/initiative\/[^/]+\/(accept|dismiss)$/.test(path)) {
      const initiative = ctx.get<any>('initiative')
      if (!initiative) return sendJson(res, 404, { error: 'initiative not mounted' })
      const [, , , id, action] = path.split('/')
      const body = await readBody(req).catch(() => ({}))
      if (action === 'accept') {
        const proposal = initiative.accept(id)
        const tasks = ctx.get<any>('tasks')
        const task = tasks ? tasks.create({ sessionId: `initiative:${proposal.id}`, title: proposal.title, body: proposal.reason }) : undefined
        return sendJson(res, 200, { proposal, task })
      }
      return sendJson(res, 200, { proposal: initiative.dismiss(id, !!body.mute) })
    }
    if (req.method === 'GET' && path === '/api/teach') {
      const teach = ctx.get<any>('teach')
      if (!teach) return sendJson(res, 404, { error: 'teach not mounted' })
      return sendJson(res, 200, { skills: teach.list() })
    }
    if (req.method === 'POST' && path === '/api/teach') {
      const teach = ctx.get<any>('teach')
      if (!teach) return sendJson(res, 404, { error: 'teach not mounted' })
      const body = await readBody(req)
      if (!body.title) return sendJson(res, 400, { error: 'title required' })
      return sendJson(res, 201, teach.save({ title: body.title, markdown: body.markdown, steps: body.steps }))
    }
    if (req.method === 'GET' && path === '/api/pages') {
      const pages = ctx.get<any>('pages')
      if (!pages) return sendJson(res, 404, { error: 'pages not mounted' })
      return sendJson(res, 200, { pages: pages.list() })
    }
    if (req.method === 'POST' && path === '/api/pages') {
      const pages = ctx.get<any>('pages')
      if (!pages) return sendJson(res, 404, { error: 'pages not mounted' })
      const body = await readBody(req)
      if (!body.title) return sendJson(res, 400, { error: 'title required' })
      return sendJson(res, 201, { page: pages.create({ title: body.title, html: body.html, data: body.data, template: body.template }) })
    }
    if (req.method === 'POST' && /^\/api\/pages\/[^/]+\/share$/.test(path)) {
      const pages = ctx.get<any>('pages')
      if (!pages) return sendJson(res, 404, { error: 'pages not mounted' })
      const id = path.split('/')[3]
      const body = await readBody(req).catch(() => ({}))
      return sendJson(res, 200, pages.share(id, body.enabled !== false, body.ttlHours ? Number(body.ttlHours) * 3600_000 : undefined))
    }
    if (req.method === 'GET' && /^\/api\/pages\/[^/]+\/versions$/.test(path)) {
      const pages = ctx.get<any>('pages')
      if (!pages) return sendJson(res, 404, { error: 'pages not mounted' })
      return sendJson(res, 200, { versions: pages.versions(path.split('/')[3]!) })
    }
    if (req.method === 'POST' && /^\/api\/pages\/[^/]+\/rollback$/.test(path)) {
      const pages = ctx.get<any>('pages')
      if (!pages) return sendJson(res, 404, { error: 'pages not mounted' })
      const body = await readBody(req)
      try {
        return sendJson(res, 200, { page: pages.rollback(path.split('/')[3]!, Number(body.version)) })
      } catch (err) {
        return sendJson(res, 400, { error: (err as Error).message })
      }
    }
    if (req.method === 'GET' && /^\/api\/pages\/[^/]+\/export$/.test(path)) {
      const pages = ctx.get<any>('pages')
      if (!pages) return sendJson(res, 404, { error: 'pages not mounted' })
      const id = path.split('/')[3]!
      try {
        const html = pages.exportHtml(id)
        res.writeHead(200, { 'content-type': 'text/html; charset=utf-8', 'content-disposition': `attachment; filename="${id}.html"` })
        return void res.end(html)
      } catch (err) {
        return sendJson(res, 404, { error: (err as Error).message })
      }
    }
    if (req.method === 'GET' && path.startsWith('/pages/')) {
      const pages = ctx.get<any>('pages')
      if (!pages) return sendJson(res, 404, { error: 'pages not mounted' })
      const page = pages.get(path.slice('/pages/'.length))
      if (!page) return sendJson(res, 404, { error: 'not found' })
      res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' })
      return void res.end(renderPageDocument(page))
    }
    if (req.method === 'GET' && path.startsWith('/p/')) {
      const pages = ctx.get<any>('pages')
      if (!pages) return sendJson(res, 404, { error: 'pages not mounted' })
      const page = pages.byToken(path.slice('/p/'.length))
      if (!page) return sendJson(res, 404, { error: 'not found' })
      res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' })
      return void res.end(renderPageDocument(page))
    }
    if (req.method === 'GET' && path === '/api/artifacts') {
      const artifacts = ctx.get<any>('artifacts')
      if (!artifacts) return sendJson(res, 404, { error: 'artifacts not mounted' })
      return sendJson(res, 200, { artifacts: artifacts.list() })
    }
    if (req.method === 'POST' && path === '/api/artifacts') {
      const artifacts = ctx.get<any>('artifacts')
      if (!artifacts) return sendJson(res, 404, { error: 'artifacts not mounted' })
      const body = await readBody(req)
      if (!body.name || body.content === undefined) return sendJson(res, 400, { error: 'name and content required' })
      return sendJson(res, 201, { artifact: artifacts.save({ name: body.name, content: body.content, mime: body.mime }) })
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
    if (req.method === 'GET' && path === '/api/computer/screen') {
      const computer = ctx.get<any>('computer')
      if (!computer) return sendJson(res, 404, { error: 'computer not mounted' })
      const botId = url.searchParams.get('botId') ?? 'default'
      const fps = Math.max(0.5, Math.min(Number(url.searchParams.get('fps') ?? 2), 10))
      res.writeHead(200, { 'content-type': 'text/event-stream', 'cache-control': 'no-cache', connection: 'keep-alive' })
      let closed = false
      let stopStream: (() => void) | undefined
      req.on('close', () => { closed = true; stopStream?.() })
      if (url.searchParams.get('mode') === 'screencast') {
        try {
          stopStream = await computer.streamFrames(botId, (frame: { image: string; ts: number }) => {
            if (closed) return
            res.write(`data: ${JSON.stringify({ type: 'frame', ...frame })}\n\n`)
          }, { quality: Number(url.searchParams.get('quality') ?? 55) })
        } catch (err) {
          res.write(`data: ${JSON.stringify({ type: 'error', message: (err as Error).message })}\n\n`)
        }
        return
      }
      const tick = async () => {
        if (closed) return
        try {
          const frame = await computer.frame(botId)
          res.write(`data: ${JSON.stringify({ type: 'frame', ...frame })}\n\n`)
        } catch (err) {
          res.write(`data: ${JSON.stringify({ type: 'error', message: (err as Error).message })}\n\n`)
        }
      }
      void tick()
      const timer = setInterval(tick, Math.round(1000 / fps))
      req.on('close', () => clearInterval(timer))
      return
    }
    if (req.method === 'GET' && path === '/api/computer/mjpeg') {
      const computer = ctx.get<any>('computer')
      if (!computer) return sendJson(res, 404, { error: 'computer not mounted' })
      const botId = url.searchParams.get('botId') ?? 'default'
      const quality = Number(url.searchParams.get('quality') ?? 55)
      res.writeHead(200, {
        'content-type': 'multipart/x-mixed-replace; boundary=frame',
        'cache-control': 'no-cache',
        connection: 'close',
        pragma: 'no-cache',
      })
      res.flushHeaders?.()
      let closed = false
      let stop: (() => void) | undefined
      req.on('close', () => { closed = true; stop?.() })
      const writeFrame = (image: string) => {
        if (closed) return
        const data = Buffer.from(image, 'base64')
        res.write(`--frame\r\nContent-Type: image/jpeg\r\nContent-Length: ${data.length}\r\n\r\n`)
        res.write(data)
        res.write('\r\n')
      }
      try {
        // Send one immediate frame so clients have something to render right away.
        const first = await computer.frame(botId)
        writeFrame(first.image)
        stop = await computer.streamFrames(botId, (frame: { image: string }) => {
          writeFrame(frame.image)
        }, { quality })
      } catch (err) {
        if (!res.headersSent) return sendJson(res, 500, { error: (err as Error).message })
        res.end()
      }
      return
    }
    if (req.method === 'POST' && path === '/api/computer/takeover') {
      const computer = ctx.get<any>('computer')
      if (!computer) return sendJson(res, 404, { error: 'computer not mounted' })
      const body = await readBody(req)
      return sendJson(res, 200, computer.takeover(body.botId ?? 'default', !!body.enabled))
    }
    if (req.method === 'POST' && path === '/api/computer/input') {
      const computer = ctx.get<any>('computer')
      if (!computer) return sendJson(res, 404, { error: 'computer not mounted' })
      const body = await readBody(req)
      await computer.input(body.botId ?? 'default', body.event ?? {})
      return sendJson(res, 200, { ok: true })
    }
    if (req.method === 'GET' && path === '/api/tunnel') {
      const tunnelServer = ctx.get<any>('tunnel')
      if (!tunnelServer) return sendJson(res, 404, { error: 'tunnel not mounted' })
      return sendJson(res, 200, tunnelServer.status())
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
    if (req.method === 'POST' && path === '/api/email/inbound') {
      const store = ctx.get<any>('store')
      if (!store) return sendJson(res, 404, { error: 'store not mounted' })
      const secret = process.env.JARY_EMAIL_SECRET
      if (secret && String(req.headers['x-jary-email-secret'] ?? '') !== secret) return sendJson(res, 401, { error: 'invalid email secret' })
      const body = await readBody(req)
      const sessionId = String(body.sessionId ?? 'email')
      if (!store.getSession(sessionId)) store.createSession(sessionId, 'default', process.cwd())
      const event = store.append({
        sessionId, type: 'input.email', actorKind: 'system', provenance: 'web',
        data: { from: body.from ?? '', subject: body.subject ?? '', text: String(body.text ?? '').slice(0, 20_000) },
      })
      return sendJson(res, 202, { accepted: true, event: event.seq })
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
    if (req.method === 'POST' && /^\/api\/sessions\/[^/]+\/command$/.test(path)) {
      const store = ctx.get<any>('store')
      const sessionId = path.split('/')[3]!
      const session = store.getSession(sessionId)
      if (!session) return sendJson(res, 404, { error: 'session not found' })
      const body = await readBody(req)
      const command = String(body.command ?? '').trim()
      if (command === '/status') {
        const usage = store.usageTotal?.(sessionId) ?? {}
        return sendJson(res, 200, { session, usage, tools: ctx.get<any>('tools')?.list?.().length ?? 0 })
      }
      if (command === '/help') {
        return sendJson(res, 200, { commands: ['/status', '/compact', '/new', '/stop', '/memory', '/forget <词>', '/remember <文本>', '/artifacts', '/jobs', '/bots', '/approvals', '/help'] })
      }
      if (command === '/stop') {
        const agent = ctx.get<any>('agent')
        return sendJson(res, 200, { cancelled: agent?.cancel?.(sessionId) ?? false })
      }
      if (command === '/memory') {
        const memory = ctx.get<any>('memory')
        if (!memory) return sendJson(res, 404, { error: 'memory not mounted' })
        const ns = session.botId ? `bot:${session.botId}` : 'global'
        return sendJson(res, 200, { ns, categories: memory.catalog(ns), stats: memory.stats(ns) })
      }
      if (command.startsWith('/remember ')) {
        const memory = ctx.get<any>('memory')
        if (!memory) return sendJson(res, 404, { error: 'memory not mounted' })
        const text = command.slice('/remember '.length).trim()
        if (!text) return sendJson(res, 400, { error: 'nothing to remember' })
        const ns = session.botId ? `bot:${session.botId}` : 'global'
        return sendJson(res, 201, { item: memory.remember({ ns, text, kind: 'fact', source: 'user' }) })
      }
      if (command.startsWith('/forget ')) {
        const memory = ctx.get<any>('memory')
        if (!memory) return sendJson(res, 404, { error: 'memory not mounted' })
        const query = command.slice('/forget '.length).trim()
        const ns = session.botId ? `bot:${session.botId}` : 'global'
        return sendJson(res, 200, { deleted: memory.forget({ ns, query }) })
      }
      if (command === '/artifacts') {
        const artifacts = ctx.get<any>('artifacts')
        return sendJson(res, 200, { artifacts: artifacts?.list?.() ?? [] })
      }
      if (command === '/jobs') {
        const scheduler = ctx.get<any>('scheduler')
        return sendJson(res, 200, { jobs: scheduler?.list?.() ?? [] })
      }
      if (command === '/bots') {
        const bots = ctx.get<any>('bots')
        return sendJson(res, 200, { bots: bots?.list?.() ?? [] })
      }
      if (command === '/approvals') {
        return sendJson(res, 200, { pending: [...pending.values()].map((entry) => entry.req) })
      }
      if (command === '/new') {
        const newId = `s_${Date.now().toString(36)}`
        const bots = ctx.get<any>('bots')
        const botId = session.botId ?? 'default'
        store.createSession(newId, botId, bots?.workspaceFor?.(botId, process.cwd()) ?? process.cwd())
        return sendJson(res, 201, { session: store.getSession(newId) })
      }
      if (command === '/compact') {
        const agent = ctx.get<any>('agent')
        if (!agent?.runTurn) return sendJson(res, 503, { error: 'agent unavailable' })
        void agent.runTurn({ sessionId, text: '/compact', provenance: 'owner' }).catch(() => undefined)
        return sendJson(res, 202, { accepted: true })
      }
      return sendJson(res, 400, { error: `unknown command: ${command}` })
    }
    if (req.method === 'POST' && path.startsWith('/api/sessions/') && path.endsWith('/cancel')) {
      const sessionId = path.split('/')[3]!
      const agent = ctx.get<any>('agent')
      const cancelled = agent?.cancel?.(sessionId) ?? false
      return sendJson(res, 200, { cancelled })
    }
    if (req.method === 'GET' && path.startsWith('/api/oauth/authorize/')) {
      const connectorId = path.slice('/api/oauth/authorize/'.length)
      const env = (name: string) => process.env[`JARY_OAUTH_${name}_${connectorId.toUpperCase()}`]
      const authorizeUrl = env('AUTHORIZE_URL')
      const clientId = env('CLIENT_ID')
      const redirectUri = env('REDIRECT_URI') ?? `${url.origin}/api/oauth/callback/${connectorId}`
      if (!authorizeUrl || !clientId) {
        return sendJson(res, 500, {
          error: `oauth not configured for ${connectorId}`,
          needed: [`JARY_OAUTH_AUTHORIZE_URL_${connectorId.toUpperCase()}`, `JARY_OAUTH_CLIENT_ID_${connectorId.toUpperCase()}`],
        })
      }
      const state = randomBytes(18).toString('hex')
      oauthStates.set(state, Date.now() + 10 * 60_000)
      const scopes = (env('SCOPES') ?? '').split(/[,\s]+/).filter(Boolean)
      const authorize = buildAuthorizeUrl({
        id: connectorId, name: connectorId, baseUrl: '', tools: [],
        auth: { type: 'oauth2', authorizeUrl, clientId, redirectUri, scopes },
      } as any, state)
      return sendJson(res, 200, { url: authorize, state, expiresInMs: 10 * 60_000 })
    }
    if (req.method === 'GET' && path.startsWith('/api/oauth/callback/')) {
      const connectorId = path.slice('/api/oauth/callback/'.length)
      const code = url.searchParams.get('code') ?? ''
      const state = url.searchParams.get('state') ?? ''
      if (!code) return sendJson(res, 400, { error: 'missing code' })
      // CSRF protection is mandatory: either a state created by
      // /api/oauth/authorize/:id (10 min TTL) or a configured static state must match.
      const envState = process.env[`JARY_OAUTH_STATE_${connectorId.toUpperCase()}`]
      const issued = oauthStates.get(state)
      const issuedOk = !!issued && issued > Date.now()
      if (issuedOk) oauthStates.delete(state)
      if (!state) return sendJson(res, 400, { error: 'missing oauth state' })
      if (!issuedOk && !(envState && envState === state)) {
        return sendJson(res, 400, { error: 'invalid or expired oauth state; start from /api/oauth/authorize/:id' })
      }
      const tokenUrl = process.env[`JARY_OAUTH_TOKEN_URL_${connectorId.toUpperCase()}`]
      const clientId = process.env[`JARY_OAUTH_CLIENT_ID_${connectorId.toUpperCase()}`]
      const clientSecret = process.env[`JARY_OAUTH_CLIENT_SECRET_${connectorId.toUpperCase()}`]
      const redirectUri = `${url.origin}/api/oauth/callback/${connectorId}`
      if (!tokenUrl || !clientId) return sendJson(res, 500, { error: `oauth not configured for ${connectorId}` })
      try {
        const tokens = await exchangeOAuthCode({ tokenUrl, clientId, clientSecret, redirectUri, code })
        const vault = ctx.get<any>('vault')
        const connectors = ctx.get<any>('connectors')
        const stored = vault?.add?.({
          kind: 'oauth', name: `${connectorId} oauth`, origin: url.origin,
          secret: { access_token: (tokens as any).access_token, refresh_token: (tokens as any).refresh_token, expires_in: (tokens as any).expires_in },
        })
        connectors?.setToken?.(connectorId, String((tokens as any).access_token ?? ''))
        ctx.get<any>('store')?.audit?.('oauth.connected', connectorId, { vaultItem: stored?.id })
        res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' })
        return void res.end('<!doctype html><html><body style="font-family:system-ui;max-width:420px;margin:60px auto"><h2>已连接</h2><p>可以关闭此页面，回到 jaryn。</p></body></html>')
      } catch (err) {
        return sendJson(res, 502, { error: (err as Error).message })
      }
    }
    if (req.method === 'GET' && path === '/api/notifications') {
      const notifications = ctx.get<any>('notifications')
      if (!notifications) return sendJson(res, 404, { error: 'notifications not mounted' })
      return sendJson(res, 200, { notifications: notifications.list({ limit: Number(url.searchParams.get('limit') ?? 50), unreadOnly: url.searchParams.get('unread') === '1' }), unread: notifications.unreadCount() })
    }
    if (req.method === 'POST' && path === '/api/notifications/read-all') {
      const notifications = ctx.get<any>('notifications')
      if (!notifications) return sendJson(res, 404, { error: 'notifications not mounted' })
      return sendJson(res, 200, { marked: notifications.markAllRead() })
    }
    if (req.method === 'POST' && /^\/api\/notifications\/[^/]+\/read$/.test(path)) {
      const notifications = ctx.get<any>('notifications')
      if (!notifications) return sendJson(res, 404, { error: 'notifications not mounted' })
      const id = Number(path.split('/')[3])
      return sendJson(res, 200, { read: notifications.markRead(id) })
    }
    if (req.method === 'POST' && path.startsWith('/api/oauth/refresh/')) {
      const connectorId = path.slice('/api/oauth/refresh/'.length)
      const tokenUrl = process.env[`JARY_OAUTH_TOKEN_URL_${connectorId.toUpperCase()}`]
      const clientId = process.env[`JARY_OAUTH_CLIENT_ID_${connectorId.toUpperCase()}`]
      const clientSecret = process.env[`JARY_OAUTH_CLIENT_SECRET_${connectorId.toUpperCase()}`]
      if (!tokenUrl || !clientId) return sendJson(res, 500, { error: `oauth not configured for ${connectorId}` })
      const vault = ctx.get<any>('vault')
      const connectors = ctx.get<any>('connectors')
      const items = vault?.list?.() ?? []
      const stored = items.find((item: any) => item.kind === 'oauth' && String(item.name).startsWith(connectorId))
      const secret = stored ? vault.reveal?.(stored.id)?.secret : undefined
      if (!secret?.refresh_token) return sendJson(res, 400, { error: `no refresh token for ${connectorId}` })
      try {
        const tokens = await refreshOAuthToken({ tokenUrl, clientId, clientSecret, refreshToken: String(secret.refresh_token) })
        if ((tokens as any).access_token) {
          vault.rotate?.(stored.id, { ...secret, access_token: (tokens as any).access_token, expires_in: (tokens as any).expires_in })
          connectors?.setToken?.(connectorId, String((tokens as any).access_token))
        }
        ctx.get<any>('store')?.audit?.('oauth.refreshed', connectorId, { ok: true })
        return sendJson(res, 200, { refreshed: true, expiresIn: (tokens as any).expires_in })
      } catch (err) {
        return sendJson(res, 502, { error: (err as Error).message })
      }
    }
    if (req.method === 'POST' && path === '/api/stream-ticket') {
      return sendJson(res, 201, issueStreamTicket())
    }
    if (req.method === 'GET' && path === '/api/usage') {
      const store = ctx.get<any>('store')
      if (!store?.usageTotal) return sendJson(res, 404, { error: 'usage unavailable' })
      return sendJson(res, 200, store.usageTotal(url.searchParams.get('sessionId') ?? undefined))
    }
    if (req.method === 'GET' && path === '/api/audit') {
      const store = ctx.get<any>('store')
      if (!store?.auditLog) return sendJson(res, 404, { error: 'audit unavailable' })
      return sendJson(res, 200, { entries: store.auditLog(Number(url.searchParams.get('limit') ?? 50)) })
    }
    if (req.method === 'GET' && path === '/api/rules') {
      const rules = ctx.get<any>('approvalRules')
      return sendJson(res, 200, { rules: rules?.rules?.list?.() ?? [] })
    }
    if (req.method === 'POST' && path === '/api/rules') {
      const rules = ctx.get<any>('approvalRules')
      if (!rules?.rules) return sendJson(res, 404, { error: 'rules unavailable' })
      const body = await readBody(req)
      if (!body.effect || !['allow', 'ask', 'deny'].includes(body.effect)) return sendJson(res, 400, { error: 'effect must be allow|ask|deny' })
      rules.rules.addRule(body)
      const store = ctx.get<any>('store')
      store?.audit?.('rule.added', body.tool ?? body.risk?.join(',') ?? '*', body)
      return sendJson(res, 201, { rules: rules.rules.list() })
    }
    if (req.method === 'GET' && path === '/api/questions') {
      return sendJson(res, 200, { pending: [...pendingQuestions.keys()] })
    }
    if (req.method === 'POST' && path.startsWith('/api/questions/')) {
      const id = path.slice('/api/questions/'.length)
      const entry = pendingQuestions.get(id)
      if (!entry) return sendJson(res, 404, { error: 'question not found' })
      const body = await readBody(req)
      entry.resolve(String(body.answer ?? ''))
      return sendJson(res, 200, { ok: true })
    }
    if (req.method === 'POST' && path === '/api/message') {
      const body = await readBody(req)
      const text = String(body.text ?? '').trim()
      if (!text) return sendJson(res, 400, { error: 'text required' })
      const store = ctx.get<any>('store')
      const sessionId = String(body.sessionId ?? 'web')
      if (!store.getSession(sessionId)) {
        const bots = ctx.get<any>('bots')
        const botId = String(body.botId ?? 'default')
        store.createSession(sessionId, botId, body.cwd ?? bots?.workspaceFor?.(botId, process.cwd()) ?? process.cwd())
      }
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

  // Restore OAuth tokens stored in the Vault so connectors work after a restart.
  try {
    const vault = ctx.get<any>('vault')
    const connectors = ctx.get<any>('connectors')
    if (vault && connectors) {
      for (const item of vault.list() ?? []) {
        if (item.kind !== 'oauth') continue
        const secret = vault.reveal?.(item.id)?.secret
        if (secret?.access_token) {
          const id = String(item.name).split(' ')[0]
          connectors.setToken?.(id, String(secret.access_token))
        }
      }
    }
  } catch { /* vault/connectors optional */ }

  const wsClient = new WsClientServer(ctx, {
    // Same rules as HTTP: JARY_API_TOKEN bearer, ?token=, or a paired device token.
    authorize: (req, url) => authorized(req, url),
  })
  wsClient.attach(server)
  ctx.provide('wsClient', wsClient)

  // The egress tunnel lets a client's network carry server traffic; it must not be open
  // to anonymous upgraders, otherwise anyone can register as the egress.
  tunnel.attach(server, { authorize: (req, url) => authorized(req as any, url) })
  await new Promise<void>((resolve) => server.listen(port, host, resolve))
  const address = server.address()
  const actualPort = typeof address === 'object' && address ? address.port : port
  const url = `http://${host}:${actualPort}`
  return {
    url,
    server,
    async close() {
      tunnel.close()
      for (const client of clients) client.res.end()
      clients.clear()
      for (const p of pending.values()) {
        clearTimeout(p.timer)
        p.resolve('denied')
      }
      pending.clear()
      for (const q of pendingQuestions.values()) {
        clearTimeout(q.timer)
        q.resolve('cancelled')
      }
      pendingQuestions.clear()
      wsClient.close()
      // Upgraded sockets (WS) are not tracked by server.close(); force them down first.
      ;(server as any).closeAllConnections?.()
      await new Promise<void>((resolve) => {
        server.close(() => resolve())
        ;(server as any).closeAllConnections?.()
      })
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
