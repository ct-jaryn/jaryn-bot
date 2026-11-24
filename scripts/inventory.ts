#!/usr/bin/env node
/**
 * Code inventory: what the runtime actually exposes, so docs are checked against
 * reality instead of memory.
 *
 *   node scripts/inventory.ts           # summary
 *   node scripts/inventory.ts --json    # full inventory
 */
import { execFileSync } from 'node:child_process'
import { mkdtempSync, readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'

const ROOT = resolve(import.meta.dirname, '..')
const PKGS = join(ROOT, 'packages')
const CLI = join(PKGS, 'cli/src/index.ts')

function walk(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    const path = join(dir, entry)
    if (statSync(path).isDirectory()) walk(path, out)
    else if (path.endsWith('.ts')) out.push(path)
  }
  return out
}

const packages = readdirSync(PKGS).filter((name) => {
  try { return statSync(join(PKGS, name, 'package.json')).isFile() } catch { return false }
}).sort()

// Tools: ask the runtime itself (plugins, configs and all).
const home = mkdtempSync(join(tmpdir(), 'jary-inventory-'))
let tools: { name: string; risk: string; description: string }[] = []
let plugins: string[] = []
try {
  tools = JSON.parse(execFileSync(process.execPath, [CLI, 'tools', '--json', '--home', home], { encoding: 'utf8', timeout: 60_000 }))
  const doctor = execFileSync(process.execPath, [CLI, 'doctor', '--home', home], { encoding: 'utf8', timeout: 60_000 })
  const match = doctor.match(/plugins loaded — (.+)/)
  if (match) plugins = match[1]!.split(',').map((name) => name.trim()).sort()
} catch (err) {
  console.error('inventory: failed to boot runtime:', (err as Error).message)
  process.exit(1)
}

