#!/usr/bin/env node
/**
 * End-to-end CLI smoke test: boot the real composition in a temp home and exercise
 * the main commands. Fails loudly on non-zero exit or missing expected output.
 *
 *   node scripts/smoke.ts
 */
import { execFileSync } from 'node:child_process'
import { existsSync, mkdtempSync, readdirSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'

const ROOT = resolve(import.meta.dirname, '..')
const CLI = join(ROOT, 'packages/cli/src/index.ts')
const home = mkdtempSync(join(tmpdir(), 'jary-smoke-'))
const failures: string[] = []

function run(args: string[], expect: string[] = [], allowFailure = false): string {
  let out = ''
  let code = 0
  try {
    out = execFileSync(process.execPath, [CLI, ...args, '--home', home], { encoding: 'utf8', timeout: 120_000, stdio: ['ignore', 'pipe', 'pipe'] })
  } catch (err: any) {
    code = err.status ?? 1
    out = `${err.stdout ?? ''}${err.stderr ?? ''}`
  }
  const label = args.join(' ')
  if (code !== 0 && !allowFailure) failures.push(`${label} exited ${code}\n${out.slice(-400)}`)
  for (const marker of expect) {
    if (!out.includes(marker)) failures.push(`${label} missing "${marker}"\n${out.slice(-400)}`)
  }
  return out
}

run(['init'], ['initialized'])
run(['version'], ['jary 1.'])
run(['doctor'], ['plugins loaded', 'tools registered'])
run(['config', 'print'], ['store'])
run(['tools', '--json'], ['"name"'])
run(['memory', 'add', '以后周报用中文', '--kind', 'rule', '--pinned'], ['mem_'])
run(['memory', 'catalog'], ['周报'])
run(['bot', 'add', 'researcher'], ['researcher'])
run(['bot', 'list'], ['researcher'])
run(['bot', 'edit', 'researcher', '--persona', '研究员'], ['研究员'])
run(['job', 'add', '--cron', '0 8 * * *', '--tz', 'Asia/Shanghai', '--name', 'morning', '生成今日简报'], ['morning'])
run(['job', 'list'], ['morning'])
run(['vault', 'add', '--name', 'GitHub', '--origin', 'https://github.com', '--username', 'me', '--password', 'pw'], ['vault_'])
run(['vault', 'list'], ['GitHub'])
run(['goal', 'set', '写一份周报'], ['objective'])
run(['goal', 'list'], ['写一份周报'])
run(['session', 'list'], [], true)
run(['usage'], ['inputTokens'])
run(['audit'], ['bot.added'])
run(['plugin', 'permissions'], ['high-risk'])
run(['plugin', 'disable', 'shell'], ['disabled shell'])
run(['plugin', 'enable', 'shell'], ['enabled shell'])
run(['backup', '--out', join(home, 'backup')], ['backup'])
run(['restore', '--from', join(home, 'backup'), '--yes'], ['restored'])
run(['stop-all'], ['stopped'])

if (!existsSync(home)) failures.push('home directory was not created')
if (readdirSync(home).length === 0) failures.push('home directory is empty')

if (failures.length > 0) {
  console.error(`smoke failed (${failures.length}):`)
  for (const failure of failures) console.error(`\n- ${failure}`)
  process.exit(1)
}
console.log(`smoke ok (${home})`)
