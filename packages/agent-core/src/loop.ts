import { randomUUID } from 'node:crypto'
import type { Context } from '@jaryn/kernel'
import type {
  BudgetLimits,
  EventStore,
  ModelRequest,
  Provider,
  ToolCall,
  TurnInput,
  TurnResult,
} from './types.ts'
import type { ToolRegistry } from './tools.ts'

const DEFAULT_SYSTEM = 'You are jaryn, a self-hosted personal AI teammate. Be concise and useful.'
const DEFAULT_BUDGET: BudgetLimits = { maxSteps: 8, maxToolCalls: 20, maxWallMs: 120_000 }

export async function runTurn(ctx: Context, input: TurnInput): Promise<TurnResult> {
  const store = ctx.get<EventStore>('store')
  const tools = ctx.get<ToolRegistry>('tools')
  const llm = ctx.get<Provider>('llm')
  if (!store) throw new Error('runTurn needs a store service')
  if (!tools) throw new Error('runTurn needs a tools service')
  if (!llm) throw new Error('runTurn needs an llm service')

  const session = store.getSession(input.sessionId) ?? store.createSession(input.sessionId, 'default', process.cwd())
  const limits = ctx.get<BudgetLimits>('budget') ?? DEFAULT_BUDGET
  const turnId = `turn_${randomUUID()}`
  const started = Date.now()
  const toolCalls: ToolCall[] = []
  let text = ''
  let steps = 0
  let finishReason = 'completed'

  const controller = new AbortController()
  const onAbort = () => controller.abort()
  input.signal?.addEventListener('abort', onAbort, { once: true })
  const timer = setTimeout(() => controller.abort(), limits.maxWallMs)

  const append = (type: string, data: unknown, extra: Record<string, unknown> = {}) =>
    store.append({
      sessionId: input.sessionId,
      turnId,
      type,
      data,
      actorKind: input.provenance === 'owner' ? 'owner' : 'worker',
      actorId: input.actorId,
      provenance: input.provenance ?? 'owner',
      ...extra,
    })

  append('input.owner', { text: input.text, provenance: input.provenance ?? 'owner' })
  append('turn.started', { turnId })
  store.setSessionStatus(input.sessionId, 'running')

  try {
    while (true) {
      if (controller.signal.aborted) {
        finishReason = 'aborted'
        break
      }
      if (++steps > limits.maxSteps) {
        finishReason = 'max-steps'
        break
      }
      if (toolCalls.length > limits.maxToolCalls) {
        finishReason = 'max-tool-calls'
        break
      }

      const history = buildHistory(store, input.sessionId)
      const req: ModelRequest = {
        messages: [
          { role: 'system', content: ctx.get<string>('systemPrompt') ?? DEFAULT_SYSTEM },
          ...history,
          { role: 'user', content: input.text },
        ],
        tools: tools.list().map((t) => ({ name: t.name, description: t.description, schema: t.schema })),
      }

      append('step.started', { step: steps })
      let stepText = ''
      const calls: ToolCall[] = []
      for await (const delta of llm.stream(req, controller.signal)) {
        input.onDelta?.(delta)
        if (delta.type === 'text') stepText += delta.text
        if (delta.type === 'tool_call') calls.push(delta.call)
      }
      append('model.response', { text: stepText, calls, provider: llm.name })

      if (stepText) {
        text = stepText
        append('assistant.message', { text: stepText })
      }

      if (calls.length === 0) break

      for (const call of calls) {
        toolCalls.push(call)
        append('tool.call', { id: call.id, name: call.name, args: call.args })
        let result
        try {
          const tool = tools.get(call.name)
          if (!tool) throw new Error(`unknown tool: ${call.name}`)
          const output = await tool.execute(call.args, {
            signal: controller.signal,
            sessionId: input.sessionId,
            cwd: session.cwd,
          })
          result = { id: call.id, name: call.name, ok: true, output }
        } catch (err) {
          result = { id: call.id, name: call.name, ok: false, error: (err as Error).message }
        }
        append('tool.result', result)
        input.onDelta?.({ type: 'tool_call', call })
      }
    }
  } catch (err) {
    finishReason = 'error'
    append('error', { message: (err as Error).message })
  } finally {
    clearTimeout(timer)
    input.signal?.removeEventListener('abort', onAbort)
    store.setSessionStatus(input.sessionId, 'idle')
    append('turn.ended', { turnId, reason: finishReason, steps, toolCalls: toolCalls.length, ms: Date.now() - started })
  }

  return { text, steps, toolCalls: toolCalls.length, finishReason }
}

function buildHistory(store: EventStore, sessionId: string): ModelRequest['messages'] {
  const messages: ModelRequest['messages'] = []
  for (const event of store.events(sessionId)) {
    if (event.type === 'input.owner') {
      const data = event.data as { text?: string }
      if (data?.text) messages.push({ role: 'user', content: data.text })
    } else if (event.type === 'assistant.message') {
      const data = event.data as { text?: string }
      if (data?.text) messages.push({ role: 'assistant', content: data.text })
    }
  }
  return messages
}
