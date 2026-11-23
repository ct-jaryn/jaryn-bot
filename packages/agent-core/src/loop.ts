import { randomUUID } from 'node:crypto'
import type { Context } from '@jaryn/kernel'
import type {
  BudgetLimits,
  EventStore,
  ModelDelta,
  ModelMessage,
  ModelRequest,
  Provider,
  ToolCall,
  TurnInput,
  TurnResult,
} from './types.ts'
import type { ToolRegistry } from './tools.ts'
import type { MemoryService, Pricing } from './types.ts'
import { newApprovalId } from './approvals.ts'
import type { ApprovalService } from './approvals.ts'

const DEFAULT_SYSTEM = 'You are jaryn, a self-hosted personal AI teammate. Be concise and useful.'
const DEFAULT_BUDGET: BudgetLimits = { maxSteps: 8, maxToolCalls: 20, maxWallMs: 120_000 }

/** Session id → abort controller for the in-flight turn. */
const active = new Map<string, AbortController>()

export function cancelTurn(sessionId: string): boolean {
  const controller = active.get(sessionId)
  if (!controller) return false
  controller.abort(new Error('cancelled by user'))
  return true
}

export function estimateTokens(text: string): number {
  // Cheap heuristic: CJK ~1.5 chars/token, ASCII ~4 chars/token; use chars/3.
  return Math.ceil(text.length / 3)
}

