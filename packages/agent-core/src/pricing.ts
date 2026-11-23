import { definePlugin } from '@jaryn/kernel'
import type { Plugin } from '@jaryn/kernel'
import type { Pricing } from './types.ts'

export interface PricingConfig extends Pricing {
  model?: string
}

/** Defaults are DeepSeek list prices (USD per 1M tokens); override via patch. */
export function pricingPlugin(cfg: PricingConfig = {}): Plugin<PricingConfig> {
  return definePlugin({
    name: '@jaryn/agent-core/pricing',
    provides: ['pricing'],
    apply(ctx, config = {}) {
      ctx.provide('pricing', {
        inputPer1M: config.inputPer1M ?? cfg.inputPer1M ?? 0.28,
        outputPer1M: config.outputPer1M ?? cfg.outputPer1M ?? 0.42,
        cacheReadPer1M: config.cacheReadPer1M ?? cfg.cacheReadPer1M ?? 0.028,
      } satisfies Pricing)
    },
  })
}
