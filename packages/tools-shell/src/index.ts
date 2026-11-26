import { spawn } from 'node:child_process'
import { existsSync } from 'node:fs'
import { definePlugin } from '@jaryn/kernel'
import type { Plugin } from '@jaryn/kernel'
import type { Tool } from '@jaryn/agent-core'

function resolveShellInvocation(command: string): { bin: string; args: string[] } {
  if (process.platform !== 'win32') return { bin: 'sh', args: ['-c', command] }
  for (const gitSh of ['C:\\Program Files\\Git\\bin\\sh.exe', 'C:\\Program Files\\Git\\usr\\bin\\sh.exe']) {
    if (existsSync(gitSh)) return { bin: gitSh, args: ['-c', command] }
  }
  return { bin: 'powershell.exe', args: ['-NoProfile', '-NonInteractive', '-Command', command] }
}

export interface SandboxLike {
  exec(input: { command: string; cwd: string; timeoutMs?: number; signal?: AbortSignal }): Promise<{
    stdout: string
    stderr: string
    exitCode: number | null
  }>
}

export interface ShellConfig {
  timeoutMs?: number
  maxOutputBytes?: number
}

export function shellTool(cfg: ShellConfig = {}, sandbox?: SandboxLike): Tool {
  const timeoutMs = cfg.timeoutMs ?? 30_000
  const maxOutputBytes = cfg.maxOutputBytes ?? 32_000
  return {
    name: 'shell.run',
    description: 'Run a shell command in the session workspace and return stdout/stderr.',
    risk: 'execute',
    schema: {
      type: 'object',
      properties: { command: { type: 'string', description: 'Shell command to run' } },
      required: ['command'],
    },
    async execute(args, ctx) {
      const command = String(args.command ?? '')
      if (!command) throw new Error('command is required')
      if (sandbox) {
        const result = await sandbox.exec({ command, cwd: ctx.cwd, timeoutMs, signal: ctx.signal })
        const out = `${result.stdout}${result.stderr ? `\n${result.stderr}` : ''}\n[exit ${result.exitCode}]`
        return out.length > maxOutputBytes ? out.slice(0, maxOutputBytes) + '\n...[truncated]' : out
      }
      return await new Promise<string>((resolve, reject) => {
        const { bin, args: shellArgs } = resolveShellInvocation(command)
        const child = spawn(bin, shellArgs, { cwd: ctx.cwd, env: process.env, stdio: ['ignore', 'pipe', 'pipe'] })
        let output = ''
        let bytes = 0
        const onData = (chunk: Buffer) => {
          bytes += chunk.length
          if (bytes <= maxOutputBytes) output += chunk.toString('utf8')
        }
        child.stdout.on('data', onData)
        child.stderr.on('data', onData)
        const timer = setTimeout(() => { child.kill('SIGKILL'); reject(new Error(`command timed out after ${timeoutMs}ms`)) }, timeoutMs)
        const onAbort = () => { child.kill('SIGKILL'); reject(new Error('command cancelled')) }
        ctx.signal.addEventListener('abort', onAbort, { once: true })
        child.on('error', (err) => { clearTimeout(timer); ctx.signal.removeEventListener('abort', onAbort); reject(err) })
        child.on('close', (code) => {
          clearTimeout(timer)
          ctx.signal.removeEventListener('abort', onAbort)
          const truncated = bytes > maxOutputBytes ? `\n...[truncated ${bytes - maxOutputBytes} bytes]` : ''
          resolve(`${output}${truncated}\n[exit ${code}]`)
        })
      })
    },
  }
}

export function shellPlugin(cfg: ShellConfig = {}): Plugin<ShellConfig> {
  return definePlugin({
    name: '@jaryn/tools-shell',
    inject: ['tools'],
    optional: ['sandbox'],
    apply(ctx, config = {}) {
      const tools = ctx.get<{ register(t: Tool): () => void }>('tools')!
      const sandbox = ctx.get<SandboxLike>('sandbox')
      ctx.effect(() => tools.register(shellTool({ ...cfg, ...config }, sandbox)))
    },
  })
}
