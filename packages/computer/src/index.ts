import { spawn, spawnSync } from 'node:child_process'
import { cpSync, existsSync, mkdirSync, readFileSync, rmSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { definePlugin } from '@jaryn/kernel'
import type { Plugin } from '@jaryn/kernel'
import type { Tool } from '@jaryn/agent-core'
import { CdpClient } from './cdp.ts'

export type ComputerState = 'running' | 'stopped' | 'hibernated'

export interface ComputerInstance {
  botId: string
  baseUrl: string
  workspace: string
  profile: string
  pid?: number
  container?: string
  startedAt: number
}

export interface ComputerBackend {
  readonly kind: string
  start(botId: string): Promise<ComputerInstance>
  stop(instance: ComputerInstance): Promise<void>
}

export interface ComputerConfig {
  backend?: 'local' | 'docker'
  dataDir?: string
  chromePath?: string
  image?: string
  headless?: boolean
}

const DEFAULT_CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'

export class LocalChromeBackend implements ComputerBackend {
  readonly kind = 'local'
  private cfg: ComputerConfig
  constructor(cfg: ComputerConfig = {}) {
    this.cfg = cfg
  }

  async start(botId: string): Promise<ComputerInstance> {
    const dataDir = resolve(this.cfg.dataDir ?? join(process.env.JARY_HOME ?? join(process.cwd(), 'data'), 'computers'))
    const workspace = join(dataDir, botId, 'workspace')
    const profile = join(dataDir, botId, 'profile')
    mkdirSync(workspace, { recursive: true })
    mkdirSync(profile, { recursive: true })
    const chrome = this.cfg.chromePath ?? process.env.CHROME_PATH ?? (existsSync(DEFAULT_CHROME) ? DEFAULT_CHROME : 'google-chrome')
    const args = [
      '--headless=new',
      '--remote-debugging-port=0',
      `--user-data-dir=${profile}`,
      '--no-first-run',
      '--no-default-browser-check',
      '--disable-gpu',
      '--disable-dev-shm-usage',
      '--window-size=1280,900',
      'about:blank',
    ]
    if (process.platform === 'linux') args.unshift('--no-sandbox')
    const child = spawn(chrome, args, { stdio: ['ignore', 'ignore', 'pipe'], detached: false })
    let stderr = ''
    child.stderr.on('data', (chunk) => { stderr += chunk.toString('utf8').slice(0, 2000) })
    const portFile = join(profile, 'DevToolsActivePort')
    const started = Date.now()
    while (!existsSync(portFile)) {
      if (Date.now() - started > 15_000) {
        child.kill('SIGKILL')
        throw new Error(`chrome did not start: ${stderr.slice(0, 300)}`)
      }
      await new Promise((r) => setTimeout(r, 100))
    }
    const port = Number(readFileSync(portFile, 'utf8').split('\n')[0])
    return { botId, baseUrl: `http://127.0.0.1:${port}`, workspace, profile, pid: child.pid, startedAt: Date.now() }
  }

  async stop(instance: ComputerInstance): Promise<void> {
    if (instance.pid) {
      try { process.kill(instance.pid, 'SIGTERM') } catch { /* already gone */ }
      await new Promise((r) => setTimeout(r, 300))
      try { process.kill(instance.pid, 'SIGKILL') } catch { /* already gone */ }
    }
  }
}

export class DockerComputerBackend implements ComputerBackend {
  readonly kind = 'docker'
  private cfg: ComputerConfig
  constructor(cfg: ComputerConfig = {}) {
    this.cfg = cfg
  }

  async start(botId: string): Promise<ComputerInstance> {
    const dataDir = resolve(this.cfg.dataDir ?? join(process.env.JARY_HOME ?? join(process.cwd(), 'data'), 'computers'))
    const workspace = join(dataDir, botId, 'workspace')
    const profile = join(dataDir, botId, 'profile')
    mkdirSync(workspace, { recursive: true })
    mkdirSync(profile, { recursive: true })
    const image = this.cfg.image ?? 'jaryn-computer:0.2'
    const name = `jary-computer-${botId}-${Date.now().toString(36)}`
    const run = spawnSync('docker', [
      'run', '-d', '--rm', '--name', name,
      '--memory', '1g', '--cpus', '1', '--pids-limit', '256',
      '--security-opt', 'no-new-privileges',
      '-v', `${workspace}:/workspace`, '-v', `${profile}:/profile`,
      '-p', '127.0.0.1:0:9222', image,
    ], { encoding: 'utf8' })
    if (run.status !== 0) throw new Error(`docker run failed: ${run.stderr}`)
    const portOut = spawnSync('docker', ['port', name, '9222'], { encoding: 'utf8' })
    const match = portOut.stdout.match(/:(\d+)\s*$/)
    if (!match) {
      spawnSync('docker', ['rm', '-f', name])
      throw new Error(`cannot resolve computer port: ${portOut.stdout}`)
    }
    return { botId, baseUrl: `http://127.0.0.1:${match[1]}`, workspace, profile, container: name, startedAt: Date.now() }
  }

  async stop(instance: ComputerInstance): Promise<void> {
    if (instance.container) spawnSync('docker', ['rm', '-f', instance.container])
  }
}

export class ComputerService {
  private instances = new Map<string, ComputerInstance>()
  private clients = new Map<string, CdpClient>()
  private backend: ComputerBackend
  readonly dataDir: string

  constructor(cfg: ComputerConfig = {}, backend?: ComputerBackend) {
    this.dataDir = resolve(cfg.dataDir ?? join(process.env.JARY_HOME ?? join(process.cwd(), 'data'), 'computers'))
    this.backend = backend ?? (cfg.backend === 'docker' ? new DockerComputerBackend(cfg) : new LocalChromeBackend(cfg))
  }

  status(botId: string): { state: ComputerState; baseUrl?: string; startedAt?: number } {
    const inst = this.instances.get(botId)
    if (!inst) return { state: 'stopped' }
    return { state: 'running', baseUrl: inst.baseUrl, startedAt: inst.startedAt }
  }

  async start(botId: string): Promise<ComputerInstance> {
    if (this.instances.has(botId)) return this.instances.get(botId)!
    const inst = await this.backend.start(botId)
    this.instances.set(botId, inst)
    return inst
  }

  async stop(botId: string): Promise<void> {
    const inst = this.instances.get(botId)
    this.clients.get(botId)?.close()
    this.clients.delete(botId)
    this.instances.delete(botId)
    if (inst) await this.backend.stop(inst)
  }

  async client(botId: string): Promise<CdpClient> {
    const cached = this.clients.get(botId)
    if (cached) return cached
    const inst = await this.start(botId)
    const client = new CdpClient(inst.baseUrl)
    await client.connect()
    this.clients.set(botId, client)
    return client
  }

  async snapshot(botId: string, label = 'snap'): Promise<string> {
    const inst = this.instances.get(botId)
    if (!inst) throw new Error(`computer not running: ${botId}`)
    const target = join(this.dataDir, botId, 'snapshots', `${label}-${Date.now()}`)
    mkdirSync(target, { recursive: true })
    cpSync(inst.workspace, join(target, 'workspace'), { recursive: true })
    cpSync(inst.profile, join(target, 'profile'), { recursive: true })
    return target
  }

  async restore(botId: string, snapshotPath: string): Promise<void> {
    if (!existsSync(snapshotPath)) throw new Error(`snapshot not found: ${snapshotPath}`)
    await this.stop(botId)
    const workspace = join(this.dataDir, botId, 'workspace')
    const profile = join(this.dataDir, botId, 'profile')
    rmSync(workspace, { recursive: true, force: true })
    rmSync(profile, { recursive: true, force: true })
    cpSync(join(snapshotPath, 'workspace'), workspace, { recursive: true })
    cpSync(join(snapshotPath, 'profile'), profile, { recursive: true })
  }

  async shutdown(): Promise<void> {
    for (const id of [...this.instances.keys()]) await this.stop(id)
  }
}

export function createComputerService(cfg: ComputerConfig = {}, backend?: ComputerBackend): ComputerService {
  return new ComputerService(cfg, backend)
}

export function computerPlugin(cfg: ComputerConfig = {}): Plugin<ComputerConfig> {
  return definePlugin({
    name: '@jaryn/computer',
    provides: ['computer'],
    apply(ctx, config = {}) {
      const computer = new ComputerService({ ...cfg, ...config })
      ctx.provide('computer', computer)
      ctx.effect(() => () => { void computer.shutdown() })
    },
  })
}

export function computerToolsPlugin(): Plugin {
  return definePlugin({
    name: '@jaryn/computer/tools',
    inject: ['computer', 'tools'],
    apply(ctx) {
      const computer = ctx.get<ComputerService>('computer')!
      const tools = ctx.get<{ register(t: Tool): () => void }>('tools')!
      const botOf = (args: Record<string, unknown>) => String(args.botId ?? 'default')
      const list: Tool[] = [
        {
          name: 'computer.status', description: 'Check the bot computer state.', risk: 'read',
          schema: { type: 'object', properties: { botId: { type: 'string' } } },
          async execute(args) { return computer.status(botOf(args)) },
        },
        {
          name: 'computer.start', description: 'Start the bot computer (Chrome + workspace).', risk: 'execute',
          schema: { type: 'object', properties: { botId: { type: 'string' } } },
          async execute(args) { const inst = await computer.start(botOf(args)); return { baseUrl: inst.baseUrl, workspace: inst.workspace } },
        },
        {
          name: 'computer.stop', description: 'Stop the bot computer.', risk: 'execute',
          schema: { type: 'object', properties: { botId: { type: 'string' } } },
          async execute(args) { await computer.stop(botOf(args)); return { ok: true } },
        },
        {
          name: 'computer.snapshot', description: 'Snapshot workspace and browser profile.', risk: 'write',
          schema: { type: 'object', properties: { botId: { type: 'string' }, label: { type: 'string' } } },
          async execute(args) { return { path: await computer.snapshot(botOf(args), args.label ? String(args.label) : undefined) } },
        },
        {
          name: 'computer.restore', description: 'Restore a computer snapshot.', risk: 'execute',
          schema: { type: 'object', properties: { botId: { type: 'string' }, path: { type: 'string' } }, required: ['path'] },
          async execute(args) { await computer.restore(botOf(args), String(args.path)); return { ok: true } },
        },
        {
          name: 'browser.goto', description: 'Open a URL in the bot computer browser.', risk: 'network',
          schema: { type: 'object', properties: { botId: { type: 'string' }, url: { type: 'string' } }, required: ['url'] },
          async execute(args) { const client = await computer.client(botOf(args)); await client.navigate(String(args.url)); return { url: String(args.url), title: await client.evaluate<string>('document.title') } },
        },
        {
          name: 'browser.extract', description: 'Extract visible text from the current page.', risk: 'read',
          schema: { type: 'object', properties: { botId: { type: 'string' } } },
          async execute(args) { const client = await computer.client(botOf(args)); return { text: (await client.text()).slice(0, 8000) } },
        },
        {
          name: 'browser.click', description: 'Click an element by CSS selector.', risk: 'execute',
          schema: { type: 'object', properties: { botId: { type: 'string' }, selector: { type: 'string' } }, required: ['selector'] },
          async execute(args) { const client = await computer.client(botOf(args)); await client.click(String(args.selector)); return { ok: true } },
        },
        {
          name: 'browser.type', description: 'Type into an input by CSS selector.', risk: 'execute',
          schema: { type: 'object', properties: { botId: { type: 'string' }, selector: { type: 'string' }, text: { type: 'string' } }, required: ['selector', 'text'] },
          async execute(args) { const client = await computer.client(botOf(args)); await client.type(String(args.selector), String(args.text)); return { ok: true } },
        },
        {
          name: 'browser.screenshot', description: 'Capture the page screenshot to a PNG file.', risk: 'read',
          schema: { type: 'object', properties: { botId: { type: 'string' } } },
          async execute(args) { const client = await computer.client(botOf(args)); const b64 = await client.screenshot(); const { writeFileSync } = await import('node:fs'); const target = join(computer.dataDir, botOf(args), 'screenshots', `shot-${Date.now()}.png`); mkdirSync(dirname(target), { recursive: true }); writeFileSync(target, Buffer.from(b64, 'base64')); return { path: target, bytes: Math.floor(b64.length * 0.75) } },
        },
      ]
      for (const tool of list) ctx.effect(() => tools.register(tool))
    },
  })
}

export { CdpClient } from './cdp.ts'
