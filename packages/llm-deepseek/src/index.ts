import { definePlugin } from '@jaryn/kernel'
import type { Plugin } from '@jaryn/kernel'
import type { ModelDelta, ModelRequest, Provider, ToolCall } from '@jaryn/agent-core'

export interface DeepSeekConfig {
  apiKey?: string
  baseUrl?: string
  model?: string
  maxTokens?: number
  fetchImpl?: typeof fetch
  retries?: number
}

interface WireMessage {
  role: 'system' | 'user' | 'assistant' | 'tool'
  content: string
  tool_calls?: { id: string; type: 'function'; function: { name: string; arguments: string } }[]
  tool_call_id?: string
}

export class DeepSeekProvider implements Provider {
  readonly name = 'deepseek'
  private cfg: Required<Omit<DeepSeekConfig, 'fetchImpl' | 'maxTokens'>> & { maxTokens?: number; fetchImpl: typeof fetch }

  constructor(cfg: DeepSeekConfig = {}) {
    const hasDeepSeek = Boolean(cfg.apiKey || process.env.DEEPSEEK_API_KEY?.trim())
    const apiKey = (cfg.apiKey ?? process.env.DEEPSEEK_API_KEY?.trim() ?? process.env.OPENAI_API_KEY?.trim() ?? '').trim()
    if (!apiKey) throw new Error('API key missing: set DEEPSEEK_API_KEY, OPENAI_API_KEY, or config.apiKey')
    this.cfg = {
      apiKey,
      baseUrl: cfg.baseUrl ?? process.env.DEEPSEEK_BASE_URL ?? (hasDeepSeek ? 'https://api.deepseek.com/v1' : (process.env.OPENAI_BASE_URL ?? 'https://api.openai.com/v1')),
      model: cfg.model ?? process.env.DEEPSEEK_MODEL ?? (hasDeepSeek ? 'deepseek-chat' : (process.env.OPENAI_MODEL ?? 'gpt-4o-mini')),
      maxTokens: cfg.maxTokens,
      fetchImpl: cfg.fetchImpl ?? fetch,
      retries: cfg.retries ?? 2,
    }
  }

  async *stream(req: ModelRequest, signal: AbortSignal): AsyncIterable<ModelDelta> {
    const body: Record<string, unknown> = {
      model: this.cfg.model,
      messages: req.messages.map(toWire),
      stream: true,
      stream_options: { include_usage: true },
    }
    if (req.tools.length > 0) {
      body.tools = req.tools.map((t) => ({
        type: 'function',
        function: { name: t.name, description: t.description, parameters: t.schema },
      }))
    }
    if (this.cfg.maxTokens) body.max_tokens = this.cfg.maxTokens

    const response = await this.request(body, signal)
    if (!response.body) throw new Error('DeepSeek response has no body')
    yield* parseSse(response.body, signal)
  }

  private async request(body: unknown, signal: AbortSignal): Promise<Response> {
    let lastError: Error | undefined
    for (let attempt = 0; attempt <= this.cfg.retries; attempt++) {
      try {
        const res = await this.cfg.fetchImpl(`${this.cfg.baseUrl}/chat/completions`, {
          method: 'POST',
          headers: {
            'content-type': 'application/json',
            authorization: `Bearer ${this.cfg.apiKey}`,
          },
          body: JSON.stringify(body),
          signal,
        })
        if (res.ok) return res
        const text = await res.text().catch(() => '')
        const retryable = res.status === 429 || res.status >= 500
        lastError = new Error(`DeepSeek HTTP ${res.status}: ${text.slice(0, 300)}`)
        if (!retryable) throw lastError
      } catch (err) {
        if ((err as Error).name === 'AbortError') throw err
        lastError = err as Error
      }
      if (attempt < this.cfg.retries) await delay(100 * 2 ** attempt, signal)
    }
    throw lastError ?? new Error('DeepSeek request failed')
  }
}

