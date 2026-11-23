import { spawn } from 'node:child_process'
import type { ChildProcessWithoutNullStreams } from 'node:child_process'
import { createInterface } from 'node:readline'
import { definePlugin } from '@jaryn/kernel'
import type { Plugin } from '@jaryn/kernel'
import type { Tool } from '@jaryn/agent-core'

export interface McpServerConfig {
  name: string
  command: string
  args?: string[]
  env?: Record<string, string>
}

export interface McpTool {
  name: string
  description?: string
  inputSchema?: object
}

class StdioMcpClient {
  private child?: ChildProcessWithoutNullStreams
  private nextId = 1
  private pending = new Map<number, { resolve: (v: any) => void; reject: (e: Error) => void }>()
  private closed = false

  private cfg: McpServerConfig
  constructor(cfg: McpServerConfig) {
    this.cfg = cfg
  }

  async start(): Promise<void> {
    this.child = spawn(this.cfg.command, this.cfg.args ?? [], {
      stdio: ['pipe', 'pipe', 'pipe'],
      env: { ...process.env, ...(this.cfg.env ?? {}) },
    })
    this.child.on('error', (err) => this.failAll(err))
    this.child.on('exit', (code) => { this.closed = true; this.failAll(new Error(`mcp server exited: ${code}`)) })
    this.child.stderr.on('data', (chunk) => process.stderr.write(`[mcp:${this.cfg.name}] ${chunk}`))
    const rl = createInterface({ input: this.child.stdout })
    rl.on('line', (line) => this.onLine(line))
    await this.request('initialize', {
      protocolVersion: '2024-11-05',
      capabilities: {},
      clientInfo: { name: 'jaryn-bot', version: '0.1.0' },
    })
    this.notify('notifications/initialized', {})
  }

  async request(method: string, params: unknown): Promise<any> {
    if (!this.child || this.closed) throw new Error(`mcp server not running: ${this.cfg.name}`)
    const id = this.nextId++
    const message = JSON.stringify({ jsonrpc: '2.0', id, method, params })
    return await new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject })
      this.child!.stdin.write(message + '\n')
      setTimeout(() => {
        if (this.pending.delete(id)) reject(new Error(`mcp request timeout: ${method}`))
      }, 15_000).unref?.()
    })
  }

  notify(method: string, params: unknown): void {
    this.child?.stdin.write(JSON.stringify({ jsonrpc: '2.0', method, params }) + '\n')
  }

  async listTools(): Promise<McpTool[]> {
    const result = await this.request('tools/list', {})
    return result?.tools ?? []
  }

  async callTool(name: string, args: Record<string, unknown>): Promise<unknown> {
    const result = await this.request('tools/call', { name, arguments: args })
    const content = result?.content
    if (Array.isArray(content)) return content.map((c: any) => c.text ?? JSON.stringify(c)).join('\n')
    return result
  }

  close(): void {
    this.closed = true
    this.child?.kill()
  }

  private onLine(line: string): void {
    let msg: any
    try { msg = JSON.parse(line) } catch { return }
    if (msg.id !== undefined && this.pending.has(msg.id)) {
      const entry = this.pending.get(msg.id)!
      this.pending.delete(msg.id)
      if (msg.error) entry.reject(new Error(msg.error.message ?? 'mcp error'))
      else entry.resolve(msg.result)
    }
  }

  private failAll(err: Error): void {
    for (const entry of this.pending.values()) entry.reject(err)
    this.pending.clear()
  }
}

export function mcpPlugin(cfg: { servers?: McpServerConfig[] } = {}): Plugin<{ servers?: McpServerConfig[] }> {
  return definePlugin({
    name: '@jaryn/mcp',
    inject: ['tools'],
    config: {
      parse(input: any) {
        const data = input ?? {}
        return { servers: [...(cfg.servers ?? []), ...(data.servers ?? [])] }
      },
    },
    async apply(ctx, config) {
      const tools = ctx.get<{ register(t: Tool): () => void }>('tools')!
      for (const server of config.servers) {
        const client = new StdioMcpClient(server)
        try {
          await client.start()
          const list = await client.listTools()
          for (const tool of list) {
            const registered: Tool = {
              name: `mcp.${server.name}.${tool.name}`,
              description: `MCP ${server.name}: ${tool.description ?? tool.name}`,
              risk: 'external',
              schema: tool.inputSchema ?? { type: 'object', properties: {} },
              execute: async (args) => client.callTool(tool.name, args),
            }
            ctx.effect(() => tools.register(registered))
          }
          ctx.effect(() => () => client.close())
          ctx.emit('mcp/connected', { server: server.name, tools: list.length })
        } catch (err) {
          ctx.emit('mcp/error', { server: server.name, message: (err as Error).message })
        }
      }
    },
  })
}
