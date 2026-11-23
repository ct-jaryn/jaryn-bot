import { definePlugin } from '@jaryn/kernel'
import type { Plugin } from '@jaryn/kernel'
import { cancelTurn, runTurn } from './loop.ts'

export { cancelTurn, estimateTokens, runTurn } from './loop.ts'
export { approvalPlugin, createApprovalService, newApprovalId, DEFAULT_ASK_RISKS } from './approvals.ts'
export { questionsPlugin } from './questions.ts'
export { pricingPlugin } from './pricing.ts'
export type { PricingConfig } from './pricing.ts'
export { GrantStore, RuleEngine, globMatch } from './rules.ts'
export type { ApprovalRule, RuleDecision, RuleEffect, RuleScope } from './rules.ts'
export type { QuestionInput, QuestionService } from './questions.ts'
export type { ApprovalDecision, ApprovalPluginConfig, ApprovalRequest, ApprovalService } from './approvals.ts'
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
