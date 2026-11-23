import { definePlugin } from '@jaryn/kernel'
import type { Plugin } from '@jaryn/kernel'
import { cancelTurn, runTurn } from './loop.ts'

export { cancelTurn, estimateTokens, runTurn } from './loop.ts'
export { toolRegistryPlugin } from './tools.ts'
export type { ToolRegistry } from './tools.ts'
export * from './types.ts'

export function agentPlugin(): Plugin {
  return definePlugin({
    name: '@jaryn/agent-core',
    provides: ['agent'],
    inject: ['store', 'tools', 'llm'],
    apply(ctx) {
      ctx.provide('agent', {
        runTurn: (input: Parameters<typeof runTurn>[1]) => runTurn(ctx, input),
        cancel: (sessionId: string) => cancelTurn(sessionId),
      })
    },
  })
}
