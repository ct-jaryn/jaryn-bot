import { randomUUID } from 'node:crypto'
import { definePlugin } from '@jaryn/kernel'
import type { Plugin } from '@jaryn/kernel'
import type { Risk } from './types.ts'

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
  /** Test/CLI hook; default is fail-closed (deny). */
  answerer?: (req: ApprovalRequest) => Promise<ApprovalDecision>
}

export function createApprovalService(cfg: ApprovalPluginConfig = {}): ApprovalService {
  const ask = new Set(cfg.askRisks ?? DEFAULT_ASK_RISKS)
  const timeoutMs = cfg.timeoutMs ?? 30 * 60_000
  return {
    async request(req, signal) {
      if (!ask.has(req.risk)) return 'allowed'
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
}

export function approvalPlugin(cfg: ApprovalPluginConfig = {}): Plugin<ApprovalPluginConfig> {
  return definePlugin({
    name: '@jaryn/agent-core/approvals',
    provides: ['approvals'],
    apply(ctx, config) {
      const local = createApprovalService({ ...cfg, ...config })
      const ask = new Set((config.askRisks ?? cfg.askRisks ?? DEFAULT_ASK_RISKS) as Risk[])
      ctx.provide('approvals', {
        async request(req: ApprovalRequest, signal?: AbortSignal): Promise<ApprovalDecision> {
          const channel = ctx.get<ApprovalService>('approvalChannel')
          if (channel && ask.has(req.risk)) return channel.request(req, signal)
          return local.request(req, signal)
        },
      })
    },
  })
}

export function newApprovalId(): string {
  return `ap_${randomUUID()}`
}
