import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process'
import { createInterface } from 'node:readline'
import { definePlugin } from '@jaryn/kernel'
import type { Plugin } from '@jaryn/kernel'
import type { Risk, Tool } from '@jaryn/agent-core'

export interface HostedToolSpec {
  name: string
  description: string
  schema: object
  risk?: Risk
}

export interface HostConfig {
  id: string
  command: string
  args?: string[]
  env?: Record<string, string>
  timeoutMs?: number
}

interface Pending {
  resolve: (value: unknown) => void
  reject: (error: Error) => void
  timer: NodeJS.Timeout
}

/**
 * Run an untrusted plugin in its own process. The child speaks newline-delimited JSON:
 *   child → {"type":"ready","tools":[{"name","description","schema","risk"}]}
 *   parent → {"type":"call","id","tool","args"}
 *   child → {"type":"result","id","ok","output"|"error"}
 */
export class PluginHostProcess {
  private child?: ChildProcessWithoutNullStreams
  private pending = new Map<string, Pending>()
  private nextId = 1
  tools: HostedToolSpec[] = []
  private timeoutMs: number

  private cfg: HostConfig
  constructor(cfg: HostConfig) {
    this.cfg = cfg
    this.timeoutMs = cfg.timeoutMs ?? 60_000
  }

  async start(): Promise<void> {
    this.child = spawn(this.cfg.command, this.cfg.args ?? [], {
      stdio: ['pipe', 'pipe', 'pipe'],
      env: { ...process.env, ...(this.cfg.env ?? {}) },
    })
    const rl = createInterface({ input: this.child.stdout })
    rl.on('line', (line) => this.onLine(line))
    this.child.stderr.on('data', (chunk) => process.stderr.write(`[plugin:${this.cfg.id}] ${chunk}`))
    this.child.on('exit', () => this.failAll(new Error(`plugin host exited: ${this.cfg.id}`)))
    await new Promise<void>((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error(`plugin host handshake timeout: ${this.cfg.id}`)), 20_000)
      this.readyResolve = () => { clearTimeout(timer); resolve() }
      this.readyReject = (err) => { clearTimeout(timer); reject(err) }
    })
  }

  private readyResolve?: () => void
  private readyReject?: (err: Error) => void

  async call(tool: string, args: Record<string, unknown>): Promise<unknown> {
    if (!this.child) throw new Error('plugin host not started')
    const id = String(this.nextId++)
    return await new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id)
        reject(new Error(`plugin host call timeout: ${tool}`))
      }, this.timeoutMs)
      this.pending.set(id, { resolve, reject, timer })
      this.child!.stdin.write(JSON.stringify({ type: 'call', id, tool, args }) + '\n')
    })
  }

  stop(): void {
    this.failAll(new Error('plugin host stopped'))
    this.child?.kill()
    this.child = undefined
  }

  private onLine(line: string): void {
    let msg: any
    try { msg = JSON.parse(line) } catch { return }
    if (msg.type === 'ready') {
      this.tools = (msg.tools ?? []).map((tool: any) => ({
        name: String(tool.name),
        description: String(tool.description ?? ''),
        schema: tool.schema ?? { type: 'object', properties: {} },
        risk: tool.risk,
      }))
      this.readyResolve?.()
      return
    }
    if (msg.type === 'result') {
      const pending = this.pending.get(String(msg.id))
      if (!pending) return
      clearTimeout(pending.timer)
      this.pending.delete(String(msg.id))
      if (msg.ok) pending.resolve(msg.output)
      else pending.reject(new Error(String(msg.error ?? 'plugin error')))
      return
    }
    if (msg.type === 'fatal') this.readyReject?.(new Error(String(msg.error ?? 'plugin fatal')))
  }

  private failAll(error: Error): void {
    for (const pending of this.pending.values()) {
      clearTimeout(pending.timer)
      pending.reject(error)
    }
    this.pending.clear()
    this.readyReject?.(error)
  }
}

export function pluginHostPlugin(cfg: { hosts?: HostConfig[] } = {}): Plugin<{ hosts?: HostConfig[] }> {
  return definePlugin({
    name: '@jaryn/plugin-host',
    inject: ['tools'],
    apply(ctx, config = {}) {
      const tools = ctx.get<{ register(t: Tool): () => void }>('tools')!
      for (const hostConfig of config.hosts ?? cfg.hosts ?? []) {
        const host = new PluginHostProcess(hostConfig)
        const started = host.start().then(() => {
          for (const spec of host.tools) {
            const tool: Tool = {
              name: `${hostConfig.id}.${spec.name}`,
              description: `[external plugin ${hostConfig.id}] ${spec.description}`,
              risk: spec.risk ?? 'external',
              schema: spec.schema,
              execute: (args) => host.call(spec.name, args),
            }
            ctx.effect(() => tools.register(tool))
          }
          ctx.emit('plugin-host/ready', { id: hostConfig.id, tools: host.tools.length })
        }).catch((err) => {
          ctx.emit('plugin-host/error', { id: hostConfig.id, message: (err as Error).message })
        })
        void started
        ctx.effect(() => () => host.stop())
      }
    },
  })
}
