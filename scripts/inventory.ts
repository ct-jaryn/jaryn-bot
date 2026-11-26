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
const cliText = readFileSync(CLI, 'utf8').replaceAll('\r\n', '\n')
const commands = new Set<string>()
for (const match of cliText.matchAll(/if \(cmd === '([a-z-]+)'\)/g)) commands.add(match[1]!)
for (const match of cliText.matchAll(/^  ([a-z-]+)(?: [a-z][a-z0-9|<>[\] ._-]*)? {2,}/gm)) commands.add(match[1]!)

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
  lines.push('# 代码清单（自动生成）', '')
  lines.push('> 适用版本：v1.11.0 · 状态：自动生成（`npm run inventory`）')
  lines.push('')
  lines.push('包/插件/工具/路由/表/CLI/测试文件的全量统计，用于核对文档数字。`npm run check:inventory` 会校验它与运行时一致。', '')
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
  writeFileSync(join(ROOT, 'docs/reference/inventory.md'), lines.join('\n'))

  // Tool reference, grouped by tool family.
  const groups: { title: string; prefix: string }[] = [
    { title: '文件系统', prefix: 'fs.' },
    { title: '网络', prefix: 'web.' },
    { title: 'Shell', prefix: 'shell.' },
    { title: '记忆', prefix: 'memory.' },
    { title: '任务板', prefix: 'task.' },
    { title: 'Bot / 子任务', prefix: 'bot.' },
    { title: '浏览器', prefix: 'browser.' },
    { title: '云电脑', prefix: 'computer.' },
    { title: 'Vault', prefix: 'vault.' },
    { title: '页面', prefix: 'pages.' },
    { title: '产物', prefix: 'artifact.' },
    { title: 'Office', prefix: 'office.' },
    { title: '邮箱', prefix: 'email.' },
    { title: '连接器（示例）', prefix: 'gmail.' },
    { title: '主动提议', prefix: 'initiative.' },
    { title: '教学', prefix: 'teach.' },
    { title: '例程', prefix: 'schedule.' },
    { title: '目标', prefix: 'goal.' },
  ]
  const toolLines: string[] = []
  toolLines.push('# 工具清单', '')
  toolLines.push('> 适用版本：v1.11.0 · 状态：自动生成（`npm run inventory`）', '')
  toolLines.push(`模型可见的 **${inventory.toolCount}** 个工具，按用途分组。风险等级决定审批行为，见 [核心概念](../concepts.md)。`, '')
  toolLines.push('说明列是工具注册时给模型的原始描述，与运行时一致；分组标题为中文归类。', '')
  toolLines.push('| 风险 | 数量 | 默认行为 |', '|---|---|---|')
  const behavior: Record<string, string> = {
    read: '自动允许', write: '自动允许（工作区内）', network: '自动允许（SSRF 防护）',
    execute: '逐次审批', external: '逐次审批', destructive: '逐次审批',
  }
  for (const [risk, count] of Object.entries(inventory.toolsByRisk)) {
    if (count === 0) continue
    toolLines.push(`| \`${risk}\` | ${count} | ${behavior[risk] ?? ''} |`)
  }
  toolLines.push('')
  const used = new Set<string>()
  for (const group of groups) {
    const members = inventory.tools.filter((tool: { name: string }) => tool.name.startsWith(group.prefix))
    if (members.length === 0) continue
    for (const tool of members) used.add(tool.name)
    toolLines.push(`## ${group.title}`, '')
    toolLines.push('| 工具 | 风险 | 说明 |', '|---|---|---|')
    for (const tool of members) toolLines.push(`| \`${tool.name}\` | ${tool.risk} | ${(tool.description || '').replace(/\|/g, '\\|')} |`)
    toolLines.push('')
  }
  const rest = inventory.tools.filter((tool: { name: string }) => !used.has(tool.name))
  if (rest.length > 0) {
    toolLines.push('## 其它', '', '| 工具 | 风险 | 说明 |', '|---|---|---|')
    for (const tool of rest) toolLines.push(`| \`${tool.name}\` | ${tool.risk} | ${(tool.description || '').replace(/\|/g, '\\|')} |`)
    toolLines.push('')
  }
  writeFileSync(join(ROOT, 'docs/reference/tools.md'), toolLines.join('\n'))

  console.log(`wrote docs/reference/inventory.md + docs/reference/tools.md (${inventory.toolCount} tools, ${inventory.routeCount} routes, ${inventory.testFileCount} test files)`)
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
