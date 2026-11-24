import { spawnSync } from 'node:child_process'
import { cpSync, existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { homedir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { Store as SqliteStore } from '@jaryn/store-sqlite'
import { Context, applyPatch, composeProfile, formatRows, loadComposition } from '@jaryn/kernel'
import type { PatchOp, Plugin, Profile, Row } from '@jaryn/kernel'
import { agentPlugin, approvalPlugin, pricingPlugin, questionsPlugin, runTurn, toolRegistryPlugin } from '@jaryn/agent-core'
import { Store, storePlugin } from '@jaryn/store-sqlite'
import { shellPlugin } from '@jaryn/tools-shell'
import { echoProviderPlugin } from '@jaryn/testing'
import { deepseekPlugin } from '@jaryn/llm-deepseek'
import { startWebServer } from '@jaryn/web'
import { memoryPlugin, memoryToolsPlugin } from '@jaryn/memory'
import { botsPlugin, botToolsPlugin } from '@jaryn/bots'
import { tasksPlugin, taskToolsPlugin } from '@jaryn/tasks'
import { schedulerPlugin, schedulerToolsPlugin } from '@jaryn/scheduler'
import { dockerSandboxPlugin } from '@jaryn/sandbox-docker'
import { mcpPlugin } from '@jaryn/mcp'
import { computerPlugin, computerToolsPlugin } from '@jaryn/computer'
import { vaultPlugin, vaultToolsPlugin } from '@jaryn/vault'
import { artifactsPlugin, artifactToolsPlugin } from '@jaryn/artifacts'
import { pagesPlugin, pageToolsPlugin } from '@jaryn/pages'
import { connectorsPlugin } from '@jaryn/connectors'
import { imapInboxPlugin, smtpPlugin, emailToolsPlugin } from '@jaryn/email'
import { initiativePlugin, initiativeToolsPlugin } from '@jaryn/initiative'
import { TunnelClient } from '@jaryn/tunnel'
import { devicesPlugin } from '@jaryn/devices'
import { fsPlugin } from '@jaryn/tools-fs'
import { webPlugin } from '@jaryn/tools-web'
import { officePlugin } from '@jaryn/office'
import { goalToolsPlugin, goalsPlugin } from '@jaryn/goals'
import { bitwardenPlugin, onePasswordPlugin } from '@jaryn/secrets'
import { pluginHostPlugin } from '@jaryn/plugin-host'
import { notificationsPlugin } from '@jaryn/notifications'
import { maintenancePlugin } from '@jaryn/maintenance'

const VERSION = '1.12.0'
const HERE = dirname(fileURLToPath(import.meta.url))
const BASE_PATCH = resolve(HERE, '../../bundles/base/patch.json')

interface Args {
  cmd: string
  sub?: string
  flags: Record<string, string | boolean>
  positional: string[]
}

/** Best-effort admin audit row (CLI mutations should be visible in `jary audit`). */
function auditAction(ctx: { get?: (name: string) => any } | undefined, action: string, target?: string, detail?: unknown): void {
  try { ctx?.get?.('store')?.audit?.(action, target, detail, 'cli') } catch { /* best effort */ }
}

function readInstalledName(profileDir: string, spec: string): string | undefined {
  const modulesDir = join(profileDir, 'node_modules')
  if (!existsSync(modulesDir)) return undefined
  for (const entry of readdirSync(modulesDir)) {
    if (entry.startsWith('.')) continue
    if (entry.startsWith('@')) {
      for (const inner of readdirSync(join(modulesDir, entry))) {
        const manifest = join(modulesDir, entry, inner, 'package.json')
        if (existsSync(manifest)) return JSON.parse(readFileSync(manifest, 'utf8')).name
      }
      continue
    }
    const manifest = join(modulesDir, entry, 'package.json')
    if (existsSync(manifest)) {
      try { return JSON.parse(readFileSync(manifest, 'utf8')).name } catch { /* ignore */ }
    }
  }
  void spec
  return undefined
}

function redactSecrets(value: unknown, depth = 0): unknown {
  if (depth > 6) return '[depth]'
  if (Array.isArray(value)) return value.map((item) => redactSecrets(item, depth + 1))
  if (value && typeof value === 'object') {
    const out: Record<string, unknown> = {}
    for (const [key, item] of Object.entries(value as Record<string, unknown>)) {
      if (/pass(word)?|secret|token|api[_-]?key|authorization|cvc|cvv|card/i.test(key)) { out[key] = '[redacted]'; continue }
      out[key] = redactSecrets(item, depth + 1)
    }
    return out
  }
  return value
}

function parseArgs(argv: string[]): Args {
  const [cmd = 'help', ...rest] = argv
  let sub: string | undefined
  const flags: Record<string, string | boolean> = {}
  const positional: string[] = []
  if (rest[0] && !rest[0].startsWith('-')) sub = rest.shift()
  for (let i = 0; i < rest.length; i++) {
    const token = rest[i]!
    if (token.startsWith('--')) {
      const key = token.slice(2)
      const next = rest[i + 1]
      if (next && !next.startsWith('-')) {
        flags[key] = next
        i++
      } else {
        flags[key] = true
      }
    } else {
      positional.push(token)
    }
  }
  return { cmd, sub, flags, positional }
}

function homeDir(flags: Record<string, string | boolean>): string {
  return typeof flags.home === 'string' ? resolve(flags.home) : join(homedir(), '.jary')
}

interface ProfileFile {
  name: string
  bundles: { name: string; patchFile: string }[]
  patches?: PatchOp[]
}

function loadProfile(home: string): Profile {
  const file = join(home, 'profile.json')
  if (!existsSync(file)) {
    return { name: 'default', bundles: [{ name: 'base', patch: readJson(BASE_PATCH) }] }
  }
  const data = JSON.parse(readFileSync(file, 'utf8')) as ProfileFile
  return {
    name: data.name,
    bundles: data.bundles.map((b) => ({ name: b.name, patch: readJson(resolve(b.patchFile)) })),
    patches: data.patches ?? [],
  }
}

function readJson(path: string): PatchOp[] {
  return JSON.parse(readFileSync(path, 'utf8')) as PatchOp[]
}

function allPlugins(): Map<string, Plugin<any>> {
  return new Map([
    ['@jaryn/store-sqlite', storePlugin()],
    ['@jaryn/testing/echo', echoProviderPlugin()],
    ['@jaryn/llm-deepseek', deepseekPlugin()],
    ['@jaryn/tools-fs', fsPlugin()],
    ['@jaryn/agent-core/tools', toolRegistryPlugin()],
    ['@jaryn/agent-core/approvals', approvalPlugin()],
    ['@jaryn/agent-core/pricing', pricingPlugin()],
    ['@jaryn/agent-core/questions', questionsPlugin()],
    ['@jaryn/tools-web', webPlugin()],
    ['@jaryn/office', officePlugin()],
    ['@jaryn/goals', goalsPlugin()],
    ['@jaryn/goals/tools', goalToolsPlugin()],
    ['@jaryn/secrets/onePassword', onePasswordPlugin()],
    ['@jaryn/secrets/bitwarden', bitwardenPlugin()],
    ['@jaryn/plugin-host', pluginHostPlugin()],
    ['@jaryn/notifications', notificationsPlugin()],
    ['@jaryn/maintenance', maintenancePlugin()],
    ['@jaryn/tools-shell', shellPlugin()],
    ['@jaryn/memory', memoryPlugin()],
    ['@jaryn/memory/tools', memoryToolsPlugin()],
    ['@jaryn/bots', botsPlugin()],
    ['@jaryn/bots/tools', botToolsPlugin()],
    ['@jaryn/tasks', tasksPlugin()],
    ['@jaryn/tasks/tools', taskToolsPlugin()],
    ['@jaryn/scheduler', schedulerPlugin()],
    ['@jaryn/scheduler/tools', schedulerToolsPlugin()],
    ['@jaryn/sandbox-docker', dockerSandboxPlugin()],
    ['@jaryn/mcp', mcpPlugin()],
    ['@jaryn/computer', computerPlugin()],
    ['@jaryn/computer/tools', computerToolsPlugin()],
    ['@jaryn/vault', vaultPlugin()],
    ['@jaryn/vault/tools', vaultToolsPlugin()],
    ['@jaryn/artifacts', artifactsPlugin()],
    ['@jaryn/artifacts/tools', artifactToolsPlugin()],
    ['@jaryn/pages', pagesPlugin()],
    ['@jaryn/pages/tools', pageToolsPlugin()],
    ['@jaryn/connectors', connectorsPlugin()],
    ['@jaryn/email', smtpPlugin()],
    ['@jaryn/email/tools', emailToolsPlugin()],
    ['@jaryn/email/imap', imapInboxPlugin()],
    ['@jaryn/initiative', initiativePlugin()],
    ['@jaryn/initiative/tools', initiativeToolsPlugin()],
    ['@jaryn/devices', devicesPlugin()],
    ['@jaryn/agent-core', agentPlugin()],
  ])
}

function rowsFor(flags: Record<string, string | boolean>): Row[] {
  const profile = loadProfile(homeDir(flags))
  let rows = composeProfile(profile)
  if (typeof flags.patch === 'string') rows = applyPatch(rows, readJson(resolve(flags.patch)))
  return rows
}

function resolveHomePaths(rows: Row[], home: string): Row[] {
  for (const row of rows) {
    if (row.id === 'store' && row.config && typeof (row.config as any).path === 'string') {
      const path = (row.config as any).path
      if (!path.startsWith('/')) (row.config as any).path = resolve(home, path)
    }
    if (row.id === 'bots') {
      row.config = { ...(row.config as any), home }
    }
  }
  return rows
}

async function createRuntime(flags: Record<string, string | boolean>) {
  const home = homeDir(flags)
  process.env.JARY_HOME = home
  const rows = resolveHomePaths(rowsFor(flags), home)
  const ctx = new Context({ scope: 'root', id: 'root' })
  const result = await loadComposition(ctx, rows, allPlugins())
  return { ctx, rows, result }
}

export async function main(argv: string[] = process.argv.slice(2)): Promise<number> {
  const { cmd, sub, flags, positional } = parseArgs(argv)
  const home = homeDir(flags)

  if (cmd === 'version') {
    console.log(`jary ${VERSION} (node ${process.version})`)
    return 0
  }

  if (cmd === 'init') {
    mkdirSync(home, { recursive: true })
    const profileFile = join(home, 'profile.json')
    if (!existsSync(profileFile)) {
      const profile: ProfileFile = {
        name: 'default',
        bundles: [{ name: 'base', patchFile: BASE_PATCH }],
        patches: [],
      }
      writeFileSync(profileFile, JSON.stringify(profile, null, 2))
    }
    console.log(`initialized ${home}`)
    console.log(`  profile: ${profileFile}`)
    console.log('  next: jary config print')
    return 0
  }

  if (cmd === 'config' && sub === 'print') {
    const rows = rowsFor(flags)
    console.log(formatRows(rows))
    if (flags.json) console.log(JSON.stringify(rows, null, 2))
    return 0
  }

  if (cmd === 'session') {
    const homeForExport = homeDir(flags)
    const home = homeDir(flags)
    const rows = resolveHomePaths(rowsFor(flags), home)
    const storeRow = rows.find((r) => r.id === 'store')
    const dbPath = resolve(String((storeRow?.config as any)?.path ?? join(home, 'data/jary.db')))
    const store = new Store(dbPath)
    try {
      if (sub === 'list') {
        for (const s of store.listSessions()) console.log(`${s.id}\t${s.botId}\t${s.status}\t${new Date(s.updatedAt).toISOString()}`)
        return 0
      }
      if (sub === 'export') {
        const id = String(positional[0] ?? '')
        if (!id) { console.error('usage: jary session export <id> [--out file]'); return 2 }
        const events = store.events(id)
        if (events.length === 0) { console.error(`session not found or empty: ${id}`); return 1 }
        const redacted = process.env.JARY_EXPORT_RAW === '1'
        const lines = events.map((e) => JSON.stringify(redacted ? e : { ...e, data: redactSecrets(e.data) }))
        const out = typeof flags.out === 'string' ? resolve(flags.out) : join(home, 'exports', `${id}.jsonl`)
        mkdirSync(dirname(out), { recursive: true })
        writeFileSync(out, lines.join('\n') + '\n')
        console.log(`exported ${events.length} events -> ${out}`)
        return 0
      }
      if (sub === 'delete') {
        const id = String(positional[0] ?? '')
        if (!id || !flags.yes) { console.error('usage: jary session delete <id> --yes'); return 2 }
        console.log(JSON.stringify({ deleted: store.deleteSession(id) }))
        return 0
      }
      if (sub === 'replay') {
        const id = positional[0]
        if (!id) { console.error('usage: jary session replay <id>'); return 2 }
        for (const e of store.replay(id)) console.log(`${e.seq}\t${e.type}\t${JSON.stringify(e.data)}`)
        return 0
      }
      console.error('usage: jary session list|replay')
      return 2
    } finally {
      store.close()
    }
  }

  if (cmd === 'doctor') {
    const checks: [string, boolean, string][] = [
      ['node >= 24', Number(process.versions.node.split('.')[0]) >= 24, process.version],
      ['home writable', (() => { try { mkdirSync(home, { recursive: true }); return true } catch { return false } })(), home],
      ['base patch', existsSync(BASE_PATCH), BASE_PATCH],
    ]
    const { ctx, result } = await createRuntime(flags)
    checks.push(['plugins loaded', result.loaded.length > 0, result.loaded.join(', ')])
    checks.push(['tools registered', (ctx.get<any>('tools')?.list() ?? []).length > 0, ''])
    await ctx.dispose()
    let ok = true
    for (const [name, pass, detail] of checks) {
      ok &&= pass
      console.log(`${pass ? 'ok  ' : 'FAIL'} ${name}${detail ? ` — ${detail}` : ''}`)
    }
    return ok ? 0 : 1
  }

  if (cmd === 'memory') {
    const { ctx } = await createRuntime(flags)
    const memory = ctx.get<any>('memory')
    const ns = typeof flags.ns === 'string' ? flags.ns : 'global'
    try {
      if (sub === 'add') {
        const text = positional.join(' ').trim()
        if (!text) { console.error('usage: jary memory add "text" [--kind fact] [--pinned]'); return 2 }
        const m = memory.remember({ ns, text, kind: (flags.kind as any) ?? 'fact', pinned: !!flags.pinned })
        console.log(JSON.stringify(m, null, 2))
        return 0
      }
      if (sub === 'search') {
        const q = positional.join(' ').trim()
        console.log(JSON.stringify(memory.search({ ns, query: q, limit: Number(flags.limit ?? 5) }), null, 2))
        return 0
      }
      if (sub === 'catalog' || sub === 'stats') {
        console.log(JSON.stringify({ ns, categories: memory.catalog(ns), stats: memory.stats(ns) }, null, 2))
        return 0
      }
      if (sub === 'list') {
        console.log(JSON.stringify(memory.list({ ns, kind: flags.kind ? String(flags.kind) : undefined, limit: Number(flags.limit ?? 20) }), null, 2))
        return 0
      }
      if (sub === 'digest') {
        console.log(memory.digest({ ns, query: positional.join(' ').trim() || undefined }))
        return 0
      }
      if (sub === 'forget') {
        const q = positional.join(' ').trim()
        console.log(JSON.stringify({ deleted: memory.forget({ ns, query: q }) }))
        return 0
      }
      if (sub === 'consolidate') {
        console.log(JSON.stringify(memory.consolidate(ns)))
        return 0
      }
      console.error('usage: jary memory add|list|search|catalog|digest|forget|consolidate')
      return 2
    } finally {
      await ctx.dispose()
    }
  }

  if (cmd === 'bot') {
    const { ctx } = await createRuntime(flags)
    const bots = ctx.get<any>('bots')
    try {
      if (sub === 'add') {
        const id = positional[0]
        if (!id) { console.error('usage: jary bot add <id> [--name] [--persona]'); return 2 }
        const created = bots.add({ id, name: flags.name as string | undefined, persona: flags.persona as string | undefined })
        auditAction(ctx, 'bot.added', id, { name: created.name })
        console.log(JSON.stringify(created, null, 2))
        return 0
      }
      if (sub === 'list') { console.log(JSON.stringify(bots.list(), null, 2)); return 0 }
      if (sub === 'edit') {
        const id = String(positional[0] ?? '')
        if (!id) { console.error('usage: jary bot edit <id> [--name] [--persona] [--workspace]'); return 2 }
        const edited = bots.edit(id, {
          name: flags.name as string | undefined,
          persona: flags.persona as string | undefined,
          workspace: flags.workspace as string | undefined,
        })
        auditAction(ctx, 'bot.edited', id)
        console.log(JSON.stringify(edited, null, 2))
        return 0
      }
      if (sub === 'remove') {
        const id = String(positional[0])
        const removed = bots.remove(id, !!flags.purge)
        auditAction(ctx, 'bot.removed', id, { purge: !!flags.purge })
        console.log(JSON.stringify({ removed }))
        return 0
      }
      console.error('usage: jary bot add|list|edit|remove')
      return 2
    } finally {
      await ctx.dispose()
    }
  }

  if (cmd === 'tunnel') {
    const url = String(flags.url ?? '')
    if (!url) { console.error('usage: jary tunnel --url ws://<server>/tunnel'); return 2 }
    const client = new TunnelClient(url)
    await client.connect()
    console.log(`tunnel connected: ${url}`)
    await new Promise<void>((resolve) => {
      const stop = () => { client.close(); resolve() }
      process.once('SIGINT', stop)
      process.once('SIGTERM', stop)
    })
    return 0
  }

  if (cmd === 'goal') {
    const { ctx } = await createRuntime(flags)
    const goals = ctx.get<any>('goals')
    const sessionId = String(flags.session ?? 'cli')
    try {
      if (sub === 'set') {
        const objective = positional.join(' ').trim()
        if (!objective) { console.error('usage: jary goal set "objective" [--session id] [--max-rounds n]'); return 2 }
        console.log(JSON.stringify(goals.set({ sessionId, objective, maxRounds: flags['max-rounds'] ? Number(flags['max-rounds']) : undefined }), null, 2))
        return 0
      }
      if (sub === 'list') { console.log(JSON.stringify(goals.list(), null, 2)); return 0 }
      if (sub === 'run') {
        const goal = flags.id ? goals.get(String(flags.id)) : goals.active(sessionId)
        if (!goal) { console.error('no active goal'); return 1 }
        console.log(JSON.stringify(await goals.run(goal.id), null, 2))
        return 0
      }
      if (sub === 'pause' || sub === 'clear') {
        const goal = flags.id ? goals.get(String(flags.id)) : goals.active(sessionId)
        if (!goal) { console.error('no active goal'); return 1 }
        console.log(JSON.stringify(goals.update(goal.id, { status: sub === 'clear' ? 'cleared' : 'paused' }), null, 2))
        return 0
      }
      console.error('usage: jary goal set|list|run|pause|clear')
      return 2
    } finally { await ctx.dispose() }
  }

  if (cmd === 'tools') {
    const { ctx } = await createRuntime(flags)
    try {
      const registry = ctx.get<any>('tools')
      const list = (registry?.list?.() ?? []).map((tool: any) => ({ name: tool.name, risk: tool.risk ?? 'read', description: String(tool.description ?? '').split('\n')[0] }))
      list.sort((a: any, b: any) => a.name.localeCompare(b.name))
      if (flags.json) { console.log(JSON.stringify(list, null, 2)); return 0 }
      for (const tool of list) console.log(`${tool.risk.padEnd(12)} ${tool.name}`)
      console.log(`\n${list.length} tools`)
      return 0
    } finally { await ctx.dispose() }
  }

  if (cmd === 'usage') {
    const home = homeDir(flags)
    const rows = resolveHomePaths(rowsFor(flags), home)
    const dbPath = String((rows.find((r) => r.id === 'store')?.config as any)?.path ?? join(home, 'data/jary.db'))
    const store = new SqliteStore(dbPath)
    try {
      console.log(JSON.stringify(store.usageTotal(typeof flags.session === 'string' ? flags.session : undefined), null, 2))
      return 0
    } finally { store.close() }
  }

  if (cmd === 'audit') {
    const home = homeDir(flags)
    const rows = resolveHomePaths(rowsFor(flags), home)
    const dbPath = String((rows.find((r) => r.id === 'store')?.config as any)?.path ?? join(home, 'data/jary.db'))
    const store = new SqliteStore(dbPath)
    try {
      console.log(JSON.stringify(store.auditLog(Number(flags.limit ?? 50)), null, 2))
      return 0
    } finally { store.close() }
  }

  if (cmd === 'device') {
    const { ctx } = await createRuntime(flags)
    const devices = ctx.get<any>('devices')
    try {
      if (sub === 'pair-code') { console.log(JSON.stringify(devices.createPairCode(), null, 2)); return 0 }
      if (sub === 'list') { console.log(JSON.stringify(devices.list(), null, 2)); return 0 }
      if (sub === 'revoke') { console.log(JSON.stringify({ revoked: devices.revoke(String(positional[0])) })); return 0 }
      console.error('usage: jary device pair-code|list|revoke')
      return 2
    } finally { await ctx.dispose() }
  }

  if (cmd === 'vault') {
    const { ctx } = await createRuntime(flags)
    const vault = ctx.get<any>('vault')
    try {
      if (sub === 'add') {
        const name = String(flags.name ?? positional.join(' ') ?? '')
        const password = String(flags.password ?? '')
        if (!name || !password) { console.error('usage: jary vault add --name GitHub --origin https://github.com --username me --password ...'); return 2 }
        const item = vault.add({
          kind: (flags.kind as any) ?? 'login',
          name,
          origin: flags.origin as string | undefined,
          username: flags.username as string | undefined,
          secret: { password, username: flags.username },
        })
        console.log(JSON.stringify(item, null, 2))
        return 0
      }
      if (sub === 'list') { console.log(JSON.stringify(vault.list(), null, 2)); return 0 }
      if (sub === 'remove') { console.log(JSON.stringify({ removed: vault.remove(String(positional[0])) })); return 0 }
      if (sub === 'rotate') {
        const id = String(positional[0]); const password = String(flags.password ?? '')
        vault.rotate(id, { password, username: flags.username })
        console.log('rotated')
        return 0
      }
      if (sub === 'events') { console.log(JSON.stringify(vault.events(), null, 2)); return 0 }
      console.error('usage: jary vault add|list|remove|rotate|events')
      return 2
    } finally { await ctx.dispose() }
  }

  if (cmd === 'computer') {
    const { ctx } = await createRuntime(flags)
    const computer = ctx.get<any>('computer')
    const bot = String(flags.bot ?? 'default')
    try {
      if (sub === 'status') { console.log(JSON.stringify(computer.status(bot), null, 2)); return 0 }
      if (sub === 'start') { console.log(JSON.stringify(await computer.start(bot), null, 2)); return 0 }
      if (sub === 'stop') { await computer.stop(bot); console.log('stopped'); return 0 }
      if (sub === 'snapshot') { console.log(JSON.stringify({ path: await computer.snapshot(bot, flags.label as string | undefined) }, null, 2)); return 0 }
      console.error('usage: jary computer status|start|stop|snapshot [--bot id]')
      return 2
    } finally { await computer.shutdown?.(); await ctx.dispose() }
  }

  if (cmd === 'plugin') {
    const home = homeDir(flags)
    const profileFile = join(home, 'profile.json')
    const rows = rowsFor(flags)
    if (sub === 'list') {
      for (const row of rows) console.log(`${row.disabled ? 'disabled' : 'enabled '} ${row.id}\t${row.name}`)
      return 0
    }
    if (sub === 'add') {
      const spec = positional[0]
      if (!spec) { console.error('usage: jary plugin add npm:<pkg>@<ver> | git:<url> | file:<path> [--trust]'); return 2 }
      const [kind, target] = spec.includes(':') ? [spec.slice(0, spec.indexOf(':')), spec.slice(spec.indexOf(':') + 1)] : ['npm', spec]
      if (!['npm', 'git', 'file'].includes(kind)) { console.error(`unsupported spec: ${kind} (use npm:, git:, file:)`); return 2 }
      const profileDir = join(home, 'profiles', 'default')
      mkdirSync(profileDir, { recursive: true })
      const pkgSpec = kind === 'npm' ? target : kind === 'file' ? `file:${resolve(target!)}` : target!
      const result = spawnSync('npm', ['install', '--no-audit', '--no-fund', '--prefix', profileDir, pkgSpec], { encoding: 'utf8', timeout: 180_000 })
      if (result.status !== 0) { console.error(`install failed: ${(result.stderr ?? '').slice(0, 800)}`); return 1 }
      const installedName = readInstalledName(profileDir, pkgSpec)
      if (!installedName) { console.error('install finished but package name could not be resolved'); return 1 }
      mkdirSync(home, { recursive: true })
      const profile = existsSync(profileFile) ? JSON.parse(readFileSync(profileFile, 'utf8')) : { name: 'default', bundles: [], patches: [] }
      profile.patches = profile.patches ?? []
      profile.patches.push({ id: `plugin-${installedName.replace(/[^a-z0-9-]+/gi, '-')}`, name: installedName, config: {} })
      writeFileSync(profileFile, JSON.stringify(profile, null, 2))
      const registryNames = new Set(allPlugins().map((row) => row.name))
      console.log(`installed ${installedName} into ${profileDir}`)
      if (!registryNames.has(installedName)) {
        console.log('note: this package is not in the static plugin registry, so the loader will report it as MISSING;')
        console.log('      for third-party tools prefer @jaryn/plugin-host (see docs/guides/plugins.md).')
      }
      if (!flags.trust) console.log('note: third-party plugin runs in-process; review it and pass --trust to silence this warning')
      return 0
    }
    if (sub === 'remove') {
      const name = positional[0]
      if (!name) { console.error('usage: jary plugin remove <name>'); return 2 }
      const profile = existsSync(profileFile) ? JSON.parse(readFileSync(profileFile, 'utf8')) : { patches: [] }
      const before = (profile.patches ?? []).length
      profile.patches = (profile.patches ?? []).filter((patch: any) => patch.name !== name)
      writeFileSync(profileFile, JSON.stringify(profile, null, 2))
      console.log(`removed ${name} (${before - profile.patches.length} row)`);
      return 0
    }
    if (sub === 'permissions') {
      const packagesDir = resolve(HERE, '../..')
      const dangerous: string[] = []
      let scanned = 0
      for (const name of readdirSync(packagesDir)) {
        const manifest = join(packagesDir, name, 'package.json')
        if (!existsSync(manifest)) continue
        const data = JSON.parse(readFileSync(manifest, 'utf8'))
        const perms = data.jaryn?.permissions
        scanned++
        if (!perms) continue
        if (perms.process || perms.network === '*' || (Array.isArray(perms.secrets) && perms.secrets.length > 0) || perms.fs === 'full') {
          dangerous.push(`${data.name}: ${JSON.stringify(perms)}`)
        }
      }
      console.log(`scanned ${scanned} packages`)
      if (dangerous.length === 0) { console.log('no high-risk permission declarations'); return 0 }
      console.log('high-risk declarations (require --trust in third-party installs):')
      for (const line of dangerous) console.log(' - ' + line)
      return 0
    }
    if (sub === 'doctor') {
      const registry = allPlugins()
      const provides = new Set<string>()
      let bad = 0
      for (const row of rows.filter((r) => !r.disabled)) {
        const plugin = registry.get(row.name)
        if (!plugin) { console.log(`MISSING ${row.id}: ${row.name}`); bad++; continue }
        for (const key of plugin.provides ?? []) provides.add(key)
      }
      for (const row of rows.filter((r) => !r.disabled)) {
        const plugin = registry.get(row.name)!
        for (const key of plugin.inject ?? []) {
          if (!provides.has(key)) { console.log(`MISSING DEP ${row.id}: needs ${key}`); bad++ }
        }
      }
      console.log(bad ? `${bad} problem(s)` : 'ok: all plugins resolve')
      return bad ? 1 : 0
    }
    if (sub === 'disable' || sub === 'enable') {
      const id = positional[0]
      if (!id) { console.error(`usage: jary plugin ${sub} <id>`); return 2 }
      mkdirSync(home, { recursive: true })
      if (!existsSync(profileFile)) await main([ 'init', '--home', home ])
      const profile = existsSync(profileFile)
        ? JSON.parse(readFileSync(profileFile, 'utf8'))
        : { name: 'default', bundles: [], patches: [] }
      profile.patches = profile.patches ?? []
      profile.patches.push({ id, disabled: sub === 'disable' })
      writeFileSync(profileFile, JSON.stringify(profile, null, 2))
      console.log(`${sub}d ${id} (restart to apply)`)
      return 0
    }
    if (sub === 'index') {
      const file = join(home, 'plugin-index.json')
      const data = existsSync(file) ? JSON.parse(readFileSync(file, 'utf8')) : { sources: [] }
      if (positional[0] === 'add' && positional[1]) {
        data.sources.push(positional[1])
        writeFileSync(file, JSON.stringify(data, null, 2))
        console.log(`index source added: ${positional[1]}`)
        return 0
      }
      console.log(JSON.stringify(data, null, 2))
      return 0
    }
    console.error('usage: jary plugin list|doctor|enable|disable|index')
    return 2
  }

  if (cmd === 'backup') {
    const home = homeDir(flags)
    const stamp = new Date().toISOString().replace(/[:.]/g, '-')
    const out = typeof flags.out === 'string' ? resolve(flags.out) : join(home, 'backups', stamp)
    mkdirSync(out, { recursive: true })
    const rows = resolveHomePaths(rowsFor(flags), home)
    const dbPath = String((rows.find((r) => r.id === 'store')?.config as any)?.path ?? join(home, 'data/jary.db'))
    if (!existsSync(dbPath)) { console.error(`database not found: ${dbPath}`); return 1 }
    const db = new SqliteStore(dbPath)
    db.db.exec(`VACUUM INTO '${join(out, 'jary.db').replace(/'/g, "''")}'`)
    db.close()
    for (const dir of ['bots', 'artifacts', 'profiles', 'presets']) {
      const src = join(home, dir)
      if (existsSync(src)) cpSync(src, join(out, dir), { recursive: true })
    }
    writeFileSync(join(out, 'manifest.json'), JSON.stringify({ version: VERSION, createdAt: new Date().toISOString(), db: 'jary.db', note: 'Vault encrypted with master key; keep it separately' }, null, 2))
    console.log(`backup: ${out}`)
    return 0
  }

  if (cmd === 'restore') {
    const home = homeDir(flags)
    const from = typeof flags.from === 'string' ? resolve(flags.from) : ''
    if (!from || !existsSync(join(from, 'jary.db'))) { console.error('usage: jary restore --from <backup-dir> --yes'); return 2 }
    if (!flags.yes) { console.error('restore overwrites current data; re-run with --yes'); return 2 }
    const rows = resolveHomePaths(rowsFor(flags), home)
    const dbPath = String((rows.find((r) => r.id === 'store')?.config as any)?.path ?? join(home, 'data/jary.db'))
    mkdirSync(dirname(dbPath), { recursive: true })
    cpSync(join(from, 'jary.db'), dbPath)
    for (const dir of ['bots', 'artifacts', 'profiles', 'presets']) {
      const src = join(from, dir)
      if (existsSync(src)) cpSync(src, join(home, dir), { recursive: true })
    }
    console.log(`restored to ${home} (restart services)`)
    return 0
  }

  if (cmd === 'job') {
    const { ctx } = await createRuntime(flags)
    const scheduler = ctx.get<any>('scheduler')
    try {
      if (sub === 'add') {
        const mission = positional.join(' ').trim() || String(flags.mission ?? '')
        if (!mission) { console.error('usage: jary job add --cron "0 8 * * *" --tz Asia/Shanghai "mission"'); return 2 }
        let trigger: any
        if (typeof flags.cron === 'string') trigger = { kind: 'cron', expr: flags.cron, tz: String(flags.tz ?? 'UTC') }
        else if (typeof flags.every === 'string') trigger = { kind: 'every', seconds: Number(flags.every) }
        else if (typeof flags.webhook === 'string') trigger = { kind: 'webhook', path: flags.webhook, secret: flags.secret }
        else { console.error('need --cron, --every or --webhook'); return 2 }
        const job = scheduler.add({
          botId: String(flags.bot ?? 'default'),
          name: flags.name as string | undefined,
          trigger,
          mission,
          budget: {
            maxRounds: flags['max-rounds'] ? Number(flags['max-rounds']) : undefined,
            maxSteps: flags['max-steps'] ? Number(flags['max-steps']) : undefined,
          },
        })
        auditAction(ctx, 'job.added', job.id, { name: job.name })
        console.log(JSON.stringify(job, null, 2))
        return 0
      }
      if (sub === 'list') { console.log(JSON.stringify(scheduler.list(), null, 2)); return 0 }
      if (sub === 'run') { console.log(JSON.stringify(await scheduler.runNow(String(positional[0])), null, 2)); return 0 }
      if (sub === 'enable' || sub === 'disable') { console.log(JSON.stringify(scheduler.enable(String(positional[0]), sub === 'enable'), null, 2)); return 0 }
      if (sub === 'remove') { console.log(JSON.stringify({ removed: scheduler.remove(String(positional[0])) })); return 0 }
      if (sub === 'runs') { console.log(JSON.stringify(scheduler.runs(positional[0]), null, 2)); return 0 }
      console.error('usage: jary job add|list|run|enable|disable|remove|runs')
      return 2
    } finally {
      await ctx.dispose()
    }
  }

  if (cmd === 'stop-all') {
    const { ctx } = await createRuntime(flags)
    try {
      ctx.get<any>('scheduler')?.stopAll?.()
      console.log('stopped: scheduler paused, running turns cancelled')
      return 0
    } finally {
      await ctx.dispose()
    }
  }

  if (cmd === 'serve') {
    const { ctx } = await createRuntime(flags)
    const port = Number(flags.port ?? 8787)
    const host = typeof flags.host === 'string' ? flags.host : '127.0.0.1'
    ctx.get<any>('scheduler')?.start?.(5000)
    const web = await startWebServer(ctx, { port, host })
    console.log(`jary web: ${web.url}`)
    await new Promise<void>((resolve) => {
      const shutdown = async () => {
        await web.close()
        await ctx.dispose()
        resolve()
      }
      process.once('SIGINT', shutdown)
      process.once('SIGTERM', shutdown)
    })
    return 0
  }

  if (cmd === 'chat') {
    const text = positional.join(' ').trim() || (typeof flags.text === 'string' ? flags.text : '')
    if (!text) {
      console.error('usage: jary chat --bot <id> "message"')
      return 2
    }
    const { ctx } = await createRuntime(flags)
    const agent = ctx.get<{ runTurn: typeof runTurn }>('agent')!
    const botId = typeof flags.bot === 'string' ? flags.bot : 'default'
    const store = ctx.get<any>('store')
    const bots = ctx.get<any>('bots')
    const sessionId = `cli:${botId}`
    if (store && !store.getSession(sessionId)) {
      store.createSession(sessionId, botId, bots?.workspaceFor?.(botId, process.cwd()) ?? process.cwd())
    }
    const result = await agent.runTurn({
      sessionId,
      text,
      onDelta: (d) => {
        if (d.type === 'text') process.stdout.write(d.text)
      },
    })
    process.stdout.write(`\n[turn ${result.finishReason}, steps ${result.steps}]\n`)
    await ctx.dispose()
    return 0
  }

  if (cmd === 'help' || cmd === '--help' || cmd === '-h') {
    console.log(`jary ${VERSION}
commands:
  init                       initialize home/profile
  config print [--patch f]   print composed plugin rows
  chat --bot <id> "text"     run one turn (echo provider by default)
  serve [--port 8787]        start Web UI + API
  memory add|list|search|catalog|digest|forget|consolidate
  bot add|list|edit|remove
  job add|list|run|enable|disable|remove|runs
  stop-all                   pause scheduler and cancel turns
  backup [--out <dir>]       backup sqlite + workspaces
  restore --from <dir> --yes restore from backup
  plugin list|doctor|permissions|add|remove|enable|disable|index
  computer status|start|stop|snapshot [--bot id]
  vault add|list|remove|rotate|events
  tunnel --url ws://<server>/tunnel   client-side egress tunnel
  device pair-code|list|revoke        multi-device pairing
  goal set|list|run|pause|clear       persistent multi-round goals
  tools [--json]                      list registered tools with risk
  usage [--session id]                token/cost totals
  audit [--limit n]                   audit log
  session list|replay|export|delete <id>
  doctor                     environment checks
  version                    print version`)
    return 0
  }

  console.error(`unknown command: ${cmd}`)
  return 2
}

// Only auto-run when invoked as a script (tests import main()).
const invokedDirectly = process.argv[1] ? resolve(process.argv[1]) === resolve(fileURLToPath(import.meta.url)) : false
if (invokedDirectly) {
  main()
    .then((code) => process.exitCode = code)
    .catch((err) => {
      console.error(`jary: ${err.message}`)
      process.exitCode = 1
    })
}
