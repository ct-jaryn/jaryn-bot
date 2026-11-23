import { randomBytes, randomUUID } from 'node:crypto'
import { definePlugin } from '@jaryn/kernel'
import type { Plugin } from '@jaryn/kernel'
import type { Tool } from '@jaryn/agent-core'

export interface Page {
  id: string
  title: string
  html: string
  data?: unknown
  shareToken?: string
  createdAt: number
  updatedAt: number
}

const SCHEMA = `
CREATE TABLE IF NOT EXISTS pages (
  id TEXT PRIMARY KEY,
  title TEXT NOT NULL,
  html TEXT NOT NULL,
  data_json TEXT,
  share_token TEXT,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);
`

export class PagesService {
  private db: any
  constructor(db: any) {
    this.db = db
    this.db.exec(SCHEMA)
  }

  create(input: { title: string; html?: string; data?: unknown; template?: 'table' | 'report' }): Page {
    const id = `page_${randomUUID()}`
    const html = input.html ?? renderTemplate(input.title, input.template ?? 'report', input.data)
    if (html.length > 2 * 1024 * 1024) throw new Error('page too large (2MB)')
    const now = Date.now()
    this.db.prepare(
      'INSERT INTO pages(id, title, html, data_json, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)',
    ).run(id, input.title, html, input.data ? JSON.stringify(input.data) : null, now, now)
    return this.get(id)!
  }

  update(id: string, patch: { title?: string; html?: string; data?: unknown }): Page {
    const page = this.get(id)
    if (!page) throw new Error(`page not found: ${id}`)
    this.db.prepare('UPDATE pages SET title = ?, html = ?, data_json = ?, updated_at = ? WHERE id = ?')
      .run(patch.title ?? page.title, patch.html ?? page.html,
        patch.data !== undefined ? JSON.stringify(patch.data) : page.data ? JSON.stringify(page.data) : null,
        Date.now(), id)
    return this.get(id)!
  }

  get(id: string): Page | undefined {
    const row = this.db.prepare('SELECT * FROM pages WHERE id = ?').get(id) as any
    return row ? toPage(row) : undefined
  }

  list(): Page[] {
    return (this.db.prepare('SELECT * FROM pages ORDER BY updated_at DESC').all() as any[]).map(toPage)
  }

  share(id: string, enabled = true): { token?: string } {
    const page = this.get(id)
    if (!page) throw new Error(`page not found: ${id}`)
    if (!enabled) {
      this.db.prepare('UPDATE pages SET share_token = NULL WHERE id = ?').run(id)
      return {}
    }
    const token = page.shareToken ?? randomBytes(16).toString('hex')
    this.db.prepare('UPDATE pages SET share_token = ? WHERE id = ?').run(token, id)
    return { token }
  }

  byToken(token: string): Page | undefined {
    const row = this.db.prepare('SELECT * FROM pages WHERE share_token = ?').get(token) as any
    return row ? toPage(row) : undefined
  }

  exportHtml(id: string): string {
    const page = this.get(id)
    if (!page) throw new Error(`page not found: ${id}`)
    return page.html
  }
}

function renderTemplate(title: string, template: 'table' | 'report', data: unknown): string {
  const safeTitle = escapeHtml(title)
  const body = template === 'table' && Array.isArray(data)
    ? `<table><thead><tr>${Object.keys(data[0] ?? {}).map((k) => `<th>${escapeHtml(k)}</th>`).join('')}</tr></thead><tbody>${data.map((row: any) => `<tr>${Object.values(row).map((v) => `<td>${escapeHtml(String(v))}</td>`).join('')}</tr>`).join('')}</tbody></table>`
    : `<pre>${escapeHtml(JSON.stringify(data ?? {}, null, 2))}</pre>`
  return `<!doctype html><html><head><meta charset="utf-8"><title>${safeTitle}</title></head><body><h1>${safeTitle}</h1>${body}</body></html>`
}

function escapeHtml(text: string): string {
  return text.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]!)
}

export function renderPageDocument(page: Page): string {
  const csp = "default-src 'none'; style-src 'unsafe-inline'; img-src data:; script-src 'none'"
  return `<!doctype html><html><head><meta charset="utf-8"><meta http-equiv="Content-Security-Policy" content="${csp}"><title>${escapeHtml(page.title)}</title></head><body>${page.html}</body></html>`
}

function toPage(row: any): Page {
  return {
    id: row.id, title: row.title, html: row.html,
    data: row.data_json ? JSON.parse(row.data_json) : undefined,
    shareToken: row.share_token ?? undefined, createdAt: row.created_at, updatedAt: row.updated_at,
  }
}

export function pagesPlugin(): Plugin {
  return definePlugin({
    name: '@jaryn/pages',
    provides: ['pages'],
    inject: ['store'],
    apply(ctx) {
      const store = ctx.get<any>('store')
      ctx.provide('pages', new PagesService(store.db))
    },
  })
}

export function pageToolsPlugin(): Plugin {
  return definePlugin({
    name: '@jaryn/pages/tools',
    inject: ['pages', 'tools'],
    apply(ctx) {
      const pages = ctx.get<PagesService>('pages')!
      const tools = ctx.get<{ register(t: Tool): () => void }>('tools')!
      const list: Tool[] = [
        {
          name: 'pages.create', description: 'Create an interactive page (report/dashboard) from HTML or a table template.', risk: 'write',
          schema: {
            type: 'object',
            properties: {
              title: { type: 'string' }, html: { type: 'string' },
              template: { type: 'string', enum: ['table', 'report'] }, data: {},
            },
            required: ['title'],
          },
          async execute(args) { return pages.create({ title: String(args.title), html: args.html ? String(args.html) : undefined, data: args.data, template: args.template as any }) },
        },
        {
          name: 'pages.update', description: 'Update an existing page.', risk: 'write',
          schema: { type: 'object', properties: { id: { type: 'string' }, title: { type: 'string' }, html: { type: 'string' }, data: {} }, required: ['id'] },
          async execute(args) { return pages.update(String(args.id), { title: args.title ? String(args.title) : undefined, html: args.html ? String(args.html) : undefined, data: args.data }) },
        },
        {
          name: 'pages.list', description: 'List pages.', risk: 'read',
          schema: { type: 'object', properties: {} },
          async execute() { return pages.list() },
        },
        {
          name: 'pages.export', description: 'Export a page as a self-contained HTML document.', risk: 'read',
          schema: { type: 'object', properties: { id: { type: 'string' } }, required: ['id'] },
          async execute(args) { return { html: pages.exportHtml(String(args.id)) } },
        },
        {
          name: 'pages.share', description: 'Create or revoke a read-only share token for a page.', risk: 'external',
          schema: { type: 'object', properties: { id: { type: 'string' }, enabled: { type: 'boolean' } }, required: ['id'] },
          async execute(args) { return pages.share(String(args.id), args.enabled !== false) },
        },
      ]
      for (const tool of list) ctx.effect(() => tools.register(tool))
    },
  })
}