export async function runTurn(ctx: Context, input: TurnInput): Promise<TurnResult> {
  const store = ctx.get<EventStore>('store')
  const tools = ctx.get<ToolRegistry>('tools')
  const llm = ctx.get<Provider>('llm')
  const approvals = ctx.get<ApprovalService>('approvals')
  const memory = ctx.get<MemoryService>('memory')
  const pricing = ctx.get<Pricing>('pricing')
  const usage = { inputTokens: 0, outputTokens: 0, cacheReadTokens: 0, costUsd: 0 }
  if (!store) throw new Error('runTurn needs a store service')
  if (!tools) throw new Error('runTurn needs a tools service')
  if (!llm) throw new Error('runTurn needs an llm service')

  const session = store.getSession(input.sessionId) ?? store.createSession(input.sessionId, 'default', process.cwd())
  const memoryNs = memory ? `bot:${session.botId ?? 'default'}` : undefined
  const limits = { ...DEFAULT_BUDGET, ...(ctx.get<Partial<BudgetLimits>>('budget') ?? {}), ...(input.limits ?? {}) }
  const contextCfg = ctx.get<{ windowTokens?: number; compactAt?: number }>('context') ?? {}
  const windowTokens = contextCfg.windowTokens ?? 128_000
  const compactAt = contextCfg.compactAt ?? 0.7

  const turnId = `turn_${randomUUID()}`
  const started = Date.now()
  const calledTools: ToolCall[] = []
  let text = ''
  let steps = 0
  let finishReason = 'completed'

  const controller = new AbortController()
  active.set(input.sessionId, controller)
  const onAbort = () => controller.abort()
  input.signal?.addEventListener('abort', onAbort, { once: true })
  const timer = setTimeout(() => controller.abort(new Error('turn timed out')), limits.maxWallMs)

  const append = (type: string, data: unknown) =>
    store.append({
      sessionId: input.sessionId,
      turnId,
      type,
      data,
      actorKind: input.provenance === 'owner' ? 'owner' : 'worker',
      actorId: input.actorId,
      provenance: input.provenance ?? 'owner',
    })

  if (memory && memoryNs) memory.observe?.(memoryNs, input.text)
  const historyMessages = buildHistory(store, input.sessionId)
  append('input.owner', { text: input.text, provenance: input.provenance ?? 'owner' })
  append('turn.started', { turnId })
  store.setSessionStatus(input.sessionId, 'running')

  try {
    let messages: ModelMessage[] = [...historyMessages, { role: 'user', content: input.text }]

    if (sumTokens(messages) > windowTokens * compactAt) {
      const compacted = await compact(ctx, llm, store, input.sessionId, messages, windowTokens)
      if (compacted) {
        messages = compacted.messages
        append('memory.consolidated', { kind: 'compaction', summary: compacted.summary, dropped: compacted.dropped })
      }
    }

    while (true) {
      if (controller.signal.aborted) { finishReason = 'aborted'; break }
      if (limits.maxCostUsd !== undefined && usage.costUsd > limits.maxCostUsd) { finishReason = 'budget'; break }
      if (++steps > limits.maxSteps) { finishReason = 'max-steps'; break }
      if (limits.maxCostUsd !== undefined && usage.costUsd > limits.maxCostUsd) { finishReason = 'budget'; break }
      if (calledTools.length > limits.maxToolCalls) { finishReason = 'max-tool-calls'; break }

      const digest = memory && memoryNs ? memory.digest({ ns: memoryNs, query: input.text, budgetTokens: 600 }) : ''
      const skills = ctx.get<{ catalog(limit?: number): string }>('skills')
      const skillCatalog = skills?.catalog?.(12) ?? ''
      const goals = ctx.get<{ promptSection(sessionId: string): string }>('goals')
      const goalSection = goals?.promptSection?.(input.sessionId) ?? ''
      const system = [ctx.get<string>('systemPrompt') ?? DEFAULT_SYSTEM, goalSection, digest, skillCatalog].filter(Boolean).join('\n\n')
      const req: ModelRequest = {
        messages: [{ role: 'system', content: system }, ...messages.filter((m) => m.role !== 'system')],
        tools: tools.list().map((t) => ({ name: t.name, description: t.description, schema: t.schema })),
      }
      append('step.started', { step: steps })
      let stepText = ''
      const calls: ToolCall[] = []
      for await (const delta of llm.stream(req, controller.signal)) {
        input.onDelta?.(delta)
        if (delta.type === 'text') stepText += delta.text
        if (delta.type === 'tool_call') calls.push(delta.call)
        if (delta.type === 'usage') {
          usage.inputTokens += delta.usage.inputTokens ?? 0
          usage.outputTokens += delta.usage.outputTokens ?? 0
          usage.cacheReadTokens += delta.usage.cacheReadTokens ?? 0
          if (pricing) {
            const inTok = Math.max(0, (delta.usage.inputTokens ?? 0) - (delta.usage.cacheReadTokens ?? 0))
            usage.costUsd += (inTok * (pricing.inputPer1M ?? 0) + (delta.usage.cacheReadTokens ?? 0) * (pricing.cacheReadPer1M ?? 0) + (delta.usage.outputTokens ?? 0) * (pricing.outputPer1M ?? 0)) / 1_000_000
          }
        }
      }
      append('model.response', { text: stepText, calls, provider: llm.name })

      if (stepText) {
        text = stepText
        append('assistant.message', { text: stepText })
      }

      if (calls.length === 0) {
        messages.push({ role: 'assistant', content: stepText })
        break
      }

      messages.push({ role: 'assistant', content: stepText, toolCalls: calls })
      for (const call of calls) {
        calledTools.push(call)
        append('tool.call', { id: call.id, name: call.name, args: call.args })
        let content: string
        try {
          const tool = tools.get(call.name)
          if (!tool) throw new Error(`unknown tool: ${call.name}`)
          if (approvals) {
            const req = {
              id: newApprovalId(),
              sessionId: input.sessionId,
              turnId,
              toolName: call.name,
              risk: tool.risk,
              args: call.args,
            }
            append('approval.requested', req)
            store.recordApproval?.({
              id: req.id, sessionId: input.sessionId, turnId, tool: req.toolName, risk: req.risk,
              args: req.args, status: 'pending', requestedAt: Date.now(),
            })
            const decision = await approvals.request(req, controller.signal)
            append('approval.resolved', { id: req.id, decision })
            store.recordApproval?.({
              id: req.id, sessionId: input.sessionId, turnId, tool: req.toolName, risk: req.risk,
              args: req.args, status: decision, resolver: 'web', requestedAt: Date.now(),
            })
            if (decision !== 'allowed') throw new Error('not-approved')
          }
          const output = await tool.execute(call.args, {
            signal: controller.signal,
            sessionId: input.sessionId,
            cwd: session.cwd,
          })
          content = typeof output === 'string' ? output : JSON.stringify(output)
          if (/^(mcp|web|bot)\./.test(call.name)) {
            content = `<untrusted>\n${content}\n</untrusted>`
          }
          append('tool.result', { id: call.id, name: call.name, ok: true, output })
        } catch (err) {
          content = `error: ${(err as Error).message}`
          append('tool.result', { id: call.id, name: call.name, ok: false, error: (err as Error).message })
        }
        messages.push({ role: 'tool', content, toolCallId: call.id })
      }
    }
  } catch (err) {
    finishReason = controller.signal.aborted ? 'aborted' : 'error'
    append('error', { message: (err as Error).message })
  } finally {
    clearTimeout(timer)
    active.delete(input.sessionId)
    input.signal?.removeEventListener('abort', onAbort)
    store.setSessionStatus(input.sessionId, 'idle')
    store.recordUsage?.({
      sessionId: input.sessionId, turnId, provider: llm.name,
      inputTokens: usage.inputTokens, outputTokens: usage.outputTokens,
      cacheReadTokens: usage.cacheReadTokens, costUsd: usage.costUsd,
    })
    store.audit?.('turn.ended', input.sessionId, { turnId, reason: finishReason, costUsd: usage.costUsd, steps })
    append('turn.ended', { turnId, reason: finishReason, steps, toolCalls: calledTools.length, ms: Date.now() - started })
  }

  return { text, steps, toolCalls: calledTools.length, finishReason }
}

