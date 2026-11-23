import { createHash, randomUUID } from 'node:crypto'
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { basename, join } from 'node:path'
import { definePlugin } from '@jaryn/kernel'
import type { Plugin } from '@jaryn/kernel'
import type { Tool } from '@jaryn/agent-core'

export interface ArtifactMeta {
  id: string
  name: string
  mime: string
  bytes: number
  sha256: string
  path: string
  sessionId?: string
  createdAt: number
}

const SCHEMA = `
CREATE TABLE IF NOT EXISTS artifacts (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  mime TEXT NOT NULL,
  bytes INTEGER NOT NULL,
  sha256 TEXT NOT NULL,
  path TEXT NOT NULL,
  session_id TEXT,
  created_at INTEGER NOT NULL
);
`

export class ArtifactService {
  private db: any
  private dir: string
  constructor(db: any, home: string) {
    this.db = db
    this.dir = join(home, 'artifacts')
    mkdirSync(this.dir, { recursive: true })
    this.db.exec(SCHEMA)
  }

  save(input: { content: string | Buffer; name: string; mime?: string; sessionId?: string }): ArtifactMeta {
    const data = typeof input.content === 'string' ? Buffer.from(input.content, 'utf8') : input.content
    if (data.length > 20 * 1024 * 1024) throw new Error('artifact too large (20MB)')
    const id = `art_${randomUUID()}`
    const safeName = basename(input.name).replace(/[^\w.-]+/g, '_') || 'artifact'
    const path = join(this.dir, `${id}-${safeName}`)
    writeFileSync(path, data)
    const meta: ArtifactMeta = {
      id, name: safeName, mime: input.mime ?? 'application/octet-stream', bytes: data.length,
      sha256: createHash('sha256').update(data).digest('hex'), path, sessionId: input.sessionId, createdAt: Date.now(),
    }
    this.db.prepare(
      'INSERT INTO artifacts(id, name, mime, bytes, sha256, path, session_id, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
    ).run(meta.id, meta.name, meta.mime, meta.bytes, meta.sha256, meta.path, meta.sessionId ?? null, meta.createdAt)
    return meta
  }

  list(): ArtifactMeta[] {
    return (this.db.prepare('SELECT * FROM artifacts ORDER BY created_at DESC').all() as any[]).map(toMeta)
  }

  get(id: string): ArtifactMeta | undefined {
    const row = this.db.prepare('SELECT * FROM artifacts WHERE id = ?').get(id) as any
    return row ? toMeta(row) : undefined
  }

  read(id: string): Buffer {
    const meta = this.get(id)
    if (!meta) throw new Error(`artifact not found: ${id}`)
    return readFileSync(meta.path)
  }
}

function toMeta(row: any): ArtifactMeta {
  return {
    id: row.id, name: row.name, mime: row.mime, bytes: row.bytes, sha256: row.sha256,
    path: row.path, sessionId: row.session_id ?? undefined, createdAt: row.created_at,
  }
}

export function artifactsPlugin(cfg: { home?: string } = {}): Plugin<{ home?: string }> {
  return definePlugin({
    name: '@jaryn/artifacts',
    provides: ['artifacts'],
    inject: ['store'],
    apply(ctx, config = {}) {
      const store = ctx.get<any>('store')
      const home = config.home ?? cfg.home ?? process.env.JARY_HOME ?? join(process.cwd(), 'data')
      ctx.provide('artifacts', new ArtifactService(store.db, home))
    },
  })
}

export function artifactToolsPlugin(): Plugin {
  return definePlugin({
    name: '@jaryn/artifacts/tools',
    inject: ['artifacts', 'tools'],
    apply(ctx) {
      const artifacts = ctx.get<ArtifactService>('artifacts')!
      const tools = ctx.get<{ register(t: Tool): () => void }>('tools')!
      const list: Tool[] = [
        {
          name: 'artifact.save', description: 'Save a text/binary artifact and return its id and path.', risk: 'write',
          schema: {
            type: 'object',
            properties: { name: { type: 'string' }, content: { type: 'string' }, mime: { type: 'string' } },
            required: ['name', 'content'],
          },
          async execute(args, runCtx) {
            return artifacts.save({ name: String(args.name), content: String(args.content), mime: args.mime ? String(args.mime) : undefined, sessionId: runCtx.sessionId })
          },
        },
        {
          name: 'artifact.list', description: 'List artifacts.', risk: 'read',
          schema: { type: 'object', properties: {} },
          async execute() { return artifacts.list() },
        },
      ]
      for (const tool of list) ctx.effect(() => tools.register(tool))
    },
  })
}
