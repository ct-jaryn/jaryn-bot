import { definePlugin } from '@jaryn/kernel'
import type { Plugin } from '@jaryn/kernel'
import type { ModelDelta, ModelRequest, Provider } from '@jaryn/agent-core'

export type Script = ModelDelta[][]

export class FakeProvider implements Provider {
  name = 'fake'
  private turns: Script
  requests: ModelRequest[] = []

  constructor(script: Script = []) {
    this.turns = script
  }

  async *stream(req: ModelRequest): AsyncIterable<ModelDelta> {
    this.requests.push(req)
    const turn = this.turns.shift() ?? [
      { type: 'text' as const, text: `echo: ${req.messages.at(-1)?.content ?? ''}` },
      { type: 'finish' as const, reason: 'stop' as const },
    ]
    for (const delta of turn) yield delta
  }
}

export function fakeProviderPlugin(script: Script = []): Plugin<{ script?: Script }> {
  return definePlugin({
    name: '@jaryn/testing/fake-provider',
    provides: ['llm'],
    apply(ctx, cfg) {
      ctx.provide('llm', new FakeProvider(cfg.script ?? script))
    },
  })
}

/** A provider that emits one deterministic text reply (used by CLI chat). */
export function echoProviderPlugin(): Plugin {
  return definePlugin({
    name: '@jaryn/testing/echo',
    provides: ['llm'],
    apply(ctx) {
      ctx.provide('llm', {
        name: 'echo',
        async *stream(req: ModelRequest): AsyncIterable<ModelDelta> {
          const last = req.messages.at(-1)?.content ?? ''
          yield { type: 'text', text: `echo: ${last}` }
          yield { type: 'finish', reason: 'stop' }
        },
      } satisfies Provider)
    },
  })
}
