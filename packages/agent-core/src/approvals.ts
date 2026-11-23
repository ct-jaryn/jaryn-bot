import { randomUUID } from 'node:crypto'
import { definePlugin } from '@jaryn/kernel'
import type { Plugin } from '@jaryn/kernel'
import type { Risk } from './types.ts'
import { GrantStore, RuleEngine, type ApprovalRule } from './rules.ts'

export interface ApprovalRequest {
  id: string
  sessionId: string
  turnId: string
  toolName: string
  risk: Risk
  args: Record<string, unknown>
}

export type ApprovalDecision = 'allowed' | 'denied'

export interface ApprovalService {
  request(req: ApprovalRequest, signal?: AbortSignal): Promise<ApprovalDecision>
}

export const DEFAULT_ASK_RISKS: Risk[] = ['execute', 'external', 'destructive']

export interface ApprovalPluginConfig {
  askRisks?: Risk[]
  timeoutMs?: number
  rules?: ApprovalRule[]
  /** Test/CLI hook; default is fail-closed (deny). */
  answerer?: (req: ApprovalRequest) => Promise<ApprovalDecision>
}

export function createApprovalService(cfg: ApprovalPluginConfig = {}): ApprovalService & {
  rules: RuleEngine
  grants: GrantStore
} {
  const ask = new Set(cfg.askRisks ?? DEFAULT_ASK_RISKS)
  const timeoutMs = cfg.timeoutMs ?? 30 * 60_000
  const rules = new RuleEngine(cfg.rules ?? [])
  const grants = new GrantStore()
  const service = {
    rules,
    grants,
    async request(req, signal) {
      const decision = rules.evaluate({ tool: req.toolName, risk: req.risk, args: req.args })
      if (decision?.effect === 'deny') return 'denied'
      if (decision?.effect === 'allow') return 'allowed'
      if (grants.consume(req.sessionId, req.toolName)) return 'allowed'
      if (!ask.has(req.risk) && !decision) return 'allowed'
      if (cfg.answerer) return cfg.answerer(req)
      return await new Promise<ApprovalDecision>((resolve) => {
        const finish = (d: ApprovalDecision) => {
          clearTimeout(timer)
          signal?.removeEventListener('abort', onAbort)
          resolve(d)
        }
        const timer = setTimeout(() => finish('denied'), timeoutMs)
        const onAbort = () => finish('denied')
        signal?.addEventListener('abort', onAbort, { once: true })
      })
    },
  }
  return service
}

export function approvalPlugin(cfg: ApprovalPluginConfig = {}): Plugin<ApprovalPluginConfig> {
  return definePlugin({
    name: '@jaryn/agent-core/approvals',
    provides: ['approvals'],
    apply(ctx, config = {}) {
      const local = createApprovalService({ ...cfg, ...config })
      const ask = new Set((config.askRisks ?? cfg.askRisks ?? DEFAULT_ASK_RISKS) as Risk[])
      ctx.provide('approvalRules', local)
      ctx.provide('approvals', {
        async request(req: ApprovalRequest, signal?: AbortSignal): Promise<ApprovalDecision> {
          const rule = local.rules.evaluate({ tool: req.toolName, risk: req.risk, args: req.args })
          if (rule?.effect === 'deny') return 'denied'
          if (rule?.effect === 'allow') return 'allowed'
          if (local.grants.consume(req.sessionId, req.toolName)) return 'allowed'
          const needsAsk = rule?.effect === 'ask' || ask.has(req.risk)
          if (!needsAsk) return 'allowed'
          const channel = ctx.get<ApprovalService>('approvalChannel')
          if (channel) return channel.request(req, signal)
          if (cfg.answerer) return local.request(req, signal)
          // No interactive channel: fail closed immediately.
          return 'denied'
        },
      })
    },
  })
}

export function newApprovalId(): string {
  return `ap_${randomUUID()}`
}