export function deepseekPlugin(cfg: DeepSeekConfig = {}): Plugin<DeepSeekConfig> {
  return definePlugin({
    name: '@jaryn/llm-deepseek',
    provides: ['llm'],
    apply(ctx, config) {
      ctx.provide('llm', new DeepSeekProvider({ ...cfg, ...config }))
    },
  })
}

function toWire(m: ModelRequest['messages'][number]): WireMessage {
  if (m.role === 'tool') {
    return { role: 'tool', content: m.content, tool_call_id: m.toolCallId ?? '' }
  }
  if (m.role === 'assistant' && m.toolCalls?.length) {
    return {
      role: 'assistant',
      content: m.content,
      tool_calls: m.toolCalls.map((c) => ({
        id: c.id,
        type: 'function',
        function: { name: c.name, arguments: JSON.stringify(c.args) },
      })),
    }
  }
  return { role: m.role, content: m.content }
}

async function* parseSse(
  body: ReadableStream<Uint8Array>,
  signal: AbortSignal,
): AsyncIterable<ModelDelta> {
  const reader = body.getReader()
  const decoder = new TextDecoder()
  let buffer = ''
  const calls = new Map<number, { id: string; name: string; args: string }>()
  let finish: 'stop' | 'length' | 'tool' = 'stop'

  try {
    while (true) {
      const { value, done } = await reader.read()
      if (done) break
      buffer += decoder.decode(value, { stream: true })
      let idx: number
      while ((idx = buffer.indexOf('\n')) >= 0) {
        const line = buffer.slice(0, idx).trim()
        buffer = buffer.slice(idx + 1)
        if (!line.startsWith('data:')) continue
        const data = line.slice(5).trim()
        if (data === '[DONE]') {
          for (const call of calls.values()) {
            yield { type: 'tool_call', call: { id: call.id, name: call.name, args: safeJson(call.args) } }
          }
          yield { type: 'finish', reason: finish }
          return
        }
        let chunk: any
        try {
          chunk = JSON.parse(data)
        } catch {
          continue
        }
        if (chunk.usage) {
          yield {
            type: 'usage',
            usage: {
              inputTokens: chunk.usage.prompt_tokens,
              outputTokens: chunk.usage.completion_tokens,
              cacheReadTokens: chunk.usage.prompt_cache_hit_tokens,
            },
          }
        }
        const choice = chunk.choices?.[0]
        if (!choice) continue
        const delta = choice.delta ?? {}
        if (delta.reasoning_content) yield { type: 'reasoning', text: delta.reasoning_content }
        if (delta.content) yield { type: 'text', text: delta.content }
        for (const toolDelta of delta.tool_calls ?? []) {
          const slot = calls.get(toolDelta.index) ?? { id: '', name: '', args: '' }
          if (toolDelta.id) slot.id = toolDelta.id
          if (toolDelta.function?.name) slot.name += toolDelta.function.name
          if (toolDelta.function?.arguments) slot.args += toolDelta.function.arguments
          if (!slot.id) slot.id = `call_${toolDelta.index}`
          calls.set(toolDelta.index, slot)
        }
        if (choice.finish_reason === 'tool_calls') finish = 'tool'
        else if (choice.finish_reason === 'length') finish = 'length'
      }
    }
    for (const call of calls.values()) {
      yield { type: 'tool_call', call: { id: call.id, name: call.name, args: safeJson(call.args) } }
    }
    yield { type: 'finish', reason: finish }
  } finally {
    reader.releaseLock()
  }
}

function safeJson(raw: string): Record<string, unknown> {
  try {
    return JSON.parse(raw || '{}')
  } catch {
    return { _raw: raw }
  }
}

function delay(ms: number, signal: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(resolve, ms)
    signal.addEventListener('abort', () => {
      clearTimeout(timer)
      reject(new Error('aborted'))
    }, { once: true })
  })
}
