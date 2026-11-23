import { definePlugin } from '@jaryn/kernel'
import type { Plugin } from '@jaryn/kernel'
import type { Tool } from '@jaryn/agent-core'
import { MemoryStore } from './store.ts'
import type { MemoryKind } from './store.ts'

export { MemoryStore } from './store.ts'
export { tokenize, jaccard } from './tokenizer.ts'
export type { Memory, MemoryKind, RememberInput } from './store.ts'

export interface MemoryConfig {
  ns?: string
}

export function memoryPlugin(cfg: MemoryConfig = {}): Plugin<MemoryConfig> {
  return definePlugin({
    name: '@jaryn/memory',
    provides: ['memory', 'memoryNs'],
    inject: ['store'],
    apply(ctx, config = {}) {
      const store = ctx.get<any>('store')
      const memory = new MemoryStore(store.db)
      ctx.provide('memory', memory)
      ctx.provide('memoryNs', config.ns ?? cfg.ns ?? 'global')
    },
  })
}

export function memoryToolsPlugin(): Plugin {
  return definePlugin({
    name: '@jaryn/memory/tools',
    inject: ['memory', 'memoryNs', 'tools'],
    apply(ctx) {
      const memory = ctx.get<MemoryStore>('memory')!
      const ns = ctx.get<string>('memoryNs') ?? 'global'
      const tools = ctx.get<{ register(t: Tool): () => void }>('tools')!
      const toolsList: Tool[] = [
        {
          name: 'memory.remember',
          description: 'Store a durable fact, preference or rule for future turns.',
          risk: 'write',
          schema: {
            type: 'object',
            properties: {
              text: { type: 'string' },
              kind: { type: 'string', enum: ['fact', 'preference', 'rule'] },
              pinned: { type: 'boolean' },
            },
            required: ['text'],
          },
          async execute(args) {
            const m = memory.remember({ ns, text: String(args.text ?? ''), kind: (args.kind as MemoryKind) ?? 'fact', pinned: !!args.pinned })
            return { id: m.id, text: m.text }
          },
        },
        {
          name: 'memory.search',
          description: 'Search long-term memory by keywords.',
          risk: 'read',
          schema: { type: 'object', properties: { query: { type: 'string' }, limit: { type: 'number' } }, required: ['query'] },
          async execute(args) {
            return memory.search({ ns, query: String(args.query ?? ''), limit: Number(args.limit ?? 5) })
          },
        },
        {
          name: 'memory.catalog',
          description: 'List memory categories and counts (browse without loading everything).',
          risk: 'read',
          schema: { type: 'object', properties: {} },
          async execute() {
            return { ns, categories: memory.catalog(ns), stats: memory.stats(ns) }
          },
        },
        {
          name: 'memory.list',
          description: 'List memory entries by kind or tag.',
          risk: 'read',
          schema: { type: 'object', properties: { kind: { type: 'string' }, tag: { type: 'string' }, limit: { type: 'number' } } },
          async execute(args) {
            return memory.list({ ns, kind: args.kind ? String(args.kind) : undefined, tag: args.tag ? String(args.tag) : undefined, limit: Number(args.limit ?? 20) })
          },
        },
        {
          name: 'memory.read',
          description: 'Read one memory entry by id.',
          risk: 'read',
          schema: { type: 'object', properties: { id: { type: 'string' } }, required: ['id'] },
          async execute(args) {
            return memory.get(String(args.id ?? '')) ?? { error: 'not found' }
          },
        },
        {
          name: 'memory.forget',
          description: 'Delete a memory by id or matching keywords.',
          risk: 'write',
          schema: { type: 'object', properties: { id: { type: 'string' }, query: { type: 'string' } } },
          async execute(args) {
            return { deleted: memory.forget({ id: args.id ? String(args.id) : undefined, query: args.query ? String(args.query) : undefined, ns }) }
          },
        },
      ]
      for (const tool of toolsList) ctx.effect(() => tools.register(tool))
    },
  })
}
