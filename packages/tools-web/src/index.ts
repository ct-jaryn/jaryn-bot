import { definePlugin } from '@jaryn/kernel'
import type { Plugin } from '@jaryn/kernel'
import type { Tool } from '@jaryn/agent-core'
import { assertSafeUrl } from './ssrf.ts'

export interface WebConfig {
  search?: { provider?: 'searxng' | 'duckduckgo'; baseUrl?: string; apiKey?: string }
  fetchTimeoutMs?: number
  maxBytes?: number
  maxResults?: number
}

export interface SearchResult {
  title: string
  url: string
  snippet: string
}

export async function searchWeb(query: string, cfg: WebConfig = {}): Promise<{ provider: string; results: SearchResult[] }> {
  const provider = cfg.search?.provider ?? (cfg.search?.baseUrl ? 'searxng' : 'duckduckgo')
  const limit = cfg.maxResults ?? 5
  if (provider === 'searxng') {
    const base = cfg.search?.baseUrl
    if (!base) throw new Error('searxng requires search.baseUrl')
    const url = new URL('/search', base)
    url.searchParams.set('q', query)
    url.searchParams.set('format', 'json')
    const res = await fetch(url, {
      headers: cfg.search?.apiKey ? { authorization: `Bearer ${cfg.search.apiKey}` } : {},
      signal: AbortSignal.timeout(cfg.fetchTimeoutMs ?? 15_000),
    })
    if (!res.ok) throw new Error(`searxng HTTP ${res.status}`)
    const data = await res.json() as any
    const results = (data.results ?? []).slice(0, limit).map((r: any) => ({
      title: String(r.title ?? ''), url: String(r.url ?? ''), snippet: String(r.content ?? '').slice(0, 300),
    }))
    return { provider, results }
  }
  // DuckDuckGo HTML endpoint (no API key). Parsed conservatively.
  const res = await fetch('https://html.duckduckgo.com/html/', {
    method: 'POST',
    headers: {
      'content-type': 'application/x-www-form-urlencoded',
      'user-agent': 'Mozilla/5.0 (compatible; jaryn-bot/1.1)',
    },
    body: new URLSearchParams({ q: query }).toString(),
    signal: AbortSignal.timeout(cfg.fetchTimeoutMs ?? 15_000),
  })
  if (!res.ok) throw new Error(`duckduckgo HTTP ${res.status}`)
  const html = await res.text()
  const results: SearchResult[] = []
  for (const match of html.matchAll(/<a[^>]+class="result__a"[^>]*href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/g)) {
    const raw = match[1]!
    const href = raw.startsWith('//duckduckgo.com/l/?uddg=') ? decodeURIComponent(raw.split('uddg=')[1]!.split('&')[0]!) : raw
    results.push({ title: stripTags(match[2]!), url: href, snippet: '' })
    if (results.length >= limit) break
  }
  if (results.length === 0) throw new Error('search returned no parseable results (configure a searxng endpoint for reliability)')
  return { provider, results }
}

export async function fetchPage(rawUrl: string, cfg: WebConfig = {}): Promise<{ url: string; status: number; title: string; text: string }> {
  const url = await assertSafeUrl(rawUrl)
  const res = await fetch(url, {
    headers: { 'user-agent': 'Mozilla/5.0 (compatible; jaryn-bot/1.1)', accept: 'text/html,application/xhtml+xml,text/plain' },
    redirect: 'follow',
    signal: AbortSignal.timeout(cfg.fetchTimeoutMs ?? 20_000),
  })
  if (res.url && res.url !== url.toString()) await assertSafeUrl(res.url)
  const type = res.headers.get('content-type') ?? ''
  if (!/text\/|json|xml/.test(type)) throw new Error(`unsupported content-type: ${type}`)
  const maxBytes = cfg.maxBytes ?? 2_000_000
  const reader = res.body?.getReader()
  let received = 0
  const chunks: Uint8Array[] = []
  if (reader) {
    while (true) {
      const { done, value } = await reader.read()
      if (done) break
      received += value.byteLength
      if (received > maxBytes) { chunks.push(value.subarray(0, Math.max(0, maxBytes - (received - value.byteLength)))); break }
      chunks.push(value)
    }
  }
  const raw = Buffer.concat(chunks).toString('utf8')
  const text = /html|xml/.test(type) ? htmlToText(raw) : raw
  return { url: res.url || url.toString(), status: res.status, title: (raw.match(/<title[^>]*>([\s\S]*?)<\/title>/i)?.[1] ?? '').trim(), text: text.slice(0, 20_000) }
}

export function stripTags(html: string): string {
  return html.replace(/<[^>]+>/g, '').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/\s+/g, ' ').trim()
}

export function htmlToText(html: string): string {
  return stripTags(
    html
      .replace(/<script[\s\S]*?<\/script>/gi, ' ')
      .replace(/<style[\s\S]*?<\/style>/gi, ' ')
      .replace(/<\/(p|div|li|h[1-6]|tr|br)>/gi, '\n'),
  )
}

export function webTools(cfg: WebConfig = {}): Tool[] {
  return [
    {
      name: 'web.search',
      description: 'Search the web and return titles, URLs and snippets. Configure search.baseUrl (searxng) for reliability.',
      risk: 'network',
      schema: { type: 'object', properties: { query: { type: 'string' }, limit: { type: 'number' } }, required: ['query'] },
      async execute(args) {
        const out = await searchWeb(String(args.query ?? ''), { ...cfg, maxResults: args.limit ? Number(args.limit) : cfg.maxResults })
        return { provider: out.provider, results: out.results.map((r) => ({ title: r.title, url: r.url, snippet: r.snippet })) }
      },
    },
    {
      name: 'web.fetch',
      description: 'Fetch a public web page and return its readable text (SSRF guarded).',
      risk: 'network',
      schema: { type: 'object', properties: { url: { type: 'string' } }, required: ['url'] },
      async execute(args) {
        return await fetchPage(String(args.url ?? ''), cfg)
      },
    },
  ]
}

export function webPlugin(cfg: WebConfig = {}): Plugin<WebConfig> {
  return definePlugin({
    name: '@jaryn/tools-web',
    inject: ['tools'],
    apply(ctx, config = {}) {
      const tools = ctx.get<{ register(t: Tool): () => void }>('tools')!
      for (const tool of webTools({ ...cfg, ...config })) ctx.effect(() => tools.register(tool))
    },
  })
}
