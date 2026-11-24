#!/usr/bin/env node
/**
 * Keeps docs/18-code-inventory.md honest: compares the recorded counts with a fresh
 * runtime inventory. Run via `npm run check` so stale numbers can't land.
 */
import { execFileSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { join, resolve } from 'node:path'

const ROOT = resolve(import.meta.dirname, '..')
const DOC = join(ROOT, 'docs/18-code-inventory.md')

const raw = execFileSync(process.execPath, [join(ROOT, 'scripts/inventory.ts'), '--json'], { encoding: 'utf8', timeout: 120_000 })
const inventory = JSON.parse(raw)
const doc = readFileSync(DOC, 'utf8')

const expected: Record<string, number> = {
  '包（packages/*）': inventory.packages.length,
  '已加载插件': inventory.plugins.length,
  '模型可见工具': inventory.toolCount,
  'HTTP 路由（含静态与 webhook）': inventory.routeCount,
  'SQLite 表': inventory.tables.length,
  'CLI 命令': inventory.commandCount,
  '测试文件': inventory.testFileCount,
}
const problems: string[] = []
for (const [label, value] of Object.entries(expected)) {
  const match = doc.match(new RegExp(`\\| ${label.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')} \\| (\\d+) \\|`))
  if (!match) { problems.push(`docs/18 missing row: ${label}`); continue }
  if (Number(match[1]) !== value) problems.push(`docs/18 ${label}: doc=${match[1]} actual=${value}`)
}
if (!doc.includes(`${inventory.toolCount} 个`)) {
  // tool table row count sanity: every tool must appear in the doc
  const missing = inventory.tools.filter((tool: { name: string }) => !doc.includes(`\`${tool.name}\``))
  for (const tool of missing) problems.push(`docs/18 missing tool: ${tool.name}`)
}

if (problems.length > 0) {
  console.error('inventory check failed (run `npm run inventory`):')
  for (const problem of problems) console.error(' - ' + problem)
  process.exit(1)
}
console.log(`inventory check ok (${inventory.toolCount} tools, ${inventory.routeCount} routes, ${inventory.testFileCount} test files)`)
