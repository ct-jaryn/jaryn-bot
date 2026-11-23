import { definePlugin } from '@jaryn/kernel'
import type { Plugin } from '@jaryn/kernel'
import type { Tool, ToolRunContext } from './types.ts'

export interface ToolRegistry {
  register(tool: Tool): () => void
  list(): Tool[]
  get(name: string): Tool | undefined
  execute(name: string, args: Record<string, unknown>, ctx: ToolRunContext): Promise<unknown>
}

export function toolRegistryPlugin(): Plugin {
  return definePlugin({
    name: '@jaryn/agent-core/tools',
    provides: ['tools'],
    apply(ctx) {
      const tools = new Map<string, Tool>()
      const registry: ToolRegistry = {
        register(tool) {
          if (tools.has(tool.name)) throw new Error(`tool already registered: ${tool.name}`)
          tools.set(tool.name, tool)
          return () => {
            if (tools.get(tool.name) === tool) tools.delete(tool.name)
          }
        },
        list: () => [...tools.values()],
        get: (name) => tools.get(name),
        async execute(name, args, runCtx) {
          const tool = tools.get(name)
          if (!tool) throw new Error(`unknown tool: ${name}`)
          return tool.execute(args, runCtx)
        },
      }
      ctx.provide('tools', registry)
    },
  })
}
