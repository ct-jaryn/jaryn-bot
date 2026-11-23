import { spawnSync } from 'node:child_process'
import { cpSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { Store as SqliteStore } from '@jaryn/store-sqlite'
import { fileURLToPath } from 'node:url'
import { Context, applyPatch, composeProfile, formatRows, loadComposition } from '@jaryn/kernel'
import type { PatchOp, Plugin, Profile, Row } from '@jaryn/kernel'
import { agentPlugin, runTurn, toolRegistryPlugin } from '@jaryn/agent-core'
import { Store, storePlugin } from '@jaryn/store-sqlite'
import { shellPlugin } from '@jaryn/tools-shell'
import { echoProviderPlugin } from '@jaryn/testing'
import { deepseekPlugin } from '@jaryn/llm-deepseek'
import { startWebServer } from '@jaryn/web'
import { memoryPlugin, memoryToolsPlugin } from '@jaryn/memory'
import { botsPlugin, botToolsPlugin } from '@jaryn/bots'
import { tasksPlugin, taskToolsPlugin } from '@jaryn/tasks'
import { schedulerPlugin } from '@jaryn/scheduler'
import { dockerSandboxPlugin } from '@jaryn/sandbox-docker'
import { mcpPlugin } from '@jaryn/mcp'
import { computerPlugin, computerToolsPlugin } from '@jaryn/computer'
import { vaultPlugin, vaultToolsPlugin } from '@jaryn/vault'
import { artifactsPlugin, artifactToolsPlugin } from '@jaryn/artifacts'
import { pagesPlugin, pageToolsPlugin } from '@jaryn/pages'
import { connectorsPlugin } from '@jaryn/connectors'
import { smtpPlugin, emailToolsPlugin } from '@jaryn/email'
import { fsPlugin } from '@jaryn/tools-fs'

const VERSION = '0.4.0'
const HERE = dirname(fileURLToPath(import.meta.url))
const BASE_PATCH = resolve(HERE, '../../bundles/base/patch.json')

interface Args {
  cmd: string
  sub?: string
  flags: Record<string, string | boolean>
  positional: string[]
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
    ['@jaryn/tools-shell', shellPlugin()],
    ['@jaryn/memory', memoryPlugin()],
    ['@jaryn/memory/tools', memoryToolsPlugin()],
    ['@jaryn/bots', botsPlugin()],
    ['@jaryn/bots/tools', botToolsPlugin()],
    ['@jaryn/tasks', tasksPlugin()],
    ['@jaryn/tasks/tools', taskToolsPlugin()],
    ['@jaryn/scheduler', schedulerPlugin()],
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

async function main(argv: string[] = process.argv.slice(2)): Promise<number> {
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
        console.log(JSON.stringify(bots.add({ id, name: flags.name as string | undefined, persona: flags.persona as string | undefined }), null, 2))
        return 0
      }
      if (sub === 'list') { console.log(JSON.stringify(bots.list(), null, 2)); return 0 }
      if (sub === 'remove') { console.log(JSON.stringify({ removed: bots.remove(String(positional[0])) })); return 0 }
      console.error('usage: jary bot add|list|remove')
      return 2
    } finally {
      await ctx.dispose()
    }
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
    const result = await agent.runTurn({
      sessionId: 'cli',
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
  bot add|list|remove
  job add|list|run|enable|disable|remove|runs
  stop-all                   pause scheduler and cancel turns
  backup [--out <dir>]       backup sqlite + workspaces
  restore --from <dir> --yes restore from backup
  plugin list|doctor|enable|disable|index
  computer status|start|stop|snapshot [--bot id]
  vault add|list|remove|rotate|events
  session list|replay <id>   inspect persisted sessions
  doctor                     environment checks
  version                    print version`)
    return 0
  }

  console.error(`unknown command: ${cmd}`)
  return 2
}

main()
  .then((code) => process.exitCode = code)
  .catch((err) => {
    console.error(`jary: ${err.message}`)
    process.exitCode = 1
  })
