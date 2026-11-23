import { definePlugin } from '@jaryn/kernel'
import type { Plugin } from '@jaryn/kernel'
import type { Tool } from './types.ts'

export interface QuestionInput {
  sessionId: string
  question: string
  options?: string[]
}

export interface QuestionService {
  ask(input: QuestionInput, signal?: AbortSignal): Promise<string>
}

export function questionsPlugin(): Plugin {
  return definePlugin({
    name: '@jaryn/agent-core/questions',
    provides: ['questions'],
    inject: ['tools'],
    apply(ctx) {
      const questions: QuestionService = {
        async ask(input, signal) {
          const channel = ctx.get<QuestionService>('questionChannel')
          if (channel) return channel.ask(input, signal)
          return 'no interactive channel available; proceed with your best judgement and state your assumption'
        },
      }
      ctx.provide('questions', questions)
      const tools = ctx.get<{ register(t: Tool): () => void }>('tools')!
      ctx.effect(() => tools.register({
        name: 'ask_user',
        description: 'Ask the user a question and wait for their answer (use sparingly, for blocking ambiguity).',
        risk: 'external',
        schema: {
          type: 'object',
          properties: { question: { type: 'string' }, options: { type: 'array', items: { type: 'string' } } },
          required: ['question'],
        },
        async execute(args, runCtx) {
          const service = ctx.get<QuestionService>('questions')!
          const answer = await service.ask({
            sessionId: runCtx.sessionId,
            question: String(args.question ?? ''),
            options: Array.isArray(args.options) ? args.options.map(String) : undefined,
          }, runCtx.signal)
          return { answer }
        },
      }))
    },
  })
}
