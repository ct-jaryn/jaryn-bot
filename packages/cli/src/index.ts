import { spawnSync } from 'node:child_process'
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { Context, applyPatch, composeProfile, formatRows, loadComposition } from '@jaryn/kernel'
import type { PatchOp, Plugin, Profile, Row } from '@jaryn/kernel'
import { agentPlugin, runTurn, toolRegistryPlugin } from '@jaryn/agent-core'
import { Store, storePlugin } from '@jaryn/store-sqlite'
import { shellPlugin } from '@jaryn/tools-shell'
import { echoProviderPlugin } from '@jaryn/testing'

const VERSION = '0.0.1'
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
    ['@jaryn/agent-core/tools', toolRegistryPlugin()],
    ['@jaryn/tools-shell', shellPlugin()],
    ['@jaryn/agent-core', agentPlugin()],
  ])
}

function rowsFor(flags: Record<string, string | boolean>): Row[] {
  const profile = loadProfile(homeDir(flags))
  let rows = composeProfile(profile)
  if (typeof flags.patch === 'string') rows = applyPatch(rows, readJson(resolve(flags.patch)))
  return rows
}

async function createRuntime(flags: Record<string, string | boolean>) {
  const rows = rowsFor(flags)
  const ctx = new Context({ scope: 'root', id: 'root' })
  const result = await loadComposition(ctx, rows, allPlugins())
  return { ctx, rows, result }
}

async function main(): Promise<number> {
  const { cmd, sub, flags, positional } = parseArgs(process.argv.slice(2))
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
    const rows = rowsFor(flags)
    const storeRow = rows.find((r) => r.id === 'store')
    const dbPath = resolve(String((storeRow?.config as any)?.path ?? 'data/jary.db'))
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
