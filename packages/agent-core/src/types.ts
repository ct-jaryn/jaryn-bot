export type ContentBlock = { type: 'text'; text: string }

export interface ToolCall {
  id: string
  name: string
  args: Record<string, unknown>
}

export interface Usage {
  inputTokens?: number
  outputTokens?: number
  cacheReadTokens?: number
}

export type ModelDelta =
  | { type: 'text'; text: string }
  | { type: 'reasoning'; text: string }
  | { type: 'tool_call'; call: ToolCall }
  | { type: 'usage'; usage: Usage }
  | { type: 'finish'; reason: 'stop' | 'tool' | 'length' | 'error' }

export interface ModelMessage {
  role: 'system' | 'user' | 'assistant' | 'tool'
  content: string
  toolCallId?: string
  toolCalls?: ToolCall[]
}

export interface ModelRequest {
  messages: ModelMessage[]
  tools: { name: string; description: string; schema: object }[]
  maxTokens?: number
}

export interface Provider {
  name: string
  stream(req: ModelRequest, signal: AbortSignal): AsyncIterable<ModelDelta>
}

export type Risk = 'read' | 'write' | 'network' | 'execute' | 'external' | 'destructive'

export interface Tool {
  name: string
  description: string
  schema: object
  risk: Risk
  parallelSafe?: boolean
  execute(args: Record<string, unknown>, ctx: ToolRunContext): Promise<unknown>
}

export interface ToolRunContext {
  signal: AbortSignal
  sessionId: string
  cwd: string
}

export interface ToolResult {
  id: string
  name: string
  ok: boolean
  output?: unknown
  error?: string
}

export interface EventStore {
  getSession(id: string): { id: string; cwd: string; botId?: string } | undefined
  createSession(id: string, botId: string, cwd: string): unknown
  append(input: {
    sessionId: string
    type: string
    turnId?: string
    actorKind?: string
    actorId?: string
    provenance?: string
    data?: unknown
  }): { seq: number }
  events(sessionId: string, fromSeq?: number): { type: string; data: unknown; seq: number }[]
  setSessionStatus(id: string, status: string): void
}

export interface MemoryService {
  digest(opts: { ns: string; query?: string; budgetTokens?: number }): string
  observe?(ns: string, text: string): number
}

export interface BudgetLimits {
  maxSteps: number
  maxToolCalls: number
  maxWallMs: number
  maxOutputTokens?: number
}

export interface TurnInput {
  sessionId: string
  limits?: Partial<BudgetLimits>
  text: string
  provenance?: 'owner' | 'bot' | 'system'
  actorId?: string
  signal?: AbortSignal
  onDelta?: (delta: ModelDelta) => void
}

export interface TurnResult {
  text: string
  steps: number
  toolCalls: number
  finishReason: string
}
