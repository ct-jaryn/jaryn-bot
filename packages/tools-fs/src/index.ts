import { mkdir, readFile, readdir, stat, writeFile } from 'node:fs/promises'
import { dirname } from 'node:path'
import { isAbsolute, relative, resolve, sep } from 'node:path'
import { definePlugin } from '@jaryn/kernel'
import type { Plugin } from '@jaryn/kernel'
import type { Tool, ToolRunContext } from '@jaryn/agent-core'

const IGNORE = new Set(['.git', 'node_modules', 'dist', 'build', '.next', 'data', '.DS_Store'])
const MAX_READ = 100_000
const MAX_LIST = 200
const MAX_GLOB = 200
const MAX_GREP = 50

const toPosix = (p: string): string => p.replaceAll('\\', '/')

function safeRoot(cwd: string): string {
  return resolve(cwd)
}

function resolveInside(root: string, p: string): string {
  const target = resolve(root, p ?? '.')
  const rel = relative(root, target)
  if (rel.startsWith('..') || isAbsolute(rel)) throw new Error(`path escapes workspace: ${p}`)
  return target
}

async function walk(root: string, dir: string, depth: number, out: string[], maxDepth: number): Promise<void> {
  if (depth > maxDepth || out.length >= MAX_GLOB * 4) return
  const entries = await readdir(dir, { withFileTypes: true })
  for (const entry of entries) {
    if (IGNORE.has(entry.name)) continue
    const full = resolve(dir, entry.name)
    if (entry.isDirectory()) await walk(root, full, depth + 1, out, maxDepth)
    else if (entry.isFile()) out.push(toPosix(relative(root, full)))
  }
}

function globToRegex(pattern: string): RegExp {
  let out = ''
  for (let i = 0; i < pattern.length; i++) {
    const ch = pattern[i]!
    if (ch === '*') {
      if (pattern[i + 1] === '*') {
        if (pattern[i + 2] === '/') { out += '(?:.*/)?'; i += 2 }
        else { out += '.*'; i++ }
      } else out += '[^/]*'
    } else if (ch === '?') out += '.'
    else out += ch.replace(/[.+^${}()|[\]\\]/g, '\\$&')
  }
  return new RegExp(`^${out}$`)
}