function sumTokens(messages: ModelMessage[]): number {
  return messages.reduce((n, m) => n + estimateTokens(m.content) + (m.toolCalls ? estimateTokens(JSON.stringify(m.toolCalls)) : 0), 0)
}

async function compact(
  ctx: Context,
  llm: Provider,
  store: EventStore,
  sessionId: string,
  messages: ModelMessage[],
  windowTokens: number,
): Promise<{ messages: ModelMessage[]; summary: string; dropped: number } | undefined> {
  if (messages.length <= 4) return undefined
  const keep = Math.max(2, Math.floor(messages.length * 0.4))
  const head = messages.slice(0, messages.length - keep)
  const tail = messages.slice(messages.length - keep)
  const prompt = `Summarize the following earlier conversation for continuity. Keep decisions, facts, open tasks, and user preferences. Be under 200 words.\n\n${head.map((m) => `${m.role}: ${m.content}`).join('\n').slice(0, 6000)}`
  let summary = ''
  try {
    const controller = new AbortController()
    for await (const delta of llm.stream({
      messages: [{ role: 'system', content: 'You are a precise conversation summarizer.' }, { role: 'user', content: prompt }],
      tools: [],
      maxTokens: Math.min(800, Math.floor(windowTokens * 0.2)),
    }, controller.signal)) {
      if (delta.type === 'text') summary += delta.text
    }
  } catch {
    summary = ''
  }
  if (!summary) {
    // deterministic fallback: keep the last few messages and drop the rest
    summary = `Earlier ${head.length} messages were truncated to save context.`
  }
  return {
    messages: [{ role: 'system', content: `Earlier conversation summary: ${summary}` }, ...tail],
    summary,
    dropped: head.length,
  }
}

function buildHistory(store: EventStore, sessionId: string): ModelMessage[] {
  const messages: ModelMessage[] = []
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

export type { ModelDelta }