// Routes: parsed from the web router (single place where HTTP is served).
const webFile = readFileSync(join(PKGS, 'web/src/index.ts'), 'utf8')
const routes = new Set<string>()
for (const match of webFile.matchAll(/req\.method === '([A-Z]+)' && path === '([^']+)'/g)) routes.add(`${match[1]} ${match[2]}`)
for (const match of webFile.matchAll(/req\.method === '([A-Z]+)' && path\.startsWith\('([^']+)'\)/g)) routes.add(`${match[1]} ${match[2]}*`)
for (const match of webFile.matchAll(/req\.method === '([A-Z]+)' && \/\^([^/]+)\/\.test\(path\)/g)) routes.add(`${match[1]} ${match[2]!.replace(/\\\//g, '/')}`)
for (const match of webFile.matchAll(/\(req\.method === '([A-Z]+)' \|\| req\.method === '([A-Z]+)'\) && path === '([^']+)'/g)) routes.add(`${match[1]}|${match[2]} ${match[3]}`)

// DB tables.
const tables = new Set<string>()
for (const file of walk(PKGS)) {
  for (const match of readFileSync(file, 'utf8').matchAll(/CREATE TABLE IF NOT EXISTS (\w+)/g)) tables.add(match[1]!)
}

// CLI commands: the help table + command dispatch branches.
const cliText = readFileSync(CLI, 'utf8')
const commands = new Set<string>()
for (const match of cliText.matchAll(/if \(cmd === '([a-z-]+)'\)/g)) commands.add(match[1]!)
for (const match of cliText.matchAll(/^\s{2}([a-z-]+)(?: [a-z][a-z0-9|<>[\] ._-]*)?\s{2,}/gm)) commands.add(match[1]!)

// Tests.
const testFiles: string[] = []
for (const pkg of packages) {
  const dir = join(PKGS, pkg, 'test')
  try { for (const f of readdirSync(dir)) if (f.endsWith('.test.ts')) testFiles.push(`packages/${pkg}/test/${f}`) } catch { /* none */ }
}
try { for (const f of readdirSync(join(ROOT, 'scripts'))) if (f.endsWith('.test.ts')) testFiles.push(`scripts/${f}`) } catch { /* none */ }
try { for (const f of readdirSync(join(ROOT, 'desktop/test'))) if (f.endsWith('.test.cjs')) testFiles.push(`desktop/test/${f}`) } catch { /* none */ }

const inventory = {
  packages,
  plugins,
  tools,
  toolCount: tools.length,
  toolsByRisk: Object.fromEntries(['read', 'write', 'execute', 'network', 'external', 'destructive'].map((risk) => [risk, tools.filter((tool) => tool.risk === risk).length])),
  routes: [...routes].sort(),
  routeCount: routes.size,
  tables: [...tables].sort(),
  commands: [...commands].sort(),
  commandCount: commands.size,
  testFiles: testFiles.sort(),
  testFileCount: testFiles.length,
}

if (process.argv.includes('--write-docs')) {
  const lines: string[] = []
  lines.push('# 18 · 代码与文档清单（自动生成）', '')
  lines.push('> 状态：**自动生成，勿手改**。`npm run inventory` 重新生成；`npm run check:inventory` 校验它与运行时一致。', '')
  lines.push('## 1. 规模', '', '| 项 | 数量 |', '|---|---|')
  lines.push(`| 包（packages/*） | ${inventory.packages.length} |`)
  lines.push(`| 已加载插件 | ${inventory.plugins.length} |`)
  lines.push(`| 模型可见工具 | ${inventory.toolCount} |`)
  lines.push(`| HTTP 路由（含静态与 webhook） | ${inventory.routeCount} |`)
  lines.push(`| SQLite 表 | ${inventory.tables.length} |`)
  lines.push(`| CLI 命令 | ${inventory.commandCount} |`)
  lines.push(`| 测试文件 | ${inventory.testFileCount} |`, '')
  lines.push('## 2. 工具（按风险）', '', '| 风险 | 数量 | 含义 |', '|---|---|---|')
  const meaning: Record<string, string> = {
    read: '只读（自动允许）', write: '写工作区（自动允许）', network: '出网只读（自动允许）',
    execute: '执行（默认需审批）', external: '外部副作用（默认需审批）', destructive: '破坏性（默认需审批，逐次）',
  }
  for (const [risk, count] of Object.entries(inventory.toolsByRisk)) lines.push(`| ${risk} | ${count} | ${meaning[risk] ?? ''} |`)
  lines.push('', '## 3. 工具清单', '', '| 工具 | 风险 |', '|---|---|')
  for (const tool of inventory.tools) lines.push(`| \`${tool.name}\` | ${tool.risk} |`)
  lines.push('', '## 4. HTTP 路由', '', '| 方法 | 路径 |', '|---|---|')
  for (const route of inventory.routes) {
    const [method, path] = route.split(' ', 2)
    lines.push(`| ${method} | \`${path}\` |`)
  }
  lines.push('', '## 5. SQLite 表', '', inventory.tables.map((table) => `\`${table}\``).join(', '), '')
  lines.push('## 6. CLI 命令', '', inventory.commands.map((command) => `\`${command}\``).join(', '), '')
  lines.push('## 7. 测试文件', '')
  for (const file of inventory.testFiles) lines.push(`- \`${file}\``)
  lines.push('')
  writeFileSync(join(ROOT, 'docs/18-code-inventory.md'), lines.join('\n'))
  console.log(`wrote docs/18-code-inventory.md (${inventory.toolCount} tools, ${inventory.routeCount} routes, ${inventory.testFileCount} test files)`)
  process.exit(0)
}

if (process.argv.includes('--json')) {
  console.log(JSON.stringify(inventory, null, 2))
} else {
  console.log(`packages: ${inventory.packages.length}`)
  console.log(`plugins:  ${inventory.plugins.length}`)
  console.log(`tools:    ${inventory.toolCount} (${Object.entries(inventory.toolsByRisk).filter(([, n]) => n > 0).map(([r, n]) => `${r}:${n}`).join(' ')})`)
  console.log(`routes:   ${inventory.routeCount}`)
  console.log(`tables:   ${inventory.tables.length}`)
  console.log(`cli:      ${inventory.commandCount}`)
  console.log(`tests:    ${inventory.testFileCount} files`)
}
