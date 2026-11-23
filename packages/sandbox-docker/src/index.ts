import { spawn, spawnSync } from 'node:child_process'
import { existsSync } from 'node:fs'
import { definePlugin } from '@jaryn/kernel'
import type { Plugin } from '@jaryn/kernel'

export interface ExecInput {
  command: string
  cwd: string
  timeoutMs?: number
  signal?: AbortSignal
}

export interface ExecResult {
  stdout: string
  stderr: string
  exitCode: number | null
}

export interface Sandbox {
  readonly kind: string
  exec(input: ExecInput): Promise<ExecResult>
}

export interface DockerSandboxConfig {
  image?: string
  memory?: string
  cpus?: string
  network?: 'none' | 'bridge'
  maxOutputBytes?: number
}

export function dockerAvailable(): boolean {
  const res = spawnSync('docker', ['version', '--format', '{{.Server.Version}}'], { encoding: 'utf8' })
  return res.status === 0
}

export function createDockerSandbox(cfg: DockerSandboxConfig = {}): Sandbox {
  const image = cfg.image ?? 'debian:bookworm-slim'
  const memory = cfg.memory ?? '512m'
  const cpus = cfg.cpus ?? '0.5'
  const network = cfg.network ?? 'none'
  const maxOutput = cfg.maxOutputBytes ?? 32_000
  return {
    kind: 'docker',
    async exec(input) {
      return await new Promise<ExecResult>((resolve, reject) => {
        const args = [
          'run', '--rm', '-i',
          '--memory', memory, '--cpus', cpus,
          '--network', network,
          '--pids-limit', '128',
          '--security-opt', 'no-new-privileges',
          '-v', `${input.cwd}:/workspace`, '-w', '/workspace',
          image, 'sh', '-lc', input.command,
        ]
        const child = spawn('docker', args, { stdio: ['ignore', 'pipe', 'pipe'] })
        let stdout = ''
        let stderr = ''
        let bytes = 0
        const append = (target: 'out' | 'err') => (chunk: Buffer) => {
          bytes += chunk.length
          if (bytes > maxOutput) return
          if (target === 'out') stdout += chunk.toString('utf8')
          else stderr += chunk.toString('utf8')
        }
        child.stdout.on('data', append('out'))
        child.stderr.on('data', append('err'))
        const timer = setTimeout(() => child.kill('SIGKILL'), input.timeoutMs ?? 30_000)
        const onAbort = () => child.kill('SIGKILL')
        input.signal?.addEventListener('abort', onAbort, { once: true })
        child.on('error', reject)
        child.on('close', (code) => {
          clearTimeout(timer)
          input.signal?.removeEventListener('abort', onAbort)
          const truncated = bytes > maxOutput ? `\n...[truncated ${bytes - maxOutput} bytes]` : ''
          resolve({ stdout: stdout + truncated, stderr, exitCode: code })
        })
      })
    },
  }
}

export function dockerSandboxPlugin(cfg: DockerSandboxConfig = {}): Plugin<DockerSandboxConfig> {
  return definePlugin({
    name: '@jaryn/sandbox-docker',
    provides: ['sandbox'],
    apply(ctx, config = {}) {
      if (!dockerAvailable()) {
        ctx.emit('sandbox/unavailable', { reason: 'docker not found; falling back to local shell' })
        return
      }
      ctx.provide('sandbox', createDockerSandbox({ ...cfg, ...config }))
    },
  })
}

export { existsSync }
