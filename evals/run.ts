import { readFileSync } from 'node:fs'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { Context, applyPatch, composeProfile, loadComposition } from '@jaryn/kernel'
import { agentPlugin, toolRegistryPlugin } from '@jaryn/agent-core'
import { storePlugin } from '@jaryn/store-sqlite'
import { shellPlugin } from '@jaryn/tools-shell'
import { fsPlugin } from '@jaryn/tools-fs'
import { deepseekPlugin } from '@jaryn/llm-deepseek'

interface Task {
  id: string
  prompt: string
  expect: string[]
}

const ROOT = resolve(import.meta.dirname, '..')
const raw = readFileSync(join(import.meta.dirname, 'tasks.json'), 'utf8')
const tasks = JSON.parse(raw) as Task[]
const dry = process.argv.includes('--dry')

// Structural validation always runs (works without an API key).
const problems: string[] = []
if (!Array.isArray(tasks) || tasks.length < 10) problems.push('tasks.json must contain at least 10 tasks')
const ids = new Set<string>()
for (const [i, task] of tasks.entries()) {
  if (!task.id || typeof task.id !== 'string') problems.push(`task ${i}: missing id`)
  else if (ids.has(task.id)) problems.push(`task ${i}: duplicate id ${task.id}`)
  else ids.add(task.id)
  if (!task.prompt || task.prompt.length < 10) problems.push(`task ${task.id}: prompt too short`)
  if (!Array.isArray(task.expect) || task.expect.length === 0) problems.push(`task ${task.id}: expect must be non-empty`)
}
if (problems.length > 0) {
  console.error('eval tasks invalid:\n' + problems.map((p) => ' - ' + p).join('\n'))
  process.exit(1)
}

if (dry) {
  console.log(`eval tasks ok (${tasks.length} tasks) — dry run, no model calls`)
  process.exit(0)
}

if (!process.env.DEEPSEEK_API_KEY) {
  console.log(`DEEPSEEK_API_KEY not set — structural check ok (${tasks.length} tasks), model run skipped`)
  process.exit(0)
}

const home = mkdtempSync(join(tmpdir(), 'jary-eval-'))
process.env.JARY_HOME = home
const base = JSON.parse(readFileSync(join(ROOT, 'packages/bundles/base/patch.json'), 'utf8'))
const rows = applyPatch(composeProfile({ name: 'eval', bundles: [{ name: 'base', patch: base }] }), [
  { id: 'llm', name: '@jaryn/llm-deepseek', config: {} },
])
const ctx = new Context({ scope: 'root' })
await loadComposition(
  ctx,
  rows,
  new Map([
    ['@jaryn/store-sqlite', storePlugin()],
    ['@jaryn/llm-deepseek', deepseekPlugin()],
    ['@jaryn/agent-core/tools', toolRegistryPlugin()],
    ['@jaryn/tools-shell', shellPlugin()],
    ['@jaryn/tools-fs', fsPlugin()],
    ['@jaryn/agent-core', agentPlugin()],
  ]),
)
const store = ctx.get<any>('store')
store.createSession('eval', 'eval', ROOT)
const agent = ctx.get<any>('agent')
let passed = 0
const results: { id: string; ok: boolean; text: string }[] = []
for (const task of tasks) {
  const result = await agent.runTurn({ sessionId: 'eval', text: task.prompt })
  const ok = task.expect.every((e) => result.text.includes(e))
  if (ok) passed++
  results.push({ id: task.id, ok, text: result.text.slice(0, 200) })
  console.log(`${ok ? 'PASS' : 'FAIL'} ${task.id}${ok ? '' : ` — ${result.text.slice(0, 160)}`}`)
}
await ctx.dispose()
const ratio = passed / tasks.length
console.log(`\n${passed}/${tasks.length} passed (home: ${home})`)
if (process.argv.includes('--json')) console.log(JSON.stringify({ passed, total: tasks.length, results }, null, 2))
process.exit(ratio >= 0.7 ? 0 : 1)