export function fsTools(): Tool[] {
  return [
    {
      name: 'fs.read',
      description: 'Read a UTF-8 text file inside the workspace.',
      risk: 'read',
      schema: { type: 'object', properties: { path: { type: 'string' } }, required: ['path'] },
      async execute(args, ctx: ToolRunContext) {
        const root = safeRoot(ctx.cwd)
        const file = resolveInside(root, String(args.path ?? ''))
        const text = await readFile(file, 'utf8')
        if (text.length > MAX_READ) return text.slice(0, MAX_READ) + `\n...[truncated ${text.length - MAX_READ} chars]`
        return text
      },
    },
    {
      name: 'fs.write',
      description: 'Create or overwrite a UTF-8 text file inside the workspace (parent dirs created).',
      risk: 'write',
      schema: {
        type: 'object',
        properties: { path: { type: 'string' }, content: { type: 'string' } },
        required: ['path', 'content'],
      },
      async execute(args, ctx: ToolRunContext) {
        const root = safeRoot(ctx.cwd)
        const file = resolveInside(root, String(args.path ?? ''))
        const content = String(args.content ?? '')
        if (content.length > MAX_READ) throw new Error(`content too large (${content.length} > ${MAX_READ})`)
        await mkdir(dirname(file), { recursive: true })
        await writeFile(file, content, 'utf8')
        return { path: toPosix(relative(root, file)), bytes: Buffer.byteLength(content) }
      },
    },
    {
      name: 'fs.edit',
      description: 'Replace a literal string in a file (must be unique unless all=true).',
      risk: 'write',
      schema: {
        type: 'object',
        properties: {
          path: { type: 'string' },
          old: { type: 'string' },
          new: { type: 'string' },
          all: { type: 'boolean' },
        },
        required: ['path', 'old', 'new'],
      },
      async execute(args, ctx: ToolRunContext) {
        const root = safeRoot(ctx.cwd)
        const file = resolveInside(root, String(args.path ?? ''))
        const oldText = String(args.old ?? '')
        if (!oldText) throw new Error('old string is required')
        const text = await readFile(file, 'utf8')
        const count = text.split(oldText).length - 1
        if (count === 0) throw new Error('old string not found')
        if (count > 1 && !args.all) throw new Error(`old string appears ${count} times; pass all=true or make it unique`)
        const next = args.all ? text.split(oldText).join(String(args.new ?? '')) : text.replace(oldText, String(args.new ?? ''))
        await writeFile(file, next, 'utf8')
        return { path: toPosix(relative(root, file)), replaced: args.all ? count : 1 }
      },
    },
    {
      name: 'fs.list',
      description: 'List a directory inside the workspace (names only, capped).',
      risk: 'read',
      schema: { type: 'object', properties: { path: { type: 'string' }, depth: { type: 'number' } } },
      async execute(args, ctx: ToolRunContext) {
        const root = safeRoot(ctx.cwd)
        const dir = resolveInside(root, String(args.path ?? '.'))
        const depth = Math.min(Number(args.depth ?? 1), 3)
        const out: string[] = []
        await walk(root, dir, 0, out, depth)
        const files = out.slice(0, MAX_LIST)
        return files.join('\n') + (out.length > MAX_LIST ? `\n...[truncated ${out.length - MAX_LIST}]` : '')
      },
    },
    {
      name: 'fs.glob',
      description: 'Find files by glob pattern (e.g. src/**/*.ts) inside the workspace.',
      risk: 'read',
      schema: { type: 'object', properties: { pattern: { type: 'string' } }, required: ['pattern'] },
      async execute(args, ctx: ToolRunContext) {
        const root = safeRoot(ctx.cwd)
        const re = globToRegex(String(args.pattern ?? '*'))
        const files: string[] = []
        await walk(root, root, 0, files, 12)
        const matches = files.filter((f) => re.test(f)).slice(0, MAX_GLOB)
        return matches.join('\n') || '(no matches)'
      },
    },
    {
      name: 'fs.grep',
      description: 'Search file contents with a regex inside the workspace (capped).',
      risk: 'read',
      schema: {
        type: 'object',
        properties: { pattern: { type: 'string' }, include: { type: 'string' } },
        required: ['pattern'],
      },
      async execute(args, ctx: ToolRunContext) {
        const root = safeRoot(ctx.cwd)
        const re = new RegExp(String(args.pattern ?? ''), 'i')
        const include = args.include ? globToRegex(String(args.include)) : undefined
        const files: string[] = []
        await walk(root, root, 0, files, 12)
        const hits: string[] = []
        for (const file of files) {
          if (include && !include.test(file)) continue
          const full = resolve(root, file)
          const st = await stat(full)
          if (st.size > 1_000_000) continue
          const text = await readFile(full, 'utf8')
          if (text.includes('\u0000')) continue
          const lines = text.split('\n')
          for (let i = 0; i < lines.length; i++) {
            if (re.test(lines[i]!)) {
              hits.push(`${file}:${i + 1}: ${lines[i]!.trim().slice(0, 200)}`)
              if (hits.length >= MAX_GREP) return hits.join('\n')
            }
          }
        }
        return hits.join('\n') || '(no matches)'
      },
    },
  ]
}

export function fsPlugin(cfg: { root?: string } = {}): Plugin<{ root?: string }> {
  return definePlugin({
    name: '@jaryn/tools-fs',
    inject: ['tools'],
    apply(ctx, config = {}) {
      const tools = ctx.get<{ register(t: Tool): () => void }>('tools')!
      const root = config.root ?? cfg.root
      for (const tool of fsTools()) {
        const wrapped: Tool = root
          ? { ...tool, execute: (args, c) => tool.execute(args, { ...c, cwd: resolve(root) }) }
          : tool
        ctx.effect(() => tools.register(wrapped))
      }
    },
  })
}
